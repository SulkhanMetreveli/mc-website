// ============================================================================
// /api/portal/import/*  — one-time import from Supabase into Netlify Blobs
//
// Runs in short steps (each call does ≤ ~7s of work and returns progress) so
// it fits inside a normal function invocation; the admin page keeps calling
// `step` until `done`. The Supabase service key is sent with every call and
// is never stored anywhere.
//
// Access: a Super Admin with a verified session — or, before any user exists
// in Blobs (first run), anyone holding the Supabase service key, since that
// key already grants full access to the very data being imported.
// ============================================================================
import type { Config } from "@netlify/functions";
import { json, readJson, nowIso, freshGrace, contentTypeFor } from "./_lib/common.mts";
import {
  portalStore, portalFiles, getAuth, mfaOk, isSuperAdmin, listUsers, createUser, saveUser, getUser,
  saveClient, saveRecord, CLIENT_PROFILE_FIELDS,
} from "./_lib/portal.mts";

const STEP_BUDGET_MS = 7000;
const STATE_KEY = "import:state";
const FILES_KEY = "import:files";

type State = {
  phase: "users" | "records" | "files" | "done";
  table_index: number;
  file_index: number;
  counts: Record<string, number>;
  log: string[];
  started_at: string;
  finished_at?: string;
  error?: string | null;
};

// [supabase table, blob record kind, fields holding storage paths -> bucket]
const TABLES: Array<[string, string, Record<string, string>]> = [
  ["investment_vehicles", "vehicle", {}],
  ["documents", "document", { storage_path: "client-documents" }],
  ["withdrawal_requests", "withdrawal", {}],
  ["address_update_requests", "addrreq", { proof_of_address_path: "kyc-files", passport_copy_path: "kyc-files" }],
  ["onboarding_submissions", "onboarding", { passport_copy_path: "kyc-files", proof_of_address_path: "kyc-files" }],
  ["document_submissions", "docsub", { passport_path: "kyc-files", proof_of_address_path: "kyc-files" }],
  ["general_document_submissions", "gendoc", { file_path: "kyc-files" }],
  ["dms_categories", "dmscat", {}],
  ["dms_documents", "dmsdoc", { file_path: "dms-files" }],
];

export default async (req: Request) => {
  const url = new URL(req.url);
  const seg = url.pathname.replace(/^\/api\/portal\/import\/?/, "").split("/").filter(Boolean)[0] || "";
  const st = portalStore();

  const users = await listUsers();
  const bootstrap = users.length === 0;
  const auth = await getAuth(req);
  const allowed = bootstrap || (auth && isSuperAdmin(auth.user) && mfaOk(auth));

  if (seg === "status" && req.method === "GET") {
    const state = (await st.get(STATE_KEY, { type: "json" })) as State | null;
    return json({ bootstrap, allowed: !!allowed, user_count: users.length, state });
  }
  if (!allowed) return json({ error: "Only a Super Admin can run the import." }, { status: 403 });

  if (seg === "reset" && req.method === "POST") {
    await st.delete(STATE_KEY).catch(() => {}); await st.delete(FILES_KEY).catch(() => {});
    return json({ ok: true });
  }
  if (seg !== "step" || req.method !== "POST") return json({ error: "Not found." }, { status: 404 });

  const body = await readJson(req);
  const base = String(body.supabase_url || "").trim().replace(/\/+$/, "");
  const key = String(body.service_key || "").trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)) return json({ error: "Supabase URL must look like https://xxxx.supabase.co" }, { status: 400 });
  if (!key) return json({ error: "The service role key is required." }, { status: 400 });
  const H = { apikey: key, authorization: `Bearer ${key}` };
  let state = (await st.get(STATE_KEY, { type: "json" })) as State | null;
  if (!state || state.phase === "done" || body.restart) {
    state = { phase: "users", table_index: 0, file_index: 0, counts: {}, log: [], started_at: nowIso(), error: null };
    await st.delete(FILES_KEY).catch(() => {});
  }
  const log = (m: string) => { state!.log.push(`${new Date().toISOString().slice(11, 19)}  ${m}`); if (state!.log.length > 400) state!.log.shift(); };

  async function rest(path: string, init: RequestInit = {}) {
    const r = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...H, "content-type": "application/json", ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`Supabase ${path.split("?")[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  async function allRows(table: string) {
    const out: any[] = [];
    for (let from = 0; ; from += 1000) {
      let rows: any[];
      try { rows = await rest(`${table}?select=*`, { headers: { Range: `${from}-${from + 999}` } }); }
      catch (e: any) {
        // A table that was never created (migration not run) simply has no rows.
        if (/ 404 |42P01|does not exist/.test(e.message)) { log(`${table}: table not found, skipped`); return out; }
        throw e;
      }
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }

  const started = Date.now();
  const files = portalFiles();

  try {
    /* -------------------------------------------------------------- users */
    if (state.phase === "users") {
      const [authUsers, profiles, admins] = await Promise.all([
        rest("rpc/export_auth_users", { method: "POST", body: "{}" }).catch((e: any) => { throw new Error(`Could not read logins — did you run the export SQL first? (${e.message})`); }),
        allRows("client_profiles"), allRows("admin_users"),
      ]);
      const byId: Record<string, any> = {};
      (authUsers as any[]).forEach((u) => { byId[u.id] = u; });
      const grace = freshGrace();
      let nClients = 0, nAdmins = 0, nSkipped = 0;
      const seen = new Set<string>();
      for (const p of profiles) {
        const au = byId[p.user_id];
        if (!au) { nSkipped++; log(`skip client ${p.email}: no login found`); continue; }
        const existing = await getUser(p.user_id);
        const u = existing || (await createUser({ id: p.user_id, email: au.email || p.email, password_hash: au.encrypted_password || "", must_change_password: !!p.must_change_password, is_client: true, created_at: au.created_at || p.created_at }));
        u.email = String(au.email || p.email).toLowerCase(); u.password_hash = au.encrypted_password || ""; u.is_client = true;
        u.must_change_password = !!p.must_change_password; u.mfa_grace_until = grace;
        await saveUser(u); await st.set(`email:${u.email}`, u.id);
        const profile: any = { user_id: p.user_id, created_at: p.created_at || nowIso() };
        for (const k of CLIENT_PROFILE_FIELDS) profile[k] = p[k] ?? null;
        profile.status = p.status || "active";
        await saveClient(profile);
        seen.add(p.user_id); nClients++;
      }
      for (const a of admins) {
        const au = byId[a.user_id];
        if (!au) { nSkipped++; log(`skip admin ${a.email || a.user_id}: no login found`); continue; }
        const existing = await getUser(a.user_id);
        const u = existing || (await createUser({ id: a.user_id, email: au.email || a.email, password_hash: au.encrypted_password || "", must_change_password: false, is_client: false, created_at: au.created_at || a.created_at }));
        u.email = String(au.email || a.email).toLowerCase(); u.password_hash = au.encrypted_password || "";
        u.admin = { full_name: a.full_name || u.email, role: a.role === "super_admin" ? "super_admin" : "admin", apps: Array.isArray(a.apps) ? a.apps : [], created_at: a.created_at || nowIso() };
        if (!seen.has(a.user_id)) u.must_change_password = false;
        u.mfa_grace_until = grace;
        await saveUser(u); await st.set(`email:${u.email}`, u.id);
        nAdmins++;
      }
      state.counts.clients = nClients; state.counts.admins = nAdmins; state.counts.logins_skipped = nSkipped;
      log(`logins: ${nClients} clients, ${nAdmins} admins imported (${nSkipped} skipped). Everyone gets 7 days to set up 2FA again.`);
      state.phase = "records";
    }

    /* ------------------------------------------------------------ records */
    while (state.phase === "records" && Date.now() - started < STEP_BUDGET_MS) {
      if (state.table_index >= TABLES.length) { state.phase = "files"; break; }
      const [table, kind, pathFields] = TABLES[state.table_index];
      const rows = await allRows(table);
      const fileList = ((await st.get(FILES_KEY, { type: "json" })) as any[] | null) || [];
      for (const r of rows) {
        const rec: any = { ...r };
        for (const [field, bucket] of Object.entries(pathFields)) {
          if (rec[field]) { fileList.push({ bucket, path: rec[field] }); rec[field] = `${bucket}/${rec[field]}`; }
        }
        if (kind === "document" && rec.storage_path) rec.file_name = String(rec.storage_path).split("/").pop();
        if (kind === "dmscat" || kind === "dmsdoc") await st.setJSON(`${kind}:${rec.id}`, rec);
        else await saveRecord(kind, rec);
      }
      await st.setJSON(FILES_KEY, fileList);
      state.counts[table] = rows.length;
      log(`${table}: ${rows.length} rows`);
      state.table_index++;
      await st.setJSON(STATE_KEY, state);
    }

    /* -------------------------------------------------------------- files */
    if (state.phase === "files") {
      const fileList = ((await st.get(FILES_KEY, { type: "json" })) as any[] | null) || [];
      state.counts.files_total = fileList.length;
      while (state.file_index < fileList.length && Date.now() - started < STEP_BUDGET_MS) {
        const f = fileList[state.file_index];
        const dest = `${f.bucket}/${f.path}`;
        try {
          const r = await fetch(`${base}/storage/v1/object/${f.bucket}/${f.path.split("/").map(encodeURIComponent).join("/")}`, { headers: H });
          if (!r.ok) throw new Error(`${r.status}`);
          const data = await r.arrayBuffer();
          const name = String(f.path).split("/").pop() || "file";
          await files.set(dest, data, { metadata: { file_name: name, content_type: r.headers.get("content-type") || contentTypeFor(name) } });
          state.counts.files_done = (state.counts.files_done || 0) + 1;
        } catch (e: any) {
          state.counts.files_failed = (state.counts.files_failed || 0) + 1;
          log(`file failed ${dest}: ${e.message}`);
        }
        state.file_index++;
      }
      if (state.file_index >= fileList.length) {
        state.phase = "done"; state.finished_at = nowIso();
        log(`done: ${state.counts.files_done || 0} files copied, ${state.counts.files_failed || 0} failed.`);
      }
    }
  } catch (err: any) {
    state.error = err.message || String(err);
    log(`ERROR: ${state.error}`);
  }
  await st.setJSON(STATE_KEY, state);
  return json({ done: state.phase === "done", error: state.error || null, state });
};

export const config: Config = { path: "/api/portal/import/*" };

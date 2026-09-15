// ============================================================================
// /api/portal/admin/*  — company panel: admin users + Client Dashboard app
// Caller must be an admin with a verified session. Client Dashboard routes
// additionally need the 'client_dashboard' app (super admins have all apps).
// ============================================================================
import type { Config } from "@netlify/functions";
import {
  json, readJson, newId, nowIso, hashPassword, randomPassword, claimUpload, clearMfa, freshGrace,
} from "./_lib/common.mts";
import {
  portalStore, portalFiles, getAuth, mfaOk, mfaRequiredResponse,
  getUser, getUserByEmail, createUser, saveUser, listUsers, publicUser, isSuperAdmin, hasApp,
  destroyAllSessionsFor, forgetDevices,
  getClient, saveClient, listClients, CLIENT_PROFILE_FIELDS,
  getRecord, saveRecord, deleteRecord, listRecords, byDateDesc,
  REVIEW_STATUSES, VEHICLE_STATUSES, DOC_CATEGORIES, APP_KEYS,
} from "./_lib/portal.mts";

const s = (v: any) => { const t = String(v ?? "").trim(); return t ? t : null; };
const num = (v: any) => (v === "" || v === null || v === undefined ? null : (isNaN(Number(v)) ? null : Number(v)));

export default async (req: Request) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/portal\/admin\/?/, "").split("/").filter(Boolean);
  const [seg, id, sub, subId, action] = parts;
  const method = req.method;

  const auth = await getAuth(req);
  if (!auth) return json({ error: "Not authenticated." }, { status: 401 });
  if (!auth.user.admin) return json({ error: "Not an admin account." }, { status: 403 });
  if (!mfaOk(auth)) return mfaRequiredResponse(auth);
  const me = auth.user;
  const files = portalFiles(), meta = portalStore();

  try {
    /* ------------------------------------------------------- admin users */
    if (seg === "admins") {
      if (!isSuperAdmin(me)) return json({ error: "Only a Super Admin can manage admins." }, { status: 403 });
      if (!id && method === "GET") {
        const admins = (await listUsers()).filter((u) => u.admin).map((u) => ({ ...publicUser(u), totp_enabled: !!u.totp_enabled }))
          .sort((a, b) => String(a.admin!.created_at).localeCompare(String(b.admin!.created_at)));
        return json({ admins });
      }
      if (!id && method === "POST") {
        const b = await readJson(req);
        const email = String(b.email || "").trim().toLowerCase();
        const fullName = s(b.full_name);
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !fullName) return json({ error: "Email and full name are required." }, { status: 400 });
        const role = b.role === "super_admin" ? "super_admin" : "admin";
        const apps = role === "super_admin" ? [] : (Array.isArray(b.apps) ? b.apps.filter((a: string) => APP_KEYS.includes(a)) : []);
        if (role === "admin" && !apps.length) return json({ error: "Pick at least one app, or make them a Super Admin." }, { status: 400 });
        const grant = { full_name: fullName, role, apps, created_at: nowIso() } as any;
        const existing = await getUserByEmail(email);
        if (existing) {
          if (existing.admin) return json({ error: "That email is already an admin." }, { status: 400 });
          // Existing client login gaining panel access: keep their password.
          existing.admin = grant;
          await saveUser(existing);
          return json({ ok: true, admin: publicUser(existing), password: null });
        }
        const chosen = String(b.password || "");
        if (chosen && chosen.length < 10) return json({ error: "Password must be at least 10 characters, or leave it blank." }, { status: 400 });
        const password = chosen || randomPassword();
        const u = await createUser({ email, password_hash: await hashPassword(password), must_change_password: true, admin: grant, is_client: false });
        return json({ ok: true, admin: publicUser(u), password });
      }
      const target = await getUser(id);
      if (!target || !target.admin) return json({ error: "Admin not found." }, { status: 404 });
      if (target.id === me.id) return json({ error: "You can't change your own admin access here." }, { status: 400 });
      if (!sub && method === "DELETE") {
        target.admin = null;
        await saveUser(target);
        if (!target.is_client) await destroyAllSessionsFor(target.id);
        return json({ ok: true });
      }
      if (!sub && method === "PATCH") {
        const b = await readJson(req);
        const role = b.role === "super_admin" ? "super_admin" : "admin";
        const apps = role === "super_admin" ? [] : (Array.isArray(b.apps) ? b.apps.filter((a: string) => APP_KEYS.includes(a)) : []);
        if (role === "admin" && !apps.length) return json({ error: "Pick at least one app, or make them a Super Admin." }, { status: 400 });
        target.admin = { ...target.admin, role, apps, full_name: s(b.full_name) || target.admin.full_name };
        await saveUser(target);
        return json({ ok: true, admin: publicUser(target) });
      }
      if (sub === "reset-mfa" && method === "POST") {
        clearMfa(target); await saveUser(target);
        await destroyAllSessionsFor(target.id); await forgetDevices(target.id);
        return json({ ok: true, grace_until: target.mfa_grace_until });
      }
      if (sub === "reset-password" && method === "POST") {
        const password = randomPassword();
        target.password_hash = await hashPassword(password); target.must_change_password = true;
        await saveUser(target); await destroyAllSessionsFor(target.id);
        return json({ ok: true, password });
      }
      return json({ error: "Not found." }, { status: 404 });
    }

    /* --------------------------------------------- Client Dashboard app */
    if (!hasApp(me, "client_dashboard")) return json({ error: "This requires the Client Dashboard app." }, { status: 403 });

    if (seg === "overview" && method === "GET") {
      const [clients, onboarding, addr, wd, docsub, gendoc] = await Promise.all([
        listClients(), listRecords("onboarding"), listRecords("addrreq"), listRecords("withdrawal"), listRecords("docsub"), listRecords("gendoc"),
      ]);
      const pend = (rows: any[]) => rows.filter((r) => r.status === "pending");
      const nameMap: Record<string, string> = {};
      clients.forEach((c) => { nameMap[c.user_id] = c.full_name || c.email; });
      const items: any[] = [];
      pend(onboarding).forEach((r) => items.push({ type: "Onboarding / KYC", detail: "Initial onboarding submission", submitted_at: r.submitted_at, user_id: r.user_id }));
      pend(addr).forEach((r) => items.push({ type: "Address & Bank Update", detail: r.country ? "New address in " + r.country : "Address/bank change request", submitted_at: r.submitted_at, user_id: r.user_id }));
      pend(wd).forEach((r) => items.push({ type: "Withdrawal Request", detail: (r.withdrawal_type === "full" ? "Full balance" : `${r.amount} ${r.currency}`) + " — " + r.currency, submitted_at: r.submitted_at, user_id: r.user_id }));
      pend(docsub).forEach((r) => items.push({ type: "Document Submission", detail: [r.passport_path && "Passport", r.proof_of_address_path && "Proof of Address"].filter(Boolean).join(" + "), submitted_at: r.submitted_at, user_id: r.user_id }));
      pend(gendoc).forEach((r) => items.push({ type: "General Document", detail: r.title, submitted_at: r.submitted_at, user_id: r.user_id }));
      items.forEach((it) => { it.client_name = nameMap[it.user_id] || it.user_id; });
      items.sort(byDateDesc("submitted_at"));
      return json({
        stats: { clients: clients.length, onboarding: pend(onboarding).length, updates: pend(addr).length, withdrawals: pend(wd).length, documents: pend(docsub).length, generaldocs: pend(gendoc).length },
        pending: items,
        clients: clients.sort(byDateDesc("created_at")),
      });
    }

    if (seg === "clients") {
      if (!id && method === "GET") return json({ clients: (await listClients()).sort(byDateDesc("created_at")) });
      if (!id && method === "POST") {
        const b = await readJson(req);
        const email = String(b.email || "").trim().toLowerCase();
        const fullName = s(b.full_name);
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !fullName) return json({ error: "Full name and a valid email are required." }, { status: 400 });
        const chosen = String(b.password || "");
        if (chosen && chosen.length < 10) return json({ error: "Password must be at least 10 characters, or leave it blank to auto-generate one." }, { status: 400 });
        const existing = await getUserByEmail(email);
        if (existing && existing.is_client) return json({ error: "A client with this email address already exists." }, { status: 400 });
        const password = chosen || randomPassword();
        let u = existing;
        if (u) { u.is_client = true; await saveUser(u); }
        else u = await createUser({ email, password_hash: await hashPassword(password), must_change_password: true, is_client: true });
        const profile: any = { user_id: u.id, full_name: fullName, email, client_reference: s(b.client_reference), status: "active", created_at: nowIso() };
        for (const k of CLIENT_PROFILE_FIELDS) if (!(k in profile)) profile[k] = null;
        await saveClient(profile);
        return json({ ok: true, user_id: u.id, email, password: existing ? null : password });
      }

      const profile = await getClient(id);
      if (!profile) return json({ error: "Client not found." }, { status: 404 });
      const uid = profile.user_id;

      if (!sub && method === "GET") {
        const [vehicles, documents, docsub, gendoc, onboarding, addrreq, withdrawals, user] = await Promise.all([
          listRecords("vehicle", uid), listRecords("document", uid), listRecords("docsub", uid), listRecords("gendoc", uid),
          listRecords("onboarding", uid), listRecords("addrreq", uid), listRecords("withdrawal", uid), getUser(uid),
        ]);
        return json({
          profile, user: user ? { ...publicUser(user), totp_enabled: !!user.totp_enabled, mfa_grace_until: user.mfa_grace_until || null } : null,
          vehicles: vehicles.sort((a, b) => String(a.vehicle_name).localeCompare(String(b.vehicle_name))),
          documents: documents.sort(byDateDesc("uploaded_at")),
          document_submissions: docsub.sort(byDateDesc("submitted_at")),
          general_documents: gendoc.sort(byDateDesc("submitted_at")),
          onboarding: onboarding.sort(byDateDesc("submitted_at")),
          address_requests: addrreq.sort(byDateDesc("submitted_at")),
          withdrawals: withdrawals.sort(byDateDesc("submitted_at")),
        });
      }
      if (!sub && method === "PATCH") {
        const b = await readJson(req);
        if (b.full_name !== undefined && !s(b.full_name)) return json({ error: "Full name is required." }, { status: 400 });
        for (const k of CLIENT_PROFILE_FIELDS) {
          if (k === "email") continue;
          if (k in b) profile[k] = k === "status" ? (b.status === "suspended" ? "suspended" : "active") : s(b[k]);
        }
        await saveClient(profile);
        return json({ ok: true, profile });
      }
      if (sub === "reset-password" && method === "POST") {
        const u = await getUser(uid);
        if (!u) return json({ error: "Login not found." }, { status: 404 });
        const password = randomPassword();
        u.password_hash = await hashPassword(password); u.must_change_password = true;
        await saveUser(u); await destroyAllSessionsFor(uid);
        return json({ ok: true, password });
      }
      if (sub === "reset-mfa" && method === "POST") {
        const u = await getUser(uid);
        if (!u) return json({ error: "Login not found." }, { status: 404 });
        clearMfa(u); await saveUser(u); await destroyAllSessionsFor(uid); await forgetDevices(uid);
        return json({ ok: true, grace_until: u.mfa_grace_until });
      }

      /* ------------------------------------------------------- vehicles */
      if (sub === "vehicles") {
        if (method === "POST" || (method === "PUT" && subId)) {
          const b = await readJson(req);
          const name = s(b.vehicle_name), currency = s(b.currency);
          if (!name || !currency) return json({ error: "Vehicle name and currency are required." }, { status: 400 });
          let v: any = subId ? await getRecord("vehicle", uid, subId) : null;
          if (subId && !v) return json({ error: "Vehicle not found." }, { status: 404 });
          if (!v) v = { id: newId(), user_id: uid, created_at: nowIso() };
          Object.assign(v, {
            vehicle_name: name, currency, balance: num(b.balance), ytd_performance_pct: num(b.ytd_performance_pct),
            inception_performance_pct: num(b.inception_performance_pct), as_of_date: s(b.as_of_date),
            status: VEHICLE_STATUSES.includes(b.status) ? b.status : "active", notes: s(b.notes), updated_at: nowIso(),
          });
          await saveRecord("vehicle", v);
          return json({ ok: true, vehicle: v });
        }
        if (method === "DELETE" && subId) { await deleteRecord("vehicle", uid, subId); return json({ ok: true }); }
      }

      /* ------------------------------------------------------ documents */
      if (sub === "documents") {
        if (method === "POST") {
          const b = await readJson(req);
          const title = s(b.title);
          if (!title || !b.upload_id) return json({ error: "Title and a file are required." }, { status: 400 });
          const did = newId();
          const f = await claimUpload(files, meta, String(b.upload_id), me.id, `client-documents/${uid}/${Date.now()}-${String(b.file_name || "document").replace(/[^a-zA-Z0-9._-]/g, "_")}`);
          if (!f) return json({ error: "The uploaded file could not be found. Please attach it again." }, { status: 400 });
          const d = { id: did, user_id: uid, title, category: DOC_CATEGORIES.includes(b.category) ? b.category : "other", storage_path: f.key, file_name: f.file_name, uploaded_at: nowIso() };
          await saveRecord("document", d);
          return json({ ok: true, document: d });
        }
        if (method === "DELETE" && subId) {
          const d = await getRecord("document", uid, subId);
          if (d && d.storage_path) await files.delete(d.storage_path).catch(() => {});
          await deleteRecord("document", uid, subId);
          return json({ ok: true });
        }
      }

      /* ------------------------------------------------ review workflows */
      // /clients/:id/<kind>/:rid/<review|approve|reject>
      const kinds: Record<string, string> = { "document-submissions": "docsub", "general-documents": "gendoc", onboarding: "onboarding", "address-requests": "addrreq", withdrawals: "withdrawal" };
      if (kinds[sub] && subId && method === "POST") {
        const kind = kinds[sub];
        const r = await getRecord(kind, uid, subId);
        if (!r) return json({ error: "Request not found." }, { status: 404 });
        const open = r.status === "pending" || r.status === "in_transit_documents_review";
        if (!open) return json({ error: "This request has already been reviewed." }, { status: 400 });
        if (action === "review") { r.status = "in_transit_documents_review"; await saveRecord(kind, r); return json({ ok: true, request: r }); }
        if (action === "reject") { r.status = "rejected"; r.reviewed_at = nowIso(); r.reviewed_by = me.email; await saveRecord(kind, r); return json({ ok: true, request: r }); }
        if (action === "approve") {
          // Approving a document submission copies the file(s) into the
          // client's Document Center; an address change is applied to the
          // profile. Bank/passport changes are never applied automatically.
          async function promote(path: string, title: string, category: string) {
            const got = await files.getWithMetadata(path, { type: "arrayBuffer" });
            if (!got || !got.data) throw new Error("Source file is missing in storage.");
            const fileName = String((got.metadata as any)?.file_name || path.split("/").pop());
            const key = `client-documents/${uid}/${Date.now()}-${fileName}`;
            await files.set(key, got.data, { metadata: { file_name: fileName, content_type: (got.metadata as any)?.content_type || "application/pdf" } });
            await saveRecord("document", { id: newId(), user_id: uid, title, category, storage_path: key, file_name: fileName, uploaded_at: nowIso() });
          }
          if (kind === "docsub") {
            if (r.passport_path) await promote(r.passport_path, "Passport Copy", "passport");
            if (r.proof_of_address_path) await promote(r.proof_of_address_path, "Proof of Address", "proof_of_address");
          }
          if (kind === "gendoc") await promote(r.file_path, r.title, "other");
          if (kind === "addrreq" && r.address_line1) {
            for (const k of ["address_line1", "address_line2", "city", "state_province", "postal_code", "country"]) profile[k] = r[k] ?? null;
            await saveClient(profile);
          }
          r.status = "approved"; r.reviewed_at = nowIso(); r.reviewed_by = me.email;
          await saveRecord(kind, r);
          return json({ ok: true, request: r });
        }
      }
      return json({ error: "Not found." }, { status: 404 });
    }

    return json({ error: "Not found." }, { status: 404 });
  } catch (err: any) {
    return json({ error: err.message || String(err) }, { status: 500 });
  }
};

export const config: Config = { path: "/api/portal/admin/*" };

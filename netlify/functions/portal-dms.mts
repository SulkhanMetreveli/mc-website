// ============================================================================
// /api/portal/dms/*  — Document Management app (categories + documents)
// Requires the 'dms' app in the company panel.
// ============================================================================
import type { Config } from "@netlify/functions";
import { json, readJson, newId, nowIso, claimUpload, listJson, streamFile } from "./_lib/common.mts";
import { portalStore, portalFiles, getAuth, mfaOk, mfaRequiredResponse, hasApp } from "./_lib/portal.mts";

const s = (v: any) => { const t = String(v ?? "").trim(); return t ? t : null; };
const ACTION_STATUSES = ["none", "pending", "done"];

export default async (req: Request) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/portal\/dms\/?/, "").split("/").filter(Boolean);
  const [seg, id, sub] = parts;
  const method = req.method;

  const auth = await getAuth(req);
  if (!auth) return json({ error: "Not authenticated." }, { status: 401 });
  if (!auth.user.admin) return json({ error: "Not an admin account." }, { status: 403 });
  if (!mfaOk(auth)) return mfaRequiredResponse(auth);
  if (!hasApp(auth.user, "dms")) return json({ error: "This requires the Document Management app." }, { status: 403 });
  const me = auth.user;
  const st = portalStore(), files = portalFiles();

  const allCats = () => listJson<any>(st, "dmscat:");
  const allDocs = () => listJson<any>(st, "dmsdoc:");
  const getCat = async (cid: string) => (await st.get(`dmscat:${cid}`, { type: "json" })) as any;
  const getDoc = async (did: string) => (await st.get(`dmsdoc:${did}`, { type: "json" })) as any;
  const saveCat = (c: any) => st.setJSON(`dmscat:${c.id}`, c);
  const saveDoc = (d: any) => st.setJSON(`dmsdoc:${d.id}`, d);

  function descendants(cats: any[], cid: string) {
    const out: string[] = [];
    const walk = (p: string) => cats.filter((c) => c.parent_id === p).forEach((c) => { out.push(c.id); walk(c.id); });
    walk(cid);
    return out;
  }

  try {
    /* ------------------------------------------------------- categories */
    if (seg === "categories") {
      if (!id && method === "GET") {
        const [cats, docs] = await Promise.all([allCats(), allDocs()]);
        const counts: Record<string, number> = {};
        docs.forEach((d) => { const k = d.category_id || ""; counts[k] = (counts[k] || 0) + 1; });
        return json({
          categories: cats.map((c) => ({ ...c, document_count: counts[c.id] || 0 })).sort((a, b) => a.name.localeCompare(b.name)),
          totalDocuments: docs.length,
        });
      }
      if (!id && method === "POST") {
        const b = await readJson(req);
        const name = s(b.name);
        if (!name) return json({ error: "A name is required." }, { status: 400 });
        const parent_id = s(b.parent_id);
        if (parent_id && !(await getCat(parent_id))) return json({ error: "Parent category not found." }, { status: 400 });
        const c = { id: newId(), name, parent_id, created_by: me.id, created_at: nowIso() };
        await saveCat(c);
        return json({ ok: true, category: c });
      }
      const cat = id ? await getCat(id) : null;
      if (!cat) return json({ error: "Category not found." }, { status: 404 });
      if (method === "PATCH") {
        const b = await readJson(req);
        if ("name" in b) { const name = s(b.name); if (!name) return json({ error: "A name is required." }, { status: 400 }); cat.name = name; }
        if ("parent_id" in b) {
          const parent_id = s(b.parent_id);
          if (parent_id) {
            if (parent_id === cat.id) return json({ error: "A category can't be its own parent." }, { status: 400 });
            const cats = await allCats();
            if (descendants(cats, cat.id).includes(parent_id)) return json({ error: "Can't move a category inside its own subtree." }, { status: 400 });
            if (!cats.find((c) => c.id === parent_id)) return json({ error: "Parent category not found." }, { status: 400 });
          }
          cat.parent_id = parent_id;
        }
        await saveCat(cat);
        return json({ ok: true, category: cat });
      }
      if (method === "DELETE") {
        const strategy = url.searchParams.get("strategy") || "";
        const [cats, docs] = await Promise.all([allCats(), allDocs()]);
        const kids = cats.filter((c) => c.parent_id === cat.id);
        const own = docs.filter((d) => d.category_id === cat.id);
        const now = nowIso();
        if (strategy === "promote") {
          for (const k of kids) { k.parent_id = cat.parent_id || null; await saveCat(k); }
          for (const d of own) { d.category_id = cat.parent_id || null; d.updated_at = now; await saveDoc(d); }
        } else if (strategy === "cascade") {
          const subtree = [cat.id, ...descendants(cats, cat.id)];
          for (const d of docs.filter((x) => subtree.includes(x.category_id))) { d.category_id = null; d.updated_at = now; await saveDoc(d); }
          for (const cid of subtree.slice(1)) await st.delete(`dmscat:${cid}`).catch(() => {});
        } else if (kids.length || own.length) {
          return json({ error: "Category is not empty. Choose a strategy." }, { status: 400 });
        }
        await st.delete(`dmscat:${cat.id}`);
        return json({ ok: true });
      }
    }

    /* -------------------------------------------------------- documents */
    if (seg === "documents") {
      if (!id && method === "GET") {
        let docs = await allDocs();
        const categoryId = url.searchParams.get("category");
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        if (categoryId) docs = docs.filter((d) => d.category_id === categoryId);
        if (url.searchParams.get("action") === "1") docs = docs.filter((d) => d.action_required);
        if (q) docs = docs.filter((d) => String(d.title || "").toLowerCase().includes(q) || String(d.description || "").toLowerCase().includes(q));
        docs.sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
        return json({ documents: docs.slice(0, 200) });
      }
      if (id === "move" && method === "POST") {
        const b = await readJson(req);
        const ids: string[] = Array.isArray(b.ids) ? b.ids : [];
        const target = s(b.category_id);
        if (target && !(await getCat(target))) return json({ error: "Target category not found." }, { status: 400 });
        for (const did of ids) { const d = await getDoc(did); if (d) { d.category_id = target; d.updated_at = nowIso(); await saveDoc(d); } }
        return json({ ok: true, moved: ids.length });
      }
      if (!id && method === "POST") {
        const b = await readJson(req);
        const d: any = { id: newId(), uploaded_by: me.id, uploaded_at: nowIso(), file_path: null, file_name: null, mime_type: null, file_size: null };
        const err = await applyDocFields(d, b);
        if (err) return json({ error: err }, { status: 400 });
        if (b.upload_id) { const e2 = await attach(d, b.upload_id); if (e2) return json({ error: e2 }, { status: 400 }); }
        await saveDoc(d);
        return json({ ok: true, document: d });
      }
      const d = id ? await getDoc(id) : null;
      if (!d) return json({ error: "Document not found." }, { status: 404 });
      if (!sub && method === "GET") return json({ document: d });
      if (sub === "file" && method === "GET") {
        if (!d.file_path) return json({ error: "No file attached." }, { status: 404 });
        return streamFile(files, d.file_path, { download: url.searchParams.get("download") === "1", fallbackName: d.file_name });
      }
      if (!sub && method === "PATCH") {
        const b = await readJson(req);
        const err = await applyDocFields(d, b);
        if (err) return json({ error: err }, { status: 400 });
        if (b.upload_id) { const e2 = await attach(d, b.upload_id); if (e2) return json({ error: e2 }, { status: 400 }); }
        await saveDoc(d);
        return json({ ok: true, document: d });
      }
      if (!sub && method === "DELETE") {
        if (d.file_path) await files.delete(d.file_path).catch(() => {});
        await st.delete(`dmsdoc:${d.id}`);
        return json({ ok: true });
      }
    }

    return json({ error: "Not found." }, { status: 404 });
  } catch (err: any) {
    return json({ error: err.message || String(err) }, { status: 500 });
  }

  async function applyDocFields(d: any, b: any): Promise<string | null> {
    if ("title" in b) { const t = s(b.title); if (!t) return "Title is required."; d.title = t; }
    if (!d.title) return "Title is required.";
    if ("description" in b) d.description = s(b.description);
    if ("related_party" in b) d.related_party = s(b.related_party);
    if ("doc_type" in b) d.doc_type = s(b.doc_type) || "other";
    if (!d.doc_type) d.doc_type = "other";
    if ("category_id" in b) {
      const cid = s(b.category_id);
      if (cid && !(await getCat(cid))) return "Category not found.";
      d.category_id = cid;
    }
    if ("action_required" in b) d.action_required = !!b.action_required;
    d.action_required = !!d.action_required;
    if ("action_due_date" in b) d.action_due_date = d.action_required ? s(b.action_due_date) : null;
    if ("action_note" in b) d.action_note = s(b.action_note);
    if ("action_status" in b) d.action_status = ACTION_STATUSES.includes(b.action_status) ? b.action_status : "pending";
    if (!d.action_required) d.action_status = "none";
    else if (!d.action_status || d.action_status === "none") d.action_status = "pending";
    d.updated_at = nowIso();
    return null;
  }

  async function attach(d: any, uploadId: string): Promise<string | null> {
    const key = `dms-files/${d.id}/${Date.now()}`;
    const f = await claimUpload(files, st, String(uploadId), me.id, key);
    if (!f) return "The uploaded file could not be found. Please attach it again.";
    const old = d.file_path;
    d.file_path = f.key; d.file_name = f.file_name; d.mime_type = f.mime_type; d.file_size = f.size;
    if (old && old !== f.key) await files.delete(old).catch(() => {});
    return null;
  }
};

export const config: Config = { path: "/api/portal/dms/*" };

// ============================================================================
// /api/hr/staff/*  — employee self-service API (cookie session)
// ============================================================================
import type { Config } from "@netlify/functions";
import {
  json, readJson, nowIso, newId, workingDays,
  getEmployeeByEmail, getSessionEmployee, saveEmployee, sanitizeEmployee,
  applyEmployeeFields, EMPLOYEE_SELF_FIELDS,
  hashPassword, verifyPassword, createSession, destroySession, destroyAllSessionsFor,
  sessionCookie, clearSessionCookie, loginThrottled, recordLoginFailure, clearLoginFailures,
  listVacation, getVacation, saveVacation, vacationBalance, VACATION_TYPES,
  listDocuments, getDocument, storeDocument, deleteDocument, fileResponse,
} from "./_lib/hr.mts";

export default async (req: Request) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/hr\/staff\/?/, "").split("/").filter(Boolean);
  const [seg, id, sub] = parts;
  const method = req.method;

  /* ---------------------------------------------------------------- login */
  if (seg === "login" && method === "POST") {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return json({ error: "Email and password are required." }, { status: 400 });
    if (await loginThrottled(email)) return json({ error: "Too many failed attempts. Try again in 15 minutes." }, { status: 429 });
    const emp = await getEmployeeByEmail(email);
    const ok = emp && emp.status !== "terminated" && (await verifyPassword(password, emp.password_hash));
    if (!ok) {
      await recordLoginFailure(email);
      return json({ error: "Access denied. The username or password you entered is incorrect." }, { status: 401 });
    }
    await clearLoginFailures(email);
    const token = await createSession(emp!.id);
    return json({ ok: true, must_change_password: emp!.must_change_password }, { headers: { "set-cookie": sessionCookie(token) } });
  }

  if (seg === "logout" && method === "POST") {
    await destroySession(req);
    return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
  }

  /* ------------------------------------------------ everything else: auth */
  const me = await getSessionEmployee(req);
  if (!me) return json({ error: "Not authenticated." }, { status: 401 });

  if (seg === "me" && method === "GET") {
    const reqs = await listVacation(me.id);
    return json({ employee: sanitizeEmployee(me), balance: vacationBalance(me, reqs) });
  }

  if (seg === "me" && method === "PATCH") {
    const body = await readJson(req);
    applyEmployeeFields(me, body, EMPLOYEE_SELF_FIELDS);
    await saveEmployee(me);
    return json({ employee: sanitizeEmployee(me) });
  }

  if (seg === "change-password" && method === "POST") {
    const body = await readJson(req);
    const pw = String(body.new_password || "");
    if (pw.length < 10) return json({ error: "Password must be at least 10 characters." }, { status: 400 });
    me.password_hash = await hashPassword(pw);
    me.must_change_password = false;
    me.updated_at = nowIso();
    await saveEmployee(me);
    // keep this session, drop any others
    return json({ ok: true });
  }

  /* -------------------------------------------------------------- time off */
  if (seg === "vacation" && !id && method === "GET") {
    const reqs = await listVacation(me.id);
    return json({ requests: reqs, balance: vacationBalance(me, reqs) });
  }

  if (seg === "vacation" && !id && method === "POST") {
    const body = await readJson(req);
    const type = VACATION_TYPES.includes(body.type) ? body.type : "vacation";
    const start = String(body.start_date || ""), end = String(body.end_date || "");
    const days = workingDays(start, end);
    if (!days) return json({ error: "Please choose a valid date range containing at least one working day." }, { status: 400 });
    const v = {
      id: newId(), employee_id: me.id, type, start_date: start, end_date: end, days,
      reason: String(body.reason || "").trim() || null, status: "pending" as const,
      reviewer_note: null, reviewed_at: null, created_by: "employee" as const, created_at: nowIso(),
    };
    await saveVacation(v);
    return json(v, { status: 201 });
  }

  if (seg === "vacation" && id && sub === "cancel" && method === "POST") {
    const v = await getVacation(me.id, id);
    if (!v) return json({ error: "Not found." }, { status: 404 });
    if (v.status !== "pending") return json({ error: "You can only cancel a request that is still pending." }, { status: 400 });
    v.status = "cancelled";
    await saveVacation(v);
    return json(v);
  }

  /* ------------------------------------------------------------- documents */
  if (seg === "documents" && !id && method === "GET") {
    return json({ documents: await listDocuments(me.id) });
  }

  if (seg === "documents" && !id && method === "POST") {
    try {
      const doc = await storeDocument(me.id, await readJson(req), "employee");
      return json(doc, { status: 201 });
    } catch (err: any) {
      return json({ error: err.message || "Upload failed." }, { status: 400 });
    }
  }

  if (seg === "documents" && id && sub === "file" && method === "GET") {
    const doc = await getDocument(me.id, id);
    if (!doc) return json({ error: "Not found." }, { status: 404 });
    return fileResponse(doc);
  }

  if (seg === "documents" && id && !sub && method === "DELETE") {
    const doc = await getDocument(me.id, id);
    if (!doc) return json({ error: "Not found." }, { status: 404 });
    if (doc.uploaded_by !== "employee") return json({ error: "Only HR can remove documents HR shared with you." }, { status: 403 });
    await deleteDocument(me.id, id);
    return json({ ok: true });
  }

  return json({ error: "Not found." }, { status: 404 });
};

export const config: Config = { path: "/api/hr/staff/*" };

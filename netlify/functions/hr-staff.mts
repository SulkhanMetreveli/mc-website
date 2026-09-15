// ============================================================================
// /api/hr/staff/*  — employee self-service API (cookie session)
// ============================================================================
import type { Config } from "@netlify/functions";
import {
  json, readJson, nowIso, newId, workingDays,
  getEmployeeByEmail, getSessionEmployee, saveEmployee, sanitizeEmployee,
  applyEmployeeFields, EMPLOYEE_SELF_FIELDS, isContractor, contractDaysLeft, validateBank,
  hashPassword, verifyPassword, createSession, destroySession, destroyAllSessionsFor, markSessionMfa,
  sessionCookie, clearSessionCookie, loginThrottled, recordLoginFailure, clearLoginFailures,
  MFA_GRACE_DAYS, newTotpSecret, totpMatch, otpauthUri, newRecoveryCode, normalizeRecovery, sha256Hex,
  mfaGraceActive, mfaSatisfied, deviceCookie, trustDevice, deviceTrusted, forgetDevices,
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
    const e = emp!;
    if (!e.mfa_grace_until) {
      e.mfa_grace_until = new Date(Date.now() + MFA_GRACE_DAYS * 86400000).toISOString();
      await saveEmployee(e);
    }
    const trusted = e.totp_enabled ? await deviceTrusted(req, e.id) : false;
    const token = await createSession(e.id, trusted);
    let mfa_status: string;
    if (e.totp_enabled) mfa_status = trusted ? "ok" : "code_required";
    else mfa_status = mfaGraceActive(e) ? "grace" : "enroll_required";
    return json({
      ok: true, must_change_password: e.must_change_password, mfa_status, grace_until: e.mfa_grace_until,
    }, { headers: { "set-cookie": sessionCookie(token) } });
  }

  if (seg === "logout" && method === "POST") {
    await destroySession(req);
    return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
  }

  /* ------------------------------------------------ everything else: auth */
  const me = await getSessionEmployee(req);
  if (!me) return json({ error: "Not authenticated." }, { status: 401 });
  const session = (me as any).__session;

  /* ------------------------------------------------------------ two-factor */
  if (seg === "mfa") {
    if (id === "status" && method === "GET") {
      return json({
        enabled: !!me.totp_enabled, session_mfa: !!session.mfa,
        grace_until: me.mfa_grace_until, grace_active: mfaGraceActive(me),
        recovery_codes_left: (me.recovery_code_hashes || []).length,
      });
    }
    if (id === "challenge" && method === "POST") {
      const body = await readJson(req);
      if (!me.totp_enabled) return json({ error: "Two-factor is not set up on this account." }, { status: 400 });
      const counter = totpMatch(me.totp_secret!, String(body.code || ""), me.totp_last_counter ?? null);
      if (counter === null) return json({ error: "That code is not correct. Codes change every 30 seconds — try the current one." }, { status: 401 });
      me.totp_last_counter = counter;
      await saveEmployee(me);
      await markSessionMfa(req);
      const headers: Record<string, string> = {};
      if (body.remember_device) headers["set-cookie"] = deviceCookie(await trustDevice(me.id));
      return json({ ok: true }, { headers });
    }
    if (id === "recover" && method === "POST") {
      const body = await readJson(req);
      const hash = await sha256Hex(normalizeRecovery(body.code));
      const list = me.recovery_code_hashes || [];
      if (!list.includes(hash)) return json({ error: "That recovery code is not valid." }, { status: 401 });
      // Recovery removes the authenticator so a new one can be set up; fresh grace window.
      me.recovery_code_hashes = [];
      me.totp_enabled = false; me.totp_secret = null; me.totp_pending_secret = null; me.totp_last_counter = null;
      me.mfa_grace_until = new Date(Date.now() + MFA_GRACE_DAYS * 86400000).toISOString();
      await saveEmployee(me);
      await forgetDevices(me.id);
      await markSessionMfa(req);
      return json({ ok: true, enroll_required: true });
    }
    if (id === "enroll" && !sub && method === "POST") {
      me.totp_pending_secret = newTotpSecret();
      await saveEmployee(me);
      return json({ secret: me.totp_pending_secret, uri: otpauthUri(me.totp_pending_secret, me.work_email) });
    }
    if (id === "enroll" && sub === "confirm" && method === "POST") {
      const body = await readJson(req);
      if (!me.totp_pending_secret) return json({ error: "Start set-up first." }, { status: 400 });
      const counter = totpMatch(me.totp_pending_secret, String(body.code || ""), null);
      if (counter === null) return json({ error: "That code is not correct. Make sure your authenticator shows the current 6-digit code and try again." }, { status: 401 });
      me.totp_secret = me.totp_pending_secret; me.totp_pending_secret = null;
      me.totp_enabled = true; me.totp_last_counter = counter;
      const codes = Array.from({ length: 8 }, newRecoveryCode);
      me.recovery_code_hashes = await Promise.all(codes.map((c) => sha256Hex(normalizeRecovery(c))));
      await saveEmployee(me);
      await markSessionMfa(req);
      const headers: Record<string, string> = {};
      if (body.remember_device) headers["set-cookie"] = deviceCookie(await trustDevice(me.id));
      return json({ ok: true, recovery_codes: codes }, { headers });
    }
    if (id === "recovery-codes" && method === "POST") {
      if (!session.mfa) return json({ error: "Complete two-factor sign-in first." }, { status: 403 });
      const codes = Array.from({ length: 8 }, newRecoveryCode);
      me.recovery_code_hashes = await Promise.all(codes.map((c) => sha256Hex(normalizeRecovery(c))));
      await saveEmployee(me);
      return json({ recovery_codes: codes });
    }
    return json({ error: "Not found." }, { status: 404 });
  }

  // Password changes are allowed before the second factor (first-login flow);
  // everything else waits until 2FA is satisfied or grace still applies.
  if (seg !== "change-password" && seg !== "logout" && !mfaSatisfied(me, session)) {
    return json({ error: "Two-factor authentication required.", mfa_required: true, enroll_required: !me.totp_enabled }, { status: 403 });
  }

  if (seg === "me" && method === "GET") {
    const reqs = await listVacation(me.id);
    return json({
      employee: sanitizeEmployee(me),
      balance: vacationBalance(me, reqs),
      is_contractor: isContractor(me),
      contract_days_left: contractDaysLeft(me),
      mfa: { enabled: !!me.totp_enabled, grace_until: me.mfa_grace_until, grace_active: mfaGraceActive(me) },
    });
  }

  if (seg === "me" && method === "PATCH") {
    const body = await readJson(req);
    applyEmployeeFields(me, body, EMPLOYEE_SELF_FIELDS);
    await saveEmployee(me);
    return json({ employee: sanitizeEmployee(me) });
  }

  /* ---------------------------------------------------------- bank details */
  if (seg === "bank" && !id && method === "POST") {
    const result = validateBank(await readJson(req), "employee");
    if (!result.ok) return json({ error: result.errors.join(" ") , errors: result.errors }, { status: 400 });
    me.bank_pending = { ...(result.bank as any), submitted_at: nowIso() };
    me.updated_at = nowIso();
    await saveEmployee(me);
    return json({ bank: me.bank || null, bank_pending: me.bank_pending });
  }

  if (seg === "bank" && id === "pending" && method === "DELETE") {
    me.bank_pending = null;
    me.updated_at = nowIso();
    await saveEmployee(me);
    return json({ ok: true });
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
    const contractor = isContractor(me);
    // Contractors don't request leave -- they post absence notices, which are
    // recorded immediately (no approval, no balance).
    const type = contractor ? "absence" : (VACATION_TYPES.includes(body.type) && body.type !== "absence" ? body.type : "vacation");
    const start = String(body.start_date || ""), end = String(body.end_date || "");
    const days = workingDays(start, end);
    if (!days) return json({ error: "Please choose a valid date range containing at least one working day." }, { status: 400 });
    const v = {
      id: newId(), employee_id: me.id, type, start_date: start, end_date: end, days,
      reason: String(body.reason || "").trim() || null,
      status: (contractor ? "approved" : "pending") as "approved" | "pending",
      reviewer_note: null, reviewed_at: contractor ? nowIso() : null,
      created_by: "employee" as const, created_at: nowIso(),
    };
    await saveVacation(v as any);
    return json(v, { status: 201 });
  }

  if (seg === "vacation" && id && sub === "cancel" && method === "POST") {
    const v = await getVacation(me.id, id);
    if (!v) return json({ error: "Not found." }, { status: 404 });
    if (isContractor(me)) {
      const today = nowIso().slice(0, 10);
      if (v.status !== "approved" || v.start_date < today) {
        return json({ error: "You can only withdraw an absence notice that hasn't started yet." }, { status: 400 });
      }
    } else if (v.status !== "pending") {
      return json({ error: "You can only cancel a request that is still pending." }, { status: 400 });
    }
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

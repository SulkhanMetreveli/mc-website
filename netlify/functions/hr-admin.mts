// ============================================================================
// /api/hr/admin/*  — HR administration API
// Caller must hold the 'hr' app in the company panel (verified via their
// Supabase access token; see requireHrAdmin).
// ============================================================================
import type { Config } from "@netlify/functions";
import {
  json, readJson, nowIso, newId, workingDays, randomPassword, hashPassword,
  requireHrAdmin, hrStore,
  getEmployee, getEmployeeByEmail, listEmployees, saveEmployee, sanitizeEmployee,
  applyEmployeeFields, EMPLOYEE_HR_FIELDS, purgeEmployee, destroyAllSessionsFor,
  listVacation, listAllVacation, getVacation, saveVacation, deleteVacation, vacationBalance, VACATION_TYPES,
  listDocuments, getDocument, storeDocument, deleteDocument, fileResponse,
} from "./_lib/hr.mts";

export default async (req: Request) => {
  if (!(await requireHrAdmin(req))) {
    return json({ error: "Not authorized. This requires the HR app (or Super Admin)." }, { status: 403 });
  }

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/hr\/admin\/?/, "").split("/").filter(Boolean);
  const [seg, id, sub, subId, subSub] = parts;
  const method = req.method;

  /* ------------------------------------------------------------- overview */
  if (seg === "overview" && method === "GET") {
    const [employees, all] = await Promise.all([listEmployees(), listAllVacation()]);
    const today = nowIso().slice(0, 10);
    const names: Record<string, string> = {};
    employees.forEach((e) => { names[e.id] = e.full_name; });
    const pending = all.filter((v) => v.status === "pending").sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((v) => ({ ...v, employee_name: names[v.employee_id] || v.employee_id }));
    const awayToday = new Set(all.filter((v) => v.status === "approved" && v.start_date <= today && v.end_date >= today).map((v) => v.employee_id)).size;
    return json({
      employees: employees.map(sanitizeEmployee),
      pending,
      stats: { active: employees.filter((e) => e.status === "active").length, away_today: awayToday, pending: pending.length },
    });
  }

  /* ------------------------------------------------------------ employees */
  if (seg === "employees" && !id && method === "GET") {
    return json({ employees: (await listEmployees()).map(sanitizeEmployee) });
  }

  if (seg === "employees" && !id && method === "POST") {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.full_name || "").trim();
    if (!email || !fullName) return json({ error: "Full name and work email are required." }, { status: 400 });
    if (await getEmployeeByEmail(email)) return json({ error: "An employee with this email already exists." }, { status: 400 });
    const requested = String(body.password || "").trim();
    if (requested && requested.length < 10) return json({ error: "Password must be at least 10 characters." }, { status: 400 });
    const password = requested || randomPassword();
    const now = nowIso();
    const e: any = {
      id: newId(), employee_number: null, full_name: fullName, work_email: email,
      personal_email: null, phone: null, date_of_birth: null, nationality: null,
      address_line1: null, address_line2: null, city: null, postal_code: null, country: null,
      emergency_contact_name: null, emergency_contact_phone: null, emergency_contact_relationship: null,
      job_title: null, department: null, employment_type: "full_time", start_date: null, end_date: null,
      status: "active", vacation_days_per_year: 25, must_change_password: true,
      password_hash: await hashPassword(password), created_at: now, updated_at: now,
    };
    applyEmployeeFields(e, body, ["employee_number", "job_title", "department", "start_date", "employment_type", "vacation_days_per_year"]);
    await saveEmployee(e);
    await hrStore().set(`email:${email}`, e.id);
    return json({ employee: sanitizeEmployee(e), email, password }, { status: 201 });
  }

  if (seg === "employees" && id) {
    const e = await getEmployee(id);
    if (!e) return json({ error: "Employee not found." }, { status: 404 });

    if (!sub && method === "GET") {
      const [reqs, docs] = await Promise.all([listVacation(id), listDocuments(id)]);
      return json({ employee: sanitizeEmployee(e), vacation: reqs, documents: docs, balance: vacationBalance(e, reqs) });
    }

    if (!sub && method === "PATCH") {
      const body = await readJson(req);
      const oldEmail = e.work_email.toLowerCase();
      applyEmployeeFields(e, body, EMPLOYEE_HR_FIELDS);
      const newEmail = e.work_email.toLowerCase();
      if (newEmail !== oldEmail) {
        if (await getEmployeeByEmail(newEmail)) return json({ error: "Another employee already uses that email." }, { status: 400 });
        await hrStore().delete(`email:${oldEmail}`);
        await hrStore().set(`email:${newEmail}`, e.id);
      }
      await saveEmployee(e);
      return json({ employee: sanitizeEmployee(e) });
    }

    if (!sub && method === "DELETE") {
      await purgeEmployee(e);
      return json({ ok: true });
    }

    if (sub === "reset-password" && method === "POST") {
      const password = randomPassword();
      e.password_hash = await hashPassword(password);
      e.must_change_password = true;
      e.updated_at = nowIso();
      await saveEmployee(e);
      await destroyAllSessionsFor(e.id);
      return json({ password });
    }

    if (sub === "vacation" && !subId && method === "POST") {
      const body = await readJson(req);
      const type = VACATION_TYPES.includes(body.type) ? body.type : "vacation";
      const start = String(body.start_date || ""), end = String(body.end_date || "");
      const days = workingDays(start, end);
      if (!days) return json({ error: "Please choose a valid date range containing at least one working day." }, { status: 400 });
      const status = body.status === "pending" ? "pending" : "approved";
      const v = {
        id: newId(), employee_id: id, type, start_date: start, end_date: end, days,
        reason: String(body.reason || "").trim() || null, status,
        reviewer_note: null, reviewed_at: status === "approved" ? nowIso() : null,
        created_by: "hr" as const, created_at: nowIso(),
      };
      await saveVacation(v as any);
      return json(v, { status: 201 });
    }

    if (sub === "vacation" && subId && method === "PATCH") {
      const v = await getVacation(id, subId);
      if (!v) return json({ error: "Request not found." }, { status: 404 });
      const body = await readJson(req);
      if (["pending", "approved", "rejected", "cancelled"].includes(body.status)) {
        v.status = body.status;
        v.reviewed_at = body.status === "pending" ? null : nowIso();
      }
      if ("reviewer_note" in body) v.reviewer_note = String(body.reviewer_note || "").trim() || null;
      await saveVacation(v);
      return json(v);
    }

    if (sub === "vacation" && subId && method === "DELETE") {
      await deleteVacation(id, subId);
      return json({ ok: true });
    }

    if (sub === "documents" && !subId && method === "POST") {
      try {
        const doc = await storeDocument(id, await readJson(req), "hr");
        return json(doc, { status: 201 });
      } catch (err: any) {
        return json({ error: err.message || "Upload failed." }, { status: 400 });
      }
    }

    if (sub === "documents" && subId && subSub === "file" && method === "GET") {
      const doc = await getDocument(id, subId);
      if (!doc) return json({ error: "Not found." }, { status: 404 });
      return fileResponse(doc);
    }

    if (sub === "documents" && subId && !subSub && method === "DELETE") {
      await deleteDocument(id, subId);
      return json({ ok: true });
    }
  }

  return json({ error: "Not found." }, { status: 404 });
};

export const config: Config = { path: "/api/hr/admin/*" };

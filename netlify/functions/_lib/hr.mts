// ============================================================================
// Met Capital HR app — shared library for the Netlify Functions.
//
// Storage: Netlify Blobs only.
//   store "hr"        -> JSON records (employees, sessions, time off, doc metadata)
//   store "hr-files"  -> raw file bytes for employee documents
//
// Auth:
//   * Employees  -> own accounts (bcrypt password hash in their record) with an
//                   HttpOnly session cookie, same pattern as the metreveli.org
//                   intranet.
//   * HR admins  -> the company-panel login. The browser sends its Supabase
//                   access token; we ask Supabase "does this user hold the hr
//                   app?" and nothing else. No HR data ever lives in Supabase.
// ============================================================================
import { getStore, getDeployStore } from "@netlify/blobs";
import bcrypt from "bcryptjs";

const SUPABASE_URL = "https://qnysvjbqltnwkjkvjwov.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_GSi7RBnzm4npqyJgOR_vtg_ZZJ4lmnb";

export const SESSION_COOKIE = "mc_staff_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const MAX_FILE_BYTES = 4 * 1024 * 1024; // one synchronous function request (base64) fits ~4MB

/* ---------------------------------------------------------------- stores -- */
function isProduction() {
  return (globalThis as any).Netlify?.context?.deploy?.context === "production";
}
export function hrStore() {
  return isProduction()
    ? getStore({ name: "hr", consistency: "strong" })
    : getDeployStore({ name: "hr", consistency: "strong" });
}
export function filesStore() {
  return isProduction()
    ? getStore({ name: "hr-files", consistency: "strong" })
    : getDeployStore({ name: "hr-files", consistency: "strong" });
}

/* --------------------------------------------------------------- helpers -- */
export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function newId() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

export async function readJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

export function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const arr = new Uint8Array(14);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => alphabet[b % alphabet.length]).join("") + "!1";
}

export async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(pw: string) { return bcrypt.hash(pw, 11); }
export async function verifyPassword(pw: string, hash: string) { return bcrypt.compare(pw, hash); }

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  (req.headers.get("cookie") || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}
export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

// Working days between two ISO dates, inclusive, excluding weekends.
export function workingDays(start: string, end: string) {
  const s = new Date(start + "T00:00:00Z"), e = new Date(end + "T00:00:00Z");
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
  let n = 0;
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

/* ------------------------------------------------------------- employees -- */
export type Employee = {
  id: string;
  employee_number: string | null;
  full_name: string;
  work_email: string;
  personal_email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  job_title: string | null;
  department: string | null;
  employment_type: "full_time" | "part_time" | "contractor" | "intern";
  start_date: string | null;
  end_date: string | null;
  status: "active" | "on_leave" | "terminated";
  vacation_days_per_year: number;
  must_change_password: boolean;
  password_hash: string;
  created_at: string;
  updated_at: string;
};

export const EMPLOYEE_SELF_FIELDS = [
  "personal_email", "phone", "date_of_birth", "nationality",
  "address_line1", "address_line2", "city", "postal_code", "country",
  "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relationship",
];
export const EMPLOYEE_HR_FIELDS = [
  ...EMPLOYEE_SELF_FIELDS,
  "employee_number", "full_name", "work_email", "job_title", "department",
  "employment_type", "start_date", "end_date", "status", "vacation_days_per_year",
];
const EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor", "intern"];
const STATUSES = ["active", "on_leave", "terminated"];

export function sanitizeEmployee(e: Employee) {
  const { password_hash, ...rest } = e;
  return rest;
}

export async function getEmployee(id: string): Promise<Employee | null> {
  if (!id) return null;
  return (await hrStore().get(`employee:${id}`, { type: "json" })) as Employee | null;
}

export async function getEmployeeByEmail(email: string): Promise<Employee | null> {
  const id = await hrStore().get(`email:${email.trim().toLowerCase()}`, { type: "text" });
  return id ? getEmployee(id) : null;
}

export async function listEmployees(): Promise<Employee[]> {
  const store = hrStore();
  const listed = await store.list({ prefix: "employee:" });
  const out = await Promise.all((listed.blobs || []).map((b: any) => store.get(b.key, { type: "json" })));
  return (out.filter(Boolean) as Employee[]).sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function saveEmployee(e: Employee) {
  await hrStore().setJSON(`employee:${e.id}`, e);
}

// Apply a partial update, restricted to an allow-list of fields, with light validation.
export function applyEmployeeFields(e: Employee, body: any, allowed: string[]) {
  for (const f of allowed) {
    if (!(f in body)) continue;
    let v = body[f];
    if (typeof v === "string") v = v.trim() || null;
    if (f === "employment_type" && !EMPLOYMENT_TYPES.includes(v)) continue;
    if (f === "status" && !STATUSES.includes(v)) continue;
    if (f === "vacation_days_per_year") { v = Number(v); if (!Number.isFinite(v) || v < 0) continue; }
    if ((f === "full_name" || f === "work_email") && !v) continue;
    (e as any)[f] = v;
  }
  e.updated_at = nowIso();
}

/* -------------------------------------------------------------- sessions -- */
export async function createSession(employeeId: string) {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  await hrStore().setJSON(`session:${hash}`, {
    employee_id: employeeId,
    expires_at: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
  });
  return token;
}

export async function getSessionEmployee(req: Request): Promise<Employee | null> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const hash = await sha256Hex(token);
  const sess = (await hrStore().get(`session:${hash}`, { type: "json" })) as any;
  if (!sess || new Date(sess.expires_at) < new Date()) return null;
  const emp = await getEmployee(sess.employee_id);
  if (!emp || emp.status === "terminated") return null;
  return emp;
}

export async function destroySession(req: Request) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return;
  await hrStore().delete(`session:${await sha256Hex(token)}`);
}

export async function destroyAllSessionsFor(employeeId: string) {
  const store = hrStore();
  const listed = await store.list({ prefix: "session:" });
  for (const b of listed.blobs || []) {
    const s = (await store.get(b.key, { type: "json" })) as any;
    if (s && s.employee_id === employeeId) await store.delete(b.key);
  }
}

// Simple login throttle: 5 failures per email per 15 minutes.
export async function loginThrottled(email: string) {
  const rec = (await hrStore().get(`loginfail:${email}`, { type: "json" })) as any;
  if (!rec) return false;
  if (Date.now() - new Date(rec.first_at).getTime() > 15 * 60 * 1000) return false;
  return rec.count >= 5;
}
export async function recordLoginFailure(email: string) {
  const key = `loginfail:${email}`;
  const rec = (await hrStore().get(key, { type: "json" })) as any;
  if (!rec || Date.now() - new Date(rec.first_at).getTime() > 15 * 60 * 1000) {
    await hrStore().setJSON(key, { count: 1, first_at: nowIso() });
  } else {
    await hrStore().setJSON(key, { count: rec.count + 1, first_at: rec.first_at });
  }
}
export async function clearLoginFailures(email: string) {
  await hrStore().delete(`loginfail:${email}`);
}

/* ----------------------------------------------------------- HR admin auth -- */
// Verifies the caller holds the 'hr' app in the company panel by asking
// Supabase with the caller's own token. That's the only Supabase call in
// this app, and it's auth-only.
export async function requireHrAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/has_app_access`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ app: "hr" }),
    });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------- time off -- */
export type VacationRequest = {
  id: string;
  employee_id: string;
  type: "vacation" | "sick" | "unpaid" | "other";
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewer_note: string | null;
  reviewed_at: string | null;
  created_by: "employee" | "hr";
  created_at: string;
};
export const VACATION_TYPES = ["vacation", "sick", "unpaid", "other"];

export async function listVacation(employeeId: string): Promise<VacationRequest[]> {
  const store = hrStore();
  const listed = await store.list({ prefix: `vacation:${employeeId}:` });
  const out = await Promise.all((listed.blobs || []).map((b: any) => store.get(b.key, { type: "json" })));
  return (out.filter(Boolean) as VacationRequest[]).sort((a, b) => b.start_date.localeCompare(a.start_date));
}
export async function listAllVacation(): Promise<VacationRequest[]> {
  const store = hrStore();
  const listed = await store.list({ prefix: "vacation:" });
  const out = await Promise.all((listed.blobs || []).map((b: any) => store.get(b.key, { type: "json" })));
  return out.filter(Boolean) as VacationRequest[];
}
export async function getVacation(employeeId: string, id: string): Promise<VacationRequest | null> {
  return (await hrStore().get(`vacation:${employeeId}:${id}`, { type: "json" })) as VacationRequest | null;
}
export async function saveVacation(v: VacationRequest) {
  await hrStore().setJSON(`vacation:${v.employee_id}:${v.id}`, v);
}
export async function deleteVacation(employeeId: string, id: string) {
  await hrStore().delete(`vacation:${employeeId}:${id}`);
}
export function vacationBalance(e: Employee, reqs: VacationRequest[], year = new Date().getFullYear()) {
  const used = reqs
    .filter((r) => r.status === "approved" && r.type === "vacation" && r.start_date.slice(0, 4) === String(year))
    .reduce((s, r) => s + Number(r.days || 0), 0);
  const allowance = Number(e.vacation_days_per_year || 0);
  return { year, allowance, used, remaining: allowance - used };
}

/* ------------------------------------------------------------- documents -- */
export type EmployeeDocument = {
  id: string;
  employee_id: string;
  title: string;
  category: "contract" | "id" | "payslip" | "certificate" | "policy" | "other";
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_by: "employee" | "hr";
  uploaded_at: string;
};
export const DOC_CATEGORIES = ["contract", "id", "payslip", "certificate", "policy", "other"];

export async function listDocuments(employeeId: string): Promise<EmployeeDocument[]> {
  const store = hrStore();
  const listed = await store.list({ prefix: `doc:${employeeId}:` });
  const out = await Promise.all((listed.blobs || []).map((b: any) => store.get(b.key, { type: "json" })));
  return (out.filter(Boolean) as EmployeeDocument[]).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
}
export async function getDocument(employeeId: string, id: string): Promise<EmployeeDocument | null> {
  return (await hrStore().get(`doc:${employeeId}:${id}`, { type: "json" })) as EmployeeDocument | null;
}

function decodeBase64(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// body: { title, category, file_name, mime_type, data_base64 }
export async function storeDocument(employeeId: string, body: any, uploadedBy: "employee" | "hr") {
  const title = String(body.title || "").trim();
  const fileName = String(body.file_name || "").trim();
  const b64 = String(body.data_base64 || "");
  if (!title || !fileName || !b64) throw new Error("Title, file name and file data are required.");
  const bytes = decodeBase64(b64);
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`File is too large. Maximum is ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB.`);
  const category = DOC_CATEGORIES.includes(body.category) ? body.category : "other";
  const doc: EmployeeDocument = {
    id: newId(),
    employee_id: employeeId,
    title,
    category,
    file_name: fileName,
    mime_type: String(body.mime_type || "application/octet-stream"),
    file_size: bytes.byteLength,
    uploaded_by: uploadedBy,
    uploaded_at: nowIso(),
  };
  await filesStore().set(`${employeeId}/${doc.id}`, bytes);
  await hrStore().setJSON(`doc:${employeeId}:${doc.id}`, doc);
  return doc;
}

export async function deleteDocument(employeeId: string, id: string) {
  await filesStore().delete(`${employeeId}/${id}`).catch(() => {});
  await hrStore().delete(`doc:${employeeId}:${id}`);
}

export async function fileResponse(doc: EmployeeDocument) {
  const bytes = await filesStore().get(`${doc.employee_id}/${doc.id}`, { type: "arrayBuffer" });
  if (!bytes) return json({ error: "File not found in storage." }, { status: 404 });
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": doc.mime_type || "application/octet-stream",
      "content-disposition": `attachment; filename="${doc.file_name.replace(/"/g, "")}"`,
      "cache-control": "private, no-store",
    },
  });
}

// Remove everything belonging to an employee (used on delete).
export async function purgeEmployee(e: Employee) {
  const store = hrStore();
  for (const d of await listDocuments(e.id)) await deleteDocument(e.id, d.id);
  for (const v of await listVacation(e.id)) await deleteVacation(e.id, v.id);
  await destroyAllSessionsFor(e.id);
  await store.delete(`email:${e.work_email.toLowerCase()}`);
  await store.delete(`employee:${e.id}`);
}

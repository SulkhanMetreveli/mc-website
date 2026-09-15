// ============================================================================
// Met Capital — client portal + company panel data layer (Netlify Blobs)
//
// Stores
//   portal        JSON records:  user:<id>  email:<email>  client:<uid>
//                 vehicle:<uid>:<id>  document:<uid>:<id>  withdrawal:<uid>:<id>
//                 addrreq:<uid>:<id>  onboarding:<uid>:<id>  docsub:<uid>:<id>
//                 gendoc:<uid>:<id>  dmscat:<id>  dmsdoc:<id>
//                 session:<hash>  device:<hash>  loginfail:<email>  upload:<id>
//   portal-files  binary files:  client-documents/<uid>/…  kyc-files/<uid>/…
//                 dms-files/<docid>/…  uploads/<id>/…
//
// One login (user record) can be a client (has a client:<uid> profile), an
// admin (user.admin set), or both. Sessions are HttpOnly cookies; the
// session carries an `mfa` flag once the second factor has been passed.
// ============================================================================
import {
  store, listJson, json, newId, nowIso, randomToken, sha256Hex, parseCookies, cookie,
  DEVICE_TTL_SECONDS, MfaFields, mfaSatisfied,
} from "./common.mts";

export const SESSION_COOKIE = "mc_session";
export const DEVICE_COOKIE = "mc_device";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const APP_KEYS = ["client_dashboard", "operations", "sales", "dms", "hr"];

export function portalStore() { return store("portal"); }
export function portalFiles() { return store("portal-files"); }

/* ----------------------------------------------------------------- users -- */
export type AdminGrant = { full_name: string; role: "super_admin" | "admin"; apps: string[]; created_at: string };
export type User = MfaFields & {
  id: string;
  email: string;
  password_hash: string;
  must_change_password: boolean;
  admin: AdminGrant | null;
  is_client: boolean;
  created_at: string;
  updated_at?: string;
};

export async function getUser(id: string): Promise<User | null> {
  if (!id) return null;
  return (await portalStore().get(`user:${id}`, { type: "json" })) as User | null;
}
export async function getUserByEmail(email: string): Promise<User | null> {
  const id = await portalStore().get(`email:${email.trim().toLowerCase()}`, { type: "text" });
  return id ? getUser(id) : null;
}
export async function saveUser(u: User) {
  u.updated_at = nowIso();
  await portalStore().setJSON(`user:${u.id}`, u);
}
export async function createUser(fields: { email: string; password_hash: string; must_change_password?: boolean; admin?: AdminGrant | null; is_client?: boolean; id?: string; created_at?: string }) {
  const email = fields.email.trim().toLowerCase();
  const u: User = {
    id: fields.id || newId(), email, password_hash: fields.password_hash,
    must_change_password: fields.must_change_password !== false,
    admin: fields.admin || null, is_client: !!fields.is_client,
    created_at: fields.created_at || nowIso(),
  };
  await portalStore().setJSON(`user:${u.id}`, u);
  await portalStore().set(`email:${email}`, u.id);
  return u;
}
export async function listUsers(): Promise<User[]> {
  return listJson<User>(portalStore(), "user:");
}
export function isSuperAdmin(u: User | null) { return !!(u && u.admin && u.admin.role === "super_admin"); }
export function hasApp(u: User | null, app: string) {
  if (!u || !u.admin) return false;
  if (u.admin.role === "super_admin") return true;
  return (u.admin.apps || []).includes(app);
}
export function publicUser(u: User) {
  return { id: u.id, email: u.email, must_change_password: !!u.must_change_password, is_client: !!u.is_client, admin: u.admin ? { ...u.admin } : null, created_at: u.created_at };
}

/* -------------------------------------------------------------- sessions -- */
export async function createSession(userId: string, mfa: boolean) {
  const token = randomToken(32);
  await portalStore().setJSON(`session:${await sha256Hex(token)}`, {
    user_id: userId, mfa, expires_at: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
  });
  return token;
}
export function sessionCookie(token: string) { return cookie(SESSION_COOKIE, token, SESSION_TTL_SECONDS); }
export function clearSessionCookie() { return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }

export async function getSessionRecord(req: Request): Promise<{ key: string; sess: any } | null> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const key = `session:${await sha256Hex(token)}`;
  const sess = (await portalStore().get(key, { type: "json" })) as any;
  if (!sess || new Date(sess.expires_at) < new Date()) return null;
  return { key, sess };
}
export async function markSessionMfa(req: Request) {
  const rec = await getSessionRecord(req);
  if (!rec) return;
  rec.sess.mfa = true;
  await portalStore().setJSON(rec.key, rec.sess);
}
export async function destroySession(req: Request) {
  const rec = await getSessionRecord(req);
  if (rec) await portalStore().delete(rec.key).catch(() => {});
}
export async function destroyAllSessionsFor(userId: string) {
  const st = portalStore();
  const listed = await st.list({ prefix: "session:" });
  for (const b of listed.blobs || []) {
    const s = (await st.get(b.key, { type: "json" })) as any;
    if (s && s.user_id === userId) await st.delete(b.key);
  }
}

// Current user + session, or null. Does NOT enforce MFA — callers decide.
export type Auth = { user: User; session: any };
export async function getAuth(req: Request): Promise<Auth | null> {
  const rec = await getSessionRecord(req);
  if (!rec) return null;
  const user = await getUser(rec.sess.user_id);
  if (!user) return null;
  return { user, session: rec.sess };
}
export function mfaOk(a: Auth) { return mfaSatisfied(a.user, a.session); }
export function mfaRequiredResponse(a: Auth) {
  return json({ error: "Two-factor authentication required.", mfa_required: true, enroll_required: !a.user.totp_enabled }, { status: 403 });
}

/* ------------------------------------------------------ remembered devices -- */
export async function trustDevice(userId: string) {
  const token = randomToken(32);
  await portalStore().setJSON(`device:${await sha256Hex(token)}`, {
    user_id: userId, expires_at: new Date(Date.now() + DEVICE_TTL_SECONDS * 1000).toISOString(),
  });
  return cookie(DEVICE_COOKIE, token, DEVICE_TTL_SECONDS);
}
export async function deviceTrusted(req: Request, userId: string) {
  const token = parseCookies(req)[DEVICE_COOKIE];
  if (!token) return false;
  const d = (await portalStore().get(`device:${await sha256Hex(token)}`, { type: "json" })) as any;
  return !!d && d.user_id === userId && new Date(d.expires_at) > new Date();
}
export async function forgetDevices(userId: string) {
  const st = portalStore();
  const listed = await st.list({ prefix: "device:" });
  for (const b of listed.blobs || []) {
    const d = (await st.get(b.key, { type: "json" })) as any;
    if (d && d.user_id === userId) await st.delete(b.key);
  }
}

/* --------------------------------------------------------------- records -- */
// Generic per-user record helpers: key = `${kind}:${uid}:${id}`.
export async function getRecord<T = any>(kind: string, uid: string, id: string): Promise<T | null> {
  return (await portalStore().get(`${kind}:${uid}:${id}`, { type: "json" })) as T | null;
}
export async function saveRecord(kind: string, rec: any) {
  await portalStore().setJSON(`${kind}:${rec.user_id}:${rec.id}`, rec);
}
export async function deleteRecord(kind: string, uid: string, id: string) {
  await portalStore().delete(`${kind}:${uid}:${id}`).catch(() => {});
}
export async function listRecords<T = any>(kind: string, uid?: string): Promise<T[]> {
  return listJson<T>(portalStore(), uid ? `${kind}:${uid}:` : `${kind}:`);
}
export function byDateDesc(field: string) {
  return (a: any, b: any) => String(b[field] || "").localeCompare(String(a[field] || ""));
}

/* ------------------------------------------------------- client profiles -- */
export const CLIENT_PROFILE_FIELDS = [
  "client_reference", "full_name", "email", "status",
  "address_line1", "address_line2", "city", "state_province", "postal_code", "country",
  "phone_number", "bank_account_holder_name", "bank_name", "bank_account_number", "bank_swift_bic", "bank_country",
];
export type ClientProfile = { user_id: string; full_name: string; email: string; status: string; created_at: string; [k: string]: any };

export async function getClient(uid: string): Promise<ClientProfile | null> {
  return (await portalStore().get(`client:${uid}`, { type: "json" })) as ClientProfile | null;
}
export async function saveClient(p: ClientProfile) {
  await portalStore().setJSON(`client:${p.user_id}`, p);
}
export async function listClients(): Promise<ClientProfile[]> {
  return listJson<ClientProfile>(portalStore(), "client:");
}

// The request statuses used across every review workflow.
export const REVIEW_STATUSES = ["pending", "in_transit_documents_review", "approved", "rejected"];
export const VEHICLE_STATUSES = [
  "active", "on_hold", "liquidating", "withdrawing", "in_transfer_awaiting_client",
  "in_transfer", "in_transit_documents_review", "liquidated", "rejected",
];
export const DOC_CATEGORIES = ["statement", "tax", "agreement", "passport", "proof_of_address", "other"];

/* ----------------------------------------------------------- file access -- */
// Who may read a stored file, decided purely from its key.
export function canReadFile(user: User, key: string) {
  const [bucket, owner] = key.split("/");
  if (bucket === "client-documents" || bucket === "kyc-files") {
    if (user.is_client && owner === user.id) return true;
    return hasApp(user, "client_dashboard");
  }
  if (bucket === "dms-files") return hasApp(user, "dms");
  return false;
}

// ============================================================================
// Met Capital — shared server helpers for every Netlify Function
// (client portal, company panel, DMS, HR). No database: everything runs on
// Netlify Blobs. Nothing in here touches the network.
// ============================================================================
import { getStore, getDeployStore } from "@netlify/blobs";
import bcrypt from "bcryptjs";
import { createHmac, timingSafeEqual } from "node:crypto";

/* ---------------------------------------------------------------- stores -- */
export function isProduction() {
  return (globalThis as any).Netlify?.context?.deploy?.context === "production";
}
export function store(name: string) {
  return isProduction()
    ? getStore({ name, consistency: "strong" })
    : getDeployStore({ name, consistency: "strong" });
}

// List every JSON blob under a prefix (parallel reads in small batches).
export async function listJson<T = any>(st: any, prefix: string): Promise<T[]> {
  const listed = await st.list({ prefix });
  const keys: string[] = (listed.blobs || []).map((b: any) => b.key);
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += 25) {
    const batch = await Promise.all(keys.slice(i, i + 25).map((k) => st.get(k, { type: "json" })));
    for (const v of batch) if (v) out.push(v as T);
  }
  return out;
}

/* --------------------------------------------------------------- helpers -- */
export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}
export function newId() { return crypto.randomUUID(); }
export function nowIso() { return new Date().toISOString(); }
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
export async function verifyPassword(pw: string, hash: string) {
  if (!hash) return false;
  try { return await bcrypt.compare(pw, hash); } catch { return false; }
}
export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  (req.headers.get("cookie") || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
export function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function safeFileName(name: string) {
  return String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150);
}
export function decodeBase64(b64: string) {
  const bin = atob(b64.replace(/^data:[^,]*,/, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
export function contentTypeFor(name: string, fallback = "application/octet-stream") {
  const ext = String(name || "").toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", txt: "text/plain", csv: "text/csv", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    zip: "application/zip",
  };
  return map[ext] || fallback;
}

/* ------------------------------------------------------- login throttle -- */
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export async function loginThrottled(st: any, email: string) {
  const rec = (await st.get(`loginfail:${email}`, { type: "json" })) as any;
  if (!rec) return false;
  if (Date.now() - new Date(rec.first_at).getTime() > LOGIN_WINDOW_MS) return false;
  return rec.count >= LOGIN_MAX_FAILURES;
}
export async function recordLoginFailure(st: any, email: string) {
  const rec = (await st.get(`loginfail:${email}`, { type: "json" })) as any;
  const fresh = !rec || Date.now() - new Date(rec.first_at).getTime() > LOGIN_WINDOW_MS;
  await st.setJSON(`loginfail:${email}`, { count: fresh ? 1 : rec.count + 1, first_at: fresh ? nowIso() : rec.first_at });
}
export async function clearLoginFailures(st: any, email: string) {
  await st.delete(`loginfail:${email}`).catch(() => {});
}

/* ------------------------------------------------------- two-factor (TOTP) -- */
// RFC 6238, 6 digits, 30-second steps, ±1 step tolerance, replay guard.
export const MFA_GRACE_DAYS = 7;
export const DEVICE_TTL_SECONDS = 7 * 24 * 60 * 60;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string) {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(out);
}
export function newTotpSecret() {
  const b = new Uint8Array(20); crypto.getRandomValues(b);
  return base32Encode(b);
}
function hotp(secret: Uint8Array, counter: number) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", Buffer.from(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1_000_000).padStart(6, "0");
}
// Returns the matching time-step counter, or null.
export function totpMatch(secretB32: string, code: string, lastCounter: number | null): number | null {
  const c = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const secret = base32Decode(secretB32);
  const now = Math.floor(Date.now() / 1000 / 30);
  for (const d of [0, -1, 1]) {
    const counter = now + d;
    if (lastCounter !== null && counter <= lastCounter) continue;
    const expected = Buffer.from(hotp(secret, counter));
    if (expected.length === c.length && timingSafeEqual(expected, Buffer.from(c))) return counter;
  }
  return null;
}
export function otpauthUri(issuer: string, secretB32: string, account: string) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
export function newRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint8Array(10); crypto.getRandomValues(a);
  const s = Array.from(a, (b) => alphabet[b % alphabet.length]).join("");
  return s.slice(0, 5) + "-" + s.slice(5);
}
export function normalizeRecovery(code: string) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// The MFA fields shared by every kind of account (client, admin, staff).
export type MfaFields = {
  totp_enabled?: boolean;
  totp_secret?: string | null;
  totp_pending_secret?: string | null;
  totp_last_counter?: number | null;
  recovery_code_hashes?: string[];
  mfa_grace_until?: string | null;
};
export function mfaGraceActive(a: MfaFields) {
  if (!a.mfa_grace_until) return true;
  return new Date(a.mfa_grace_until) > new Date();
}
export function mfaSatisfied(a: MfaFields, session: any) {
  if (session && session.mfa) return true;
  return !a.totp_enabled && mfaGraceActive(a);
}
export function mfaStatusFor(a: MfaFields, trusted: boolean) {
  if (a.totp_enabled) return trusted ? "ok" : "code_required";
  return mfaGraceActive(a) ? "grace" : "enroll_required";
}
export function freshGrace() {
  return new Date(Date.now() + MFA_GRACE_DAYS * 86400000).toISOString();
}
export function clearMfa(a: MfaFields) {
  a.totp_enabled = false; a.totp_secret = null; a.totp_pending_secret = null; a.totp_last_counter = null;
  a.recovery_code_hashes = [];
  a.mfa_grace_until = freshGrace();
}
export async function issueRecoveryCodes(a: MfaFields) {
  const codes = Array.from({ length: 8 }, newRecoveryCode);
  a.recovery_code_hashes = await Promise.all(codes.map((c) => sha256Hex(normalizeRecovery(c))));
  return codes;
}
export function mfaSummary(a: MfaFields, session: any) {
  return {
    enabled: !!a.totp_enabled, session_mfa: !!(session && session.mfa),
    grace_until: a.mfa_grace_until || null, grace_active: mfaGraceActive(a),
    recovery_codes_left: (a.recovery_code_hashes || []).length,
  };
}

// Generic MFA endpoint handler, shared by the staff portal and the client /
// company portals. `save` persists the account; `markSession` flips the
// session's mfa flag; `trust`/`forget` manage remembered devices.
export async function handleMfa(opts: {
  action: string; sub: string | undefined; method: string; body: any;
  account: MfaFields & { id: string }; accountLabel: string; issuer: string; session: any;
  save: () => Promise<void>; markSession: () => Promise<void>;
  trust: () => Promise<string>; forget: () => Promise<void>;
}) {
  const { action, sub, method, body, account: a, session } = opts;
  if (action === "status" && method === "GET") return json(mfaSummary(a, session));
  if (action === "challenge" && method === "POST") {
    if (!a.totp_enabled) return json({ error: "Two-factor is not set up on this account." }, { status: 400 });
    const counter = totpMatch(a.totp_secret!, String(body.code || ""), a.totp_last_counter ?? null);
    if (counter === null) return json({ error: "That code is not correct. Codes change every 30 seconds — try the current one." }, { status: 401 });
    a.totp_last_counter = counter;
    await opts.save();
    await opts.markSession();
    const headers: Record<string, string> = {};
    if (body.remember_device) headers["set-cookie"] = await opts.trust();
    return json({ ok: true }, { headers });
  }
  if (action === "recover" && method === "POST") {
    const hash = await sha256Hex(normalizeRecovery(body.code));
    if (!(a.recovery_code_hashes || []).includes(hash)) return json({ error: "That recovery code is not valid." }, { status: 401 });
    clearMfa(a);
    await opts.save();
    await opts.forget();
    await opts.markSession();
    return json({ ok: true, enroll_required: true });
  }
  if (action === "enroll" && !sub && method === "POST") {
    a.totp_pending_secret = newTotpSecret();
    await opts.save();
    return json({ secret: a.totp_pending_secret, uri: otpauthUri(opts.issuer, a.totp_pending_secret, opts.accountLabel) });
  }
  if (action === "enroll" && sub === "confirm" && method === "POST") {
    if (!a.totp_pending_secret) return json({ error: "Start set-up first." }, { status: 400 });
    const counter = totpMatch(a.totp_pending_secret, String(body.code || ""), null);
    if (counter === null) return json({ error: "That code is not correct. Make sure your authenticator shows the current 6-digit code and try again." }, { status: 401 });
    a.totp_secret = a.totp_pending_secret; a.totp_pending_secret = null;
    a.totp_enabled = true; a.totp_last_counter = counter;
    const codes = await issueRecoveryCodes(a);
    await opts.save();
    await opts.markSession();
    const headers: Record<string, string> = {};
    if (body.remember_device) headers["set-cookie"] = await opts.trust();
    return json({ ok: true, recovery_codes: codes }, { headers });
  }
  if (action === "recovery-codes" && method === "POST") {
    if (!session || !session.mfa) return json({ error: "Complete two-factor sign-in first." }, { status: 403 });
    const codes = await issueRecoveryCodes(a);
    await opts.save();
    return json({ recovery_codes: codes });
  }
  return json({ error: "Not found." }, { status: 404 });
}

/* ------------------------------------------------------ chunked uploads -- */
// Browsers upload files in ≤4MB raw chunks (function request limit is 6MB),
// then "complete" assembles them into one blob under uploads/<id>. A record
// endpoint later claims the upload and moves it to its final key.
export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const UPLOAD_MAX_BYTES = 60 * 1024 * 1024;

export async function putUploadChunk(files: any, meta: any, uploadId: string, part: number, req: Request, ownerId: string) {
  if (!/^[a-f0-9-]{36}$/.test(uploadId) || !(part >= 0 && part < 64)) return json({ error: "Bad upload reference." }, { status: 400 });
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > UPLOAD_CHUNK_BYTES + 1024) return json({ error: "Bad chunk size." }, { status: 400 });
  const key = `upload:${uploadId}`;
  const existing = (await meta.get(key, { type: "json" })) as any;
  if (existing && existing.owner !== ownerId) return json({ error: "Not your upload." }, { status: 403 });
  if (!existing) await meta.setJSON(key, { owner: ownerId, started_at: nowIso() });
  await files.set(`uploads/${uploadId}/part-${part}`, bytes);
  return json({ ok: true, part });
}

export async function completeUpload(files: any, meta: any, uploadId: string, body: any, ownerId: string) {
  const key = `upload:${uploadId}`;
  const rec = (await meta.get(key, { type: "json" })) as any;
  if (!rec || rec.owner !== ownerId) return json({ error: "Unknown upload." }, { status: 404 });
  const parts = Number(body.parts || 0);
  if (!(parts > 0 && parts <= 64)) return json({ error: "Bad part count." }, { status: 400 });
  const chunks: ArrayBuffer[] = [];
  let total = 0;
  for (let i = 0; i < parts; i++) {
    const c = await files.get(`uploads/${uploadId}/part-${i}`, { type: "arrayBuffer" });
    if (!c) return json({ error: `Missing part ${i}.` }, { status: 400 });
    chunks.push(c); total += c.byteLength;
  }
  if (total > UPLOAD_MAX_BYTES) return json({ error: "File is too large." }, { status: 400 });
  const joined = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { joined.set(new Uint8Array(c), off); off += c.byteLength; }
  const fileName = safeFileName(body.file_name);
  const mime = String(body.mime_type || contentTypeFor(fileName));
  await files.set(`uploads/${uploadId}/file`, joined, { metadata: { file_name: fileName, content_type: mime } });
  for (let i = 0; i < parts; i++) await files.delete(`uploads/${uploadId}/part-${i}`).catch(() => {});
  rec.file_name = fileName; rec.mime_type = mime; rec.size = total; rec.completed_at = nowIso();
  await meta.setJSON(key, rec);
  return json({ ok: true, upload_id: uploadId, file_name: fileName, mime_type: mime, size: total });
}

// Move a completed upload to its permanent key. Returns file info or null.
export async function claimUpload(files: any, meta: any, uploadId: string, ownerId: string, finalKey: string) {
  if (!uploadId) return null;
  const rec = (await meta.get(`upload:${uploadId}`, { type: "json" })) as any;
  if (!rec || rec.owner !== ownerId || !rec.completed_at) return null;
  const data = await files.get(`uploads/${uploadId}/file`, { type: "arrayBuffer" });
  if (!data) return null;
  await files.set(finalKey, data, { metadata: { file_name: rec.file_name, content_type: rec.mime_type } });
  await files.delete(`uploads/${uploadId}/file`).catch(() => {});
  await meta.delete(`upload:${uploadId}`).catch(() => {});
  return { key: finalKey, file_name: rec.file_name, mime_type: rec.mime_type, size: rec.size };
}

// Stream a stored file back to the browser (no 6MB buffering limit).
export async function streamFile(files: any, key: string, opts: { download?: boolean; fallbackName?: string } = {}) {
  const res = await files.getWithMetadata(key, { type: "stream" });
  if (!res || !res.data) return json({ error: "File not found." }, { status: 404 });
  const md = (res.metadata || {}) as any;
  const name = String(md.file_name || opts.fallbackName || key.split("/").pop() || "file").replace(/"/g, "");
  const type = String(md.content_type || contentTypeFor(name));
  return new Response(res.data, {
    status: 200,
    headers: {
      "content-type": type,
      "content-disposition": `${opts.download ? "attachment" : "inline"}; filename="${name}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

// ============================================================================
// /api/portal/auth/*  — login, sessions, two-factor, password, uploads, files
// Shared by the client portal (/clients) and the company panel (/admin).
// ============================================================================
import type { Config } from "@netlify/functions";
import {
  json, readJson, nowIso, hashPassword, verifyPassword,
  loginThrottled, recordLoginFailure, clearLoginFailures,
  mfaStatusFor, mfaSummary, handleMfa, freshGrace,
  putUploadChunk, completeUpload, streamFile,
} from "./_lib/common.mts";
import {
  portalStore, portalFiles, getUserByEmail, saveUser, publicUser, getClient,
  createSession, sessionCookie, clearSessionCookie, destroySession, destroyAllSessionsFor,
  getAuth, mfaOk, mfaRequiredResponse, markSessionMfa, trustDevice, deviceTrusted, forgetDevices,
  canReadFile,
} from "./_lib/portal.mts";

export default async (req: Request) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/portal\/auth\/?/, "").split("/").filter(Boolean);
  const [seg, id, sub] = parts;
  const method = req.method;
  const st = portalStore();

  /* ---------------------------------------------------------------- login */
  if (seg === "login" && method === "POST") {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const portal = body.portal === "admin" ? "admin" : "client";
    if (!email || !password) return json({ error: "Email and password are required." }, { status: 400 });
    if (await loginThrottled(st, email)) return json({ error: "Too many failed attempts. Try again in 15 minutes." }, { status: 429 });
    const u = await getUserByEmail(email);
    const ok = u && (await verifyPassword(password, u.password_hash));
    if (!ok) {
      await recordLoginFailure(st, email);
      return json({ error: "Access denied. The username or password you entered is incorrect." }, { status: 401 });
    }
    // Membership check: the client login only admits clients, the company
    // panel only admits admins. Wrong door -> same generic denial.
    if (portal === "admin" && !u!.admin) return json({ error: "Access denied. This login is not an admin account." }, { status: 403 });
    if (portal === "client" && !u!.is_client) return json({ error: "Access denied. This login is not a client account." }, { status: 403 });
    if (portal === "client") {
      const profile = await getClient(u!.id);
      if (profile && profile.status === "suspended") return json({ error: "This account is suspended. Please contact Met Capital." }, { status: 403 });
    }
    await clearLoginFailures(st, email);
    if (!u!.mfa_grace_until) { u!.mfa_grace_until = freshGrace(); }
    await saveUser(u!);
    const trusted = u!.totp_enabled ? await deviceTrusted(req, u!.id) : false;
    const token = await createSession(u!.id, trusted);
    return json({
      ok: true, must_change_password: !!u!.must_change_password,
      mfa_status: mfaStatusFor(u!, trusted), grace_until: u!.mfa_grace_until,
      is_admin: !!u!.admin, is_client: !!u!.is_client,
    }, { headers: { "set-cookie": sessionCookie(token) } });
  }

  if (seg === "logout" && method === "POST") {
    await destroySession(req);
    return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
  }

  /* -------------------------------------------------- everything else: auth */
  const auth = await getAuth(req);
  if (!auth) return json({ error: "Not authenticated." }, { status: 401 });
  const { user, session } = auth;

  if (seg === "mfa") {
    return handleMfa({
      action: id, sub, method, body: method === "POST" ? await readJson(req) : {},
      account: user, accountLabel: user.email, issuer: "Met Capital", session,
      save: () => saveUser(user),
      markSession: () => markSessionMfa(req),
      trust: () => trustDevice(user.id),
      forget: () => forgetDevices(user.id),
    });
  }

  // Password change is allowed before the second factor (first-login flow).
  if (seg === "change-password" && method === "POST") {
    const body = await readJson(req);
    const pw = String(body.new_password || "");
    if (pw.length < 10) return json({ error: "Password must be at least 10 characters." }, { status: 400 });
    user.password_hash = await hashPassword(pw);
    user.must_change_password = false;
    await saveUser(user);
    return json({ ok: true });
  }

  if (!mfaOk(auth)) return mfaRequiredResponse(auth);

  if (seg === "me" && method === "GET") {
    const client = user.is_client ? await getClient(user.id) : null;
    return json({ user: publicUser(user), client, mfa: mfaSummary(user, session) });
  }

  /* -------------------------------------------------------------- uploads */
  if (seg === "upload" && id && sub !== "complete" && method === "PUT") {
    return putUploadChunk(portalFiles(), st, id, Number(sub), req, user.id);
  }
  if (seg === "upload" && id && sub === "complete" && method === "POST") {
    return completeUpload(portalFiles(), st, id, await readJson(req), user.id);
  }

  /* ---------------------------------------------------------------- files */
  if (seg === "files" && method === "GET") {
    const key = parts.slice(1).map(decodeURIComponent).join("/");
    if (!key || key.includes("..")) return json({ error: "Bad path." }, { status: 400 });
    if (!canReadFile(user, key)) return json({ error: "Not authorized." }, { status: 403 });
    return streamFile(portalFiles(), key, { download: url.searchParams.get("download") === "1" });
  }

  return json({ error: "Not found." }, { status: 404 });
};

export const config: Config = { path: "/api/portal/auth/*" };

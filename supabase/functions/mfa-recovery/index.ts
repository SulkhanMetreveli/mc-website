// ============================================================================
// Met Capital — mfa-recovery Edge Function
//
// Recovery codes and 2FA resets for client-portal and company-panel users.
//
//   action: "generate"     -> (caller must have passed 2FA) issue 8 fresh
//                             recovery codes; returns them once, stores hashes
//   action: "use_code"     -> (caller signed in with password only) a valid
//                             unused recovery code removes the caller's TOTP
//                             factors so they can sign in and re-enrol
//   action: "admin_reset"  -> (super admin, or HR/Client Dashboard app for
//                             their own users) removes another user's TOTP
//                             factors after you've verified them by phone
//
// Deploy: Supabase dashboard -> Edge Functions -> Deploy a new function ->
// name it "mfa-recovery" -> paste this file -> Deploy. SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
function newCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint8Array(10);
  crypto.getRandomValues(a);
  const s = Array.from(a, (b) => alphabet[b % alphabet.length]).join("");
  return s.slice(0, 5) + "-" + s.slice(5);
}
function normalize(code: string) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function deleteFactors(admin: any, userId: string) {
  const { data } = await admin.auth.admin.mfa.listFactors({ userId });
  const factors = (data?.factors || []) as any[];
  for (const f of factors) {
    await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
  }
  return factors.length;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await caller.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Not authenticated." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    // aal from the caller's JWT
    const token = authHeader.replace(/^Bearer\s+/i, "");
    let aal = "aal1";
    try { aal = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aal || "aal1"; } catch {}

    if (action === "generate") {
      if (aal !== "aal2") return json({ error: "Complete two-factor sign-in before generating recovery codes." }, 403);
      const codes = Array.from({ length: 8 }, newCode);
      await admin.from("mfa_recovery_codes").delete().eq("user_id", user.id);
      const rows = [];
      for (const c of codes) rows.push({ user_id: user.id, code_hash: await sha256(normalize(c)) });
      const { error } = await admin.from("mfa_recovery_codes").insert(rows);
      if (error) return json({ error: error.message }, 500);
      return json({ codes });
    }

    if (action === "use_code") {
      const hash = await sha256(normalize(body.code));
      const { data: rows } = await admin.from("mfa_recovery_codes")
        .select("id").eq("user_id", user.id).eq("code_hash", hash).is("used_at", null).limit(1);
      if (!rows || !rows.length) return json({ error: "That recovery code is not valid." }, 400);
      await admin.from("mfa_recovery_codes").update({ used_at: new Date().toISOString() }).eq("id", rows[0].id);
      const removed = await deleteFactors(admin, user.id);
      // fresh 7-day window to re-enrol
      await admin.from("mfa_grace").upsert({ user_id: user.id, grace_until: new Date(Date.now() + 7 * 86400000).toISOString() });
      await admin.from("mfa_recovery_codes").delete().eq("user_id", user.id);
      return json({ ok: true, factors_removed: removed });
    }

    if (action === "admin_reset") {
      const targetId = String(body.user_id || "").trim();
      if (!targetId) return json({ error: "user_id is required." }, 400);
      const { data: superAdmin } = await caller.rpc("is_super_admin");
      const { data: clientApp } = await caller.rpc("has_app_access", { app: "client_dashboard" });
      if (!superAdmin && !clientApp) return json({ error: "Not authorized." }, 403);
      // Client Dashboard admins may reset clients only; super admins anyone.
      if (!superAdmin) {
        const { data: isClient } = await admin.from("client_profiles").select("user_id").eq("user_id", targetId).maybeSingle();
        if (!isClient) return json({ error: "Only a Super Admin can reset 2FA for that account." }, 403);
      }
      const removed = await deleteFactors(admin, targetId);
      await admin.from("mfa_grace").upsert({ user_id: targetId, grace_until: new Date(Date.now() + 7 * 86400000).toISOString() });
      await admin.from("mfa_recovery_codes").delete().eq("user_id", targetId);
      return json({ ok: true, factors_removed: removed });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

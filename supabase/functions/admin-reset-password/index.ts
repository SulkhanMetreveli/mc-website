// ============================================================================
// Met Capital — admin-reset-password Edge Function
//
// Called from the admin panel (/admin/client/) to reset a client's
// password. Like admin-create-client, this is the ONLY place the
// service_role key is used for this operation — it stays server-side and
// is never sent to a browser.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy admin-reset-password
// (after `supabase login` and `supabase link`, same as admin-create-client)
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function randomPassword(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let b64 = btoa(String.fromCharCode(...bytes));
  b64 = b64.replace(/[+/=]/g, "");
  return b64.slice(0, 20) + "!1";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: hasAccess, error: adminCheckError } = await callerClient.rpc("has_app_access", { app: "clients" });
    if (adminCheckError || !hasAccess) {
      return jsonResponse({ error: "Not authorized. This action requires the Clients app (or Super Admin)." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const userId = String(body.user_id || "").trim();

    if (!userId) {
      return jsonResponse({ error: "user_id is required." }, 400);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const newPassword = randomPassword();

    const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (updateError) {
      return jsonResponse({ error: updateError.message }, 400);
    }

    // Force them to set their own password again on next login.
    const { error: profileError } = await adminClient
      .from("client_profiles")
      .update({ must_change_password: true })
      .eq("user_id", userId);

    if (profileError) {
      return jsonResponse(
        { error: "Password was reset but must_change_password flag failed to update: " + profileError.message },
        500
      );
    }

    return jsonResponse({ password: newPassword });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});

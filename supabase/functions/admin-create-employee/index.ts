// ============================================================================
// Met Capital — admin-create-employee Edge Function
//
// Called from the HR app (/admin/hr/) to create a new employee login. This
// is the ONLY place the service_role key is used for this operation — it
// lives here as a server-side secret and is never sent to any browser.
//
// Deploy with the Supabase CLI:
//   supabase login
//   supabase link --project-ref <your-project-ref>
//   supabase functions deploy admin-create-employee
//
// Or, without a terminal: Supabase dashboard -> Edge Functions -> Deploy a
// new function -> name it "admin-create-employee" -> paste this file's
// contents into the code editor -> Deploy.
//
// SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are
// automatically available as env vars inside every Supabase Edge Function
// — you don't need to set them manually.
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

    // Scoped to the caller's own session — used only to verify admin
    // status. This client can do nothing else privileged.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: hasAccess, error: adminCheckError } = await callerClient.rpc("has_app_access", { app: "hr" });
    if (adminCheckError || !hasAccess) {
      return jsonResponse({ error: "Not authorized. This action requires the HR app (or Super Admin)." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.full_name || "").trim();
    const employeeNumber = String(body.employee_number || "").trim() || null;
    const jobTitle = String(body.job_title || "").trim() || null;
    const department = String(body.department || "").trim() || null;
    const startDate = String(body.start_date || "").trim() || null;
    const requestedPassword = String(body.password || "").trim();

    if (!email || !fullName) {
      return jsonResponse({ error: "email and full_name are required." }, 400);
    }

    if (requestedPassword && requestedPassword.length < 10) {
      return jsonResponse({ error: "Password must be at least 10 characters." }, 400);
    }

    // Full-privilege client, only ever used server-side, never sent to
    // the browser.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const password = requestedPassword || randomPassword();

    const { data: userData, error: userError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (userError || !userData?.user) {
      return jsonResponse({ error: userError?.message || "Could not create user." }, 400);
    }

    const { error: profileError } = await adminClient.from("employee_profiles").insert({
      user_id: userData.user.id,
      full_name: fullName,
      work_email: email,
      employee_number: employeeNumber,
      job_title: jobTitle,
      department: department,
      start_date: startDate,
      must_change_password: true,
      status: "active",
    });

    if (profileError) {
      return jsonResponse(
        {
          error:
            "User was created but the profile insert failed: " +
            profileError.message +
            ". user_id=" +
            userData.user.id,
        },
        500
      );
    }

    return jsonResponse({
      email,
      password,
      user_id: userData.user.id,
    });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});

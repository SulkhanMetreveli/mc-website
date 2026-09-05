// ============================================================================
// Met Capital Admin Panel — shared auth helpers
// Uses the SAME Supabase project/config as the client portal
// (/clients/assets/supabase-config.js), just gated by admin_users
// membership instead of client_profiles.
// ============================================================================
(function () {
  if (!window.supabase) {
    console.error("Supabase JS library did not load.");
    return;
  }

  window.mcAdminClient = window.supabase.createClient(
    window.MC_SUPABASE_URL,
    window.MC_SUPABASE_ANON_KEY
  );

  // Requires a logged-in session AND admin_users membership. Any client
  // who isn't an admin gets signed out and bounced with an error message,
  // so a stolen client password can never be used to reach /admin.
  window.mcRequireAdminSession = async function (currentPath) {
    const { data, error } = await window.mcAdminClient.auth.getSession();
    if (error || !data.session) {
      const next = encodeURIComponent(currentPath || window.location.pathname);
      window.location.href = "/admin/login/?next=" + next;
      return null;
    }

    const { data: adminRow, error: adminError } = await window.mcAdminClient
      .from("admin_users")
      .select("*")
      .eq("user_id", data.session.user.id)
      .maybeSingle();

    if (adminError || !adminRow) {
      await window.mcAdminClient.auth.signOut();
      window.location.href = "/admin/login/?denied=1";
      return null;
    }

    window.mcAdminProfile = adminRow;
    window.mcAdminRole = adminRow.role || "super_admin";
    window.mcAdminApps = adminRow.apps || [];
    return data.session;
  };

  // App keys: clients, vehicles, documents, onboarding, updates, withdrawals
  window.mcHasApp = function (app) {
    if (window.mcAdminRole === "super_admin") return true;
    return (window.mcAdminApps || []).indexOf(app) !== -1;
  };

  window.mcIsSuperAdmin = function () {
    return window.mcAdminRole === "super_admin";
  };

  window.mcAdminLogout = async function () {
    await window.mcAdminClient.auth.signOut();
    window.location.href = "/admin/login/";
  };
})();

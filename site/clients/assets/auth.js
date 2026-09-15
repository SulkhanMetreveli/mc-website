// ============================================================================
// Met Capital Client Portal — shared auth helpers
// Loaded on every /clients/* page after the Supabase UMD script and
// supabase-config.js.
// ============================================================================
(function () {
  if (!window.supabase) {
    console.error("Supabase JS library did not load.");
    return;
  }

  window.mcClient = window.supabase.createClient(
    window.MC_SUPABASE_URL,
    window.MC_SUPABASE_ANON_KEY
  );

  // Redirect to login if there is no active session. Call at the top of
  // every protected page. Returns the session (or redirects and never
  // resolves meaningfully) so callers can `await` it.
  window.mcRequireSession = async function (currentPath) {
    const { data, error } = await window.mcClient.auth.getSession();
    if (error || !data.session) {
      const next = encodeURIComponent(currentPath || window.location.pathname);
      window.location.href = "/clients/login/?next=" + next;
      return null;
    }

    // Two-factor gate: enrolled users must have completed the code step;
    // unenrolled users get a 7-day grace window, then must enrol.
    if (window.mcMfa) {
      const onEnrollPage = window.location.pathname.indexOf("/clients/account/two-factor") === 0;
      const st = await window.mcMfa.state(window.mcClient);
      if (st && st.needsCode) {
        window.location.href = "/clients/login/?mfa=1&next=" + encodeURIComponent(currentPath || window.location.pathname);
        return null;
      }
      if (st && st.needsEnroll && !onEnrollPage) {
        window.location.href = "/clients/account/two-factor/?required=1";
        return null;
      }
      if (st && !st.enrolled && st.graceUntil && !onEnrollPage) {
        window.mcMfaGraceUntil = st.graceUntil;
        window.mcMfa.banner(st.graceUntil, "/clients/account/two-factor/");
      }
    }
    return data.session;
  };

  window.mcLogout = async function () {
    await window.mcClient.auth.signOut();
    window.location.href = "/clients/login/";
  };

  // Loads the client's profile row; used to check must_change_password and
  // to greet them by name. Redirects to change-password if required and
  // not already there.
  window.mcLoadProfile = async function (skipForceRedirect) {
    const { data: userData } = await window.mcClient.auth.getUser();
    if (!userData || !userData.user) return null;

    const { data: profile, error } = await window.mcClient
      .from("client_profiles")
      .select("*")
      .eq("user_id", userData.user.id)
      .single();

    if (error) {
      console.error("Could not load client profile", error);
      return null;
    }

    if (
      profile &&
      profile.must_change_password &&
      !skipForceRedirect &&
      window.location.pathname.indexOf("/clients/account/change-password") !== 0
    ) {
      window.location.href = "/clients/account/change-password/";
      return null;
    }

    return profile;
  };
})();

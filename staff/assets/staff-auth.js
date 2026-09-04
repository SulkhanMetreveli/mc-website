// ============================================================================
// Met Capital Staff Portal — shared auth helpers
// Same Supabase project as the client portal; gated by employee_profiles
// membership instead of client_profiles.
// ============================================================================
(function () {
  if (!window.supabase) { console.error("Supabase JS library did not load."); return; }

  window.mcStaff = window.supabase.createClient(window.MC_SUPABASE_URL, window.MC_SUPABASE_ANON_KEY);

  // Requires a session AND an employee_profiles row. Anyone else is signed
  // out and bounced, so a client login can never reach /staff.
  window.mcRequireStaffSession = async function (currentPath) {
    const { data, error } = await window.mcStaff.auth.getSession();
    if (error || !data.session) {
      window.location.href = "/staff/login/?next=" + encodeURIComponent(currentPath || window.location.pathname);
      return null;
    }
    const { data: profile, error: pErr } = await window.mcStaff
      .from("employee_profiles").select("*").eq("user_id", data.session.user.id).maybeSingle();
    if (pErr || !profile) {
      await window.mcStaff.auth.signOut();
      window.location.href = "/staff/login/?denied=1";
      return null;
    }
    if (profile.must_change_password && window.location.pathname.indexOf("/staff/account/change-password") !== 0) {
      window.location.href = "/staff/account/change-password/";
      return null;
    }
    window.mcStaffProfile = profile;
    return data.session;
  };

  window.mcStaffLogout = async function () {
    await window.mcStaff.auth.signOut();
    window.location.href = "/staff/login/";
  };

  // Working days between two ISO dates, inclusive, excluding weekends.
  window.mcWorkingDays = function (start, end) {
    var s = new Date(start), e = new Date(end);
    if (isNaN(s) || isNaN(e) || e < s) return 0;
    var n = 0;
    for (var d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      var w = d.getDay();
      if (w !== 0 && w !== 6) n++;
    }
    return n;
  };

  window.mcVacationBalance = function (profile, requests, year) {
    var y = year || new Date().getFullYear();
    var used = 0;
    (requests || []).forEach(function (r) {
      if (r.status === "approved" && r.type === "vacation" && String(r.start_date).slice(0, 4) === String(y)) used += Number(r.days || 0);
    });
    var allowance = Number(profile.vacation_days_per_year || 0);
    return { allowance: allowance, used: used, remaining: allowance - used, year: y };
  };
})();

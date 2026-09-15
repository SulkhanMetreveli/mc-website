// ============================================================================
// Met Capital Staff Portal — API helpers (cookie session, Netlify Functions)
// ============================================================================
(function () {
  window.mcStaffApi = async function (path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", credentials: "same-origin", headers: {} };
    if (opts.body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    var res = await fetch("/api/hr/staff" + path, init);
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      var err = new Error((data && data.error) || ("Request failed (" + res.status + ")"));
      err.status = res.status;
      if (data && data.mfa_required) { err.mfa_required = true; err.enroll_required = !!data.enroll_required; }
      throw err;
    }
    return data;
  };

  window.mcRequireStaffSession = async function (currentPath) {
    var me;
    var here = currentPath || window.location.pathname;
    var onTwoFactor = window.location.pathname.indexOf("/staff/account/two-factor") === 0;
    try {
      me = await window.mcStaffApi("/me");
    } catch (e) {
      if (e.status === 403 && e.mfa_required) {
        // Signed in with password but the second factor is outstanding.
        if (e.enroll_required) { if (!onTwoFactor) window.location.href = "/staff/account/two-factor/?required=1"; else return { mfa_gate: true }; }
        else window.location.href = "/staff/login/?mfa=1&next=" + encodeURIComponent(here);
        return null;
      }
      window.location.href = "/staff/login/?next=" + encodeURIComponent(here);
      return null;
    }
    if (me.mfa && !me.mfa.enabled && me.mfa.grace_until && !onTwoFactor) window.mcStaffMfaBanner(me.mfa.grace_until);
    window.mcStaffProfile = me.employee;
    window.mcStaffBalance = me.balance;
    window.mcStaffIsContractor = !!me.is_contractor;
    window.mcStaffContractDaysLeft = me.contract_days_left;
    if (me.employee.must_change_password && window.location.pathname.indexOf("/staff/account/change-password") !== 0) {
      window.location.href = "/staff/account/change-password/";
      return null;
    }
    return me;
  };

  window.mcStaffMfaBanner = function (graceUntil) {
    var main = document.querySelector(".portal-main");
    if (!main || document.getElementById("mfaBanner")) return;
    var days = Math.max(0, Math.ceil((new Date(graceUntil) - new Date()) / 86400000));
    var el = document.createElement("div");
    el.id = "mfaBanner";
    el.className = "alert info";
    el.style.marginBottom = "1.5rem";
    el.innerHTML = "<strong>Two-factor authentication is now required.</strong> Please set up your authenticator app within " + days + " day" + (days === 1 ? "" : "s") + " (by " + new Date(graceUntil).toLocaleDateString() + ") — after that you will not be able to sign in without it. <a href=\"/staff/account/two-factor/\">Set it up now →</a>";
    main.insertBefore(el, main.firstChild);
  };

  window.mcStaffLogout = async function () {
    try { await window.mcStaffApi("/logout", { method: "POST" }); } catch (e) {}
    window.location.href = "/staff/login/";
  };

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

  window.mcFileToBase64 = function (file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1]); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  };
})();

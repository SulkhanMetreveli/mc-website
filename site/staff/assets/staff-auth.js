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
      throw err;
    }
    return data;
  };

  window.mcRequireStaffSession = async function (currentPath) {
    var me;
    try {
      me = await window.mcStaffApi("/me");
    } catch (e) {
      window.location.href = "/staff/login/?next=" + encodeURIComponent(currentPath || window.location.pathname);
      return null;
    }
    window.mcStaffProfile = me.employee;
    window.mcStaffBalance = me.balance;
    if (me.employee.must_change_password && window.location.pathname.indexOf("/staff/account/change-password") !== 0) {
      window.location.href = "/staff/account/change-password/";
      return null;
    }
    return me;
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

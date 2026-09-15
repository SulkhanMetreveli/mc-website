// ============================================================================
// Met Capital — shared browser helpers for the client portal (/clients) and
// the company panel (/admin). Talks to /api/portal/* (Netlify Functions on
// Blobs) with an HttpOnly session cookie. No third-party scripts.
//
//   mcApi(path, {method, body})       JSON call; throws Error with .status
//   mcUpload(file, onProgress)        chunked upload -> { upload_id, ... }
//   mcFileUrl(path)                   URL that streams a stored file
//   mcRequireSession(path)            client pages: session + 2FA gate
//   mcRequireAdminSession(path)       company panel: session + 2FA + admin gate
//   mcHasApp(app), mcIsSuperAdmin()   app access helpers (after admin gate)
//   mcLogout(), mcAdminLogout()
// ============================================================================
(function () {
  window.mcApi = async function (path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", credentials: "same-origin", headers: {} };
    if (opts.body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    var res = await fetch("/api/portal" + path, init);
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

  window.mcFileUrl = function (path, download) {
    return "/api/portal/auth/files/" + String(path).split("/").map(encodeURIComponent).join("/") + (download ? "?download=1" : "");
  };

  // Uploads in 4MB chunks (function request limit), then assembles server-side.
  window.mcUpload = async function (file, onProgress) {
    var CHUNK = 4 * 1024 * 1024;
    var id = (crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, function (c) { return (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16); }));
    var parts = Math.max(1, Math.ceil(file.size / CHUNK));
    for (var i = 0; i < parts; i++) {
      var blob = file.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK));
      var res = await fetch("/api/portal/auth/upload/" + id + "/" + i, { method: "PUT", credentials: "same-origin", body: blob });
      if (!res.ok) {
        var d = null; try { d = await res.json(); } catch (e) {}
        throw new Error((d && d.error) || ("Upload failed (" + res.status + ")"));
      }
      if (onProgress) onProgress(Math.round(((i + 1) / parts) * 100));
    }
    return window.mcApi("/auth/upload/" + id + "/complete", { method: "POST", body: { parts: parts, file_name: file.name, mime_type: file.type || "" } });
  };

  window.mcMfaBanner = function (graceUntil, enrollUrl) {
    if (!graceUntil) return;
    var main = document.querySelector(".portal-main");
    if (!main || document.getElementById("mfaBanner")) return;
    var days = Math.max(0, Math.ceil((new Date(graceUntil) - new Date()) / 86400000));
    var el = document.createElement("div");
    el.id = "mfaBanner";
    el.className = "alert info";
    el.style.marginBottom = "1.5rem";
    el.innerHTML = "<strong>Two-factor authentication is now required.</strong> Please set up your authenticator app within " + days + " day" + (days === 1 ? "" : "s") + " (by " + new Date(graceUntil).toLocaleDateString() + ") — after that you will not be able to sign in without it. <a href=\"" + enrollUrl + "\">Set it up now →</a>";
    main.insertBefore(el, main.firstChild);
  };

  // Shared gate. `base` is "/clients" or "/admin".
  async function requireSession(base, currentPath, isAdmin) {
    var here = currentPath || window.location.pathname;
    var onTwoFactor = window.location.pathname.indexOf(base + "/account/two-factor") === 0;
    var onChangePw = window.location.pathname.indexOf(base + "/account/change-password") === 0;
    var me;
    try {
      me = await window.mcApi("/auth/me");
    } catch (e) {
      if (e.status === 403 && e.mfa_required) {
        if (e.enroll_required) {
          if (!onTwoFactor) { window.location.href = base + "/account/two-factor/?required=1"; return null; }
          return { mfa_gate: true, user: {} };
        }
        window.location.href = base + "/login/?mfa=1&next=" + encodeURIComponent(here);
        return null;
      }
      window.location.href = base + "/login/?next=" + encodeURIComponent(here);
      return null;
    }
    if (isAdmin && !me.user.admin) {
      try { await window.mcApi("/auth/logout", { method: "POST" }); } catch (e) {}
      window.location.href = "/admin/login/?denied=1";
      return null;
    }
    if (!isAdmin && !me.user.is_client) {
      try { await window.mcApi("/auth/logout", { method: "POST" }); } catch (e) {}
      window.location.href = "/clients/login/?denied=1";
      return null;
    }
    if (me.user.must_change_password && !onChangePw) {
      window.location.href = base + "/account/change-password/";
      return null;
    }
    if (me.mfa && !me.mfa.enabled && me.mfa.grace_until && !onTwoFactor) window.mcMfaBanner(me.mfa.grace_until, base + "/account/two-factor/");
    window.mcMe = me;
    window.mcProfile = me.client || null;
    if (me.user.admin) {
      window.mcAdminProfile = { user_id: me.user.id, email: me.user.email, full_name: me.user.admin.full_name, role: me.user.admin.role, apps: me.user.admin.apps || [] };
      window.mcAdminRole = me.user.admin.role;
      window.mcAdminApps = me.user.admin.apps || [];
    }
    return { user: me.user, client: me.client, mfa: me.mfa };
  }

  window.mcRequireSession = function (currentPath) { return requireSession("/clients", currentPath, false); };
  window.mcRequireAdminSession = function (currentPath) { return requireSession("/admin", currentPath, true); };

  // Kept for the pages that call it after mcRequireSession: returns the
  // client profile already loaded by the gate.
  window.mcLoadProfile = async function () { return window.mcProfile || null; };

  window.mcHasApp = function (app) {
    if (window.mcAdminRole === "super_admin") return true;
    return (window.mcAdminApps || []).indexOf(app) !== -1;
  };
  window.mcIsSuperAdmin = function () { return window.mcAdminRole === "super_admin"; };

  window.mcLogout = async function () {
    try { await window.mcApi("/auth/logout", { method: "POST" }); } catch (e) {}
    window.location.href = "/clients/login/";
  };
  window.mcAdminLogout = async function () {
    try { await window.mcApi("/auth/logout", { method: "POST" }); } catch (e) {}
    window.location.href = "/admin/login/";
  };

  window.mcEscape = function (s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
})();

// ============================================================================
// Met Capital — two-factor helpers for the Supabase-backed portals
// (client portal and company panel). Loaded after the Supabase UMD script.
//
//   mcMfa.state(client)           -> { enrolled, needsCode, needsEnroll, graceUntil }
//   mcMfa.verifyCode(client,code) -> completes the code step after password login
//   mcMfa.enrollStart(client)     -> { factorId, qr, secret, uri }
//   mcMfa.enrollConfirm(client, factorId, code)
//   mcMfa.recovery(client, action, payload) -> calls the mfa-recovery Edge Function
//   mcMfa.banner(graceUntil, enrollUrl) -> injects the "set up 2FA by …" notice
// ============================================================================
(function () {
  var GRACE_DAYS = 7;

  async function verifiedFactors(client) {
    var res = await client.auth.mfa.listFactors();
    if (res.error) return [];
    return (res.data.all || []).filter(function (f) { return f.factor_type === 'totp' && f.status === 'verified'; });
  }

  async function ensureGrace(client, userId) {
    var { data } = await client.from('mfa_grace').select('grace_until').eq('user_id', userId).maybeSingle();
    if (data) return data.grace_until;
    var until = new Date(Date.now() + GRACE_DAYS * 86400000).toISOString();
    await client.from('mfa_grace').insert({ user_id: userId, grace_until: until });
    return until;
  }

  window.mcMfa = {
    state: async function (client) {
      var { data: sess } = await client.auth.getSession();
      if (!sess || !sess.session) return null;
      var factors = await verifiedFactors(client);
      var aalRes = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      var current = aalRes.data ? aalRes.data.currentLevel : 'aal1';
      var enrolled = factors.length > 0;
      var out = { enrolled: enrolled, needsCode: false, needsEnroll: false, graceUntil: null, factorId: enrolled ? factors[0].id : null };
      if (enrolled) {
        out.needsCode = current !== 'aal2';
      } else {
        var until = await ensureGrace(client, sess.session.user.id);
        out.graceUntil = until;
        out.needsEnroll = !until || new Date(until) <= new Date();
      }
      return out;
    },

    verifyCode: async function (client, code) {
      var factors = await verifiedFactors(client);
      if (!factors.length) throw new Error('No authenticator is set up on this account.');
      var ch = await client.auth.mfa.challenge({ factorId: factors[0].id });
      if (ch.error) throw ch.error;
      var v = await client.auth.mfa.verify({ factorId: factors[0].id, challengeId: ch.data.id, code: String(code || '').replace(/\s+/g, '') });
      if (v.error) throw new Error('That code is not correct. Codes change every 30 seconds — try the current one.');
      return true;
    },

    enrollStart: async function (client) {
      // clear any half-finished enrolment first
      var res = await client.auth.mfa.listFactors();
      var stale = ((res.data && res.data.all) || []).filter(function (f) { return f.status !== 'verified'; });
      for (var i = 0; i < stale.length; i++) await client.auth.mfa.unenroll({ factorId: stale[i].id });
      var en = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' });
      if (en.error) throw en.error;
      return { factorId: en.data.id, qr: en.data.totp.qr_code, secret: en.data.totp.secret, uri: en.data.totp.uri };
    },

    enrollConfirm: async function (client, factorId, code) {
      var ch = await client.auth.mfa.challenge({ factorId: factorId });
      if (ch.error) throw ch.error;
      var v = await client.auth.mfa.verify({ factorId: factorId, challengeId: ch.data.id, code: String(code || '').replace(/\s+/g, '') });
      if (v.error) throw new Error('That code is not correct. Make sure your authenticator shows the current 6-digit code and try again.');
      return true;
    },

    recovery: async function (client, action, payload) {
      var { data, error } = await client.functions.invoke('mfa-recovery', { body: Object.assign({ action: action }, payload || {}) });
      if (error) {
        var msg = error.message;
        if (error.context && typeof error.context.json === 'function') {
          try { var b = await error.context.json(); if (b && b.error) msg = b.error; } catch (e) {}
        }
        throw new Error(msg + (msg.indexOf('mfa-recovery') === -1 ? ' (is the mfa-recovery Edge Function deployed?)' : ''));
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    },

    banner: function (graceUntil, enrollUrl) {
      if (!graceUntil) return;
      var main = document.querySelector('.portal-main');
      if (!main || document.getElementById('mfaBanner')) return;
      var days = Math.max(0, Math.ceil((new Date(graceUntil) - new Date()) / 86400000));
      var el = document.createElement('div');
      el.id = 'mfaBanner';
      el.className = 'alert info';
      el.style.marginBottom = '1.5rem';
      el.innerHTML = '<strong>Two-factor authentication is now required.</strong> Please set up your authenticator app within ' + days + ' day' + (days === 1 ? '' : 's') + ' (by ' + new Date(graceUntil).toLocaleDateString() + ') — after that you will not be able to sign in without it. <a href="' + enrollUrl + '">Set it up now →</a>';
      main.insertBefore(el, main.firstChild);
    }
  };
})();

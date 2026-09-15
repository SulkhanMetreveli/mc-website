// ============================================================================
// Met Capital HR — shared bank-details form (staff portal + HR admin)
// Renders scheme-specific fields, reads them back, and summarises stored
// details. Server-side validation is authoritative; this only guides input.
// ============================================================================
(function () {
  var SCHEMES = {
    uk:    { label: 'United Kingdom — sort code & account number' },
    iban:  { label: 'IBAN — Switzerland, Europe & most countries' },
    us:    { label: 'United States — routing & account number' },
    other: { label: 'Other — SWIFT/BIC & account number' }
  };

  function field(id, label, opts) {
    opts = opts || {};
    var req = opts.required ? ' <span class="required">*</span>' : '';
    var attrs = ' id="' + id + '"' + (opts.placeholder ? ' placeholder="' + opts.placeholder + '"' : '') + (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '');
    var control = opts.select
      ? '<select' + attrs + '>' + opts.select.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select>'
      : '<input type="text"' + attrs + '>';
    return '<div class="field"><label for="' + id + '">' + label + req + '</label>' + control + (opts.hint ? '<div class="file-hint">' + opts.hint + '</div>' : '') + '</div>';
  }

  // Renders the whole form into `container` (a form or div). `prefix` keeps ids unique.
  window.mcBankFormRender = function (container, prefix, existing) {
    var p = prefix || 'b';
    var html =
      '<div class="form-row">' +
        field(p + '_scheme', 'Account format', { required: true, select: Object.keys(SCHEMES).map(function (k) { return [k, SCHEMES[k].label]; }) }) +
      '</div>' +
      '<div class="form-row">' +
        field(p + '_holder', 'Account holder name', { required: true }) +
        field(p + '_bank_name', 'Bank name', { required: true }) +
      '</div>' +
      '<div class="form-row" data-scheme="uk" style="display:none;">' +
        field(p + '_sort_code', 'Sort code', { required: true, placeholder: '12-34-56', inputmode: 'numeric' }) +
        field(p + '_uk_account', 'Account number', { required: true, placeholder: '8 digits', inputmode: 'numeric' }) +
      '</div>' +
      '<div class="form-row" data-scheme="iban" style="display:none;">' +
        field(p + '_iban', 'IBAN', { required: true, placeholder: 'CH93 0076 2011 6238 5295 7' }) +
        field(p + '_bic', 'BIC / SWIFT', { placeholder: 'UBSWCHZH80A', hint: '8 or 11 characters. Recommended for cross-border payments.' }) +
      '</div>' +
      '<div class="form-row" data-scheme="us" style="display:none;">' +
        field(p + '_routing', 'Routing number (ABA)', { required: true, placeholder: '9 digits', inputmode: 'numeric' }) +
        field(p + '_us_account', 'Account number', { required: true, inputmode: 'numeric' }) +
        field(p + '_account_type', 'Account type', { select: [['checking', 'Checking'], ['savings', 'Savings']] }) +
      '</div>' +
      '<div class="form-row" data-scheme="other" style="display:none;">' +
        field(p + '_swift', 'SWIFT / BIC', { required: true, placeholder: '8 or 11 characters' }) +
        field(p + '_other_account', 'Account number', { required: true }) +
        field(p + '_bank_address', 'Bank address', { placeholder: 'Branch address' }) +
      '</div>' +
      '<div class="form-row">' +
        field(p + '_country', 'Bank country', { placeholder: 'e.g. CH, GB, US' }) +
        field(p + '_currency', 'Account currency', { placeholder: 'e.g. CHF, EUR, GBP, USD' }) +
      '</div>';
    container.innerHTML = html;

    var schemeEl = document.getElementById(p + '_scheme');
    function sync() {
      var v = schemeEl.value;
      container.querySelectorAll('[data-scheme]').forEach(function (row) {
        row.style.display = row.getAttribute('data-scheme') === v ? '' : 'none';
      });
    }
    schemeEl.addEventListener('change', sync);

    if (existing) {
      schemeEl.value = existing.scheme || 'iban';
      var set = function (id, v) { var el = document.getElementById(p + id); if (el && v != null) el.value = v; };
      set('_holder', existing.account_holder_name); set('_bank_name', existing.bank_name);
      set('_sort_code', existing.sort_code); set('_iban', existing.iban); set('_bic', existing.bic);
      set('_routing', existing.routing_number); set('_account_type', existing.account_type);
      set('_swift', existing.swift_bic); set('_bank_address', existing.bank_address);
      set('_country', existing.bank_country); set('_currency', existing.currency);
      if (existing.scheme === 'uk') set('_uk_account', existing.account_number);
      if (existing.scheme === 'us') set('_us_account', existing.account_number);
      if (existing.scheme === 'other') set('_other_account', existing.account_number);
    } else {
      schemeEl.value = 'iban';
    }
    sync();
  };

  window.mcBankFormRead = function (prefix) {
    var p = prefix || 'b';
    var g = function (id) { var el = document.getElementById(p + id); return el ? el.value.trim() : ''; };
    var scheme = g('_scheme');
    var body = { scheme: scheme, account_holder_name: g('_holder'), bank_name: g('_bank_name'), bank_country: g('_country'), currency: g('_currency') };
    if (scheme === 'uk') { body.sort_code = g('_sort_code'); body.account_number = g('_uk_account'); }
    if (scheme === 'iban') { body.iban = g('_iban'); body.bic = g('_bic'); }
    if (scheme === 'us') { body.routing_number = g('_routing'); body.account_number = g('_us_account'); body.account_type = g('_account_type'); }
    if (scheme === 'other') { body.swift_bic = g('_swift'); body.account_number = g('_other_account'); body.bank_address = g('_bank_address'); }
    return body;
  };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  // Definition-list summary of stored details.
  window.mcBankSummary = function (b) {
    if (!b) return '<p style="color:var(--gray-light); font-size:0.875rem;">No bank details on file.</p>';
    var rows = [['Format', SCHEMES[b.scheme] ? SCHEMES[b.scheme].label : b.scheme], ['Account holder', b.account_holder_name], ['Bank', b.bank_name]];
    if (b.scheme === 'uk') rows.push(['Sort code', b.sort_code], ['Account number', b.account_number]);
    if (b.scheme === 'iban') rows.push(['IBAN', b.iban], ['BIC / SWIFT', b.bic || '—']);
    if (b.scheme === 'us') rows.push(['Routing number', b.routing_number], ['Account number', b.account_number], ['Account type', b.account_type]);
    if (b.scheme === 'other') rows.push(['SWIFT / BIC', b.swift_bic || '—'], ['Account number', b.account_number], ['Bank address', b.bank_address || '—']);
    rows.push(['Country / Currency', (b.bank_country || '—') + ' / ' + (b.currency || '—')]);
    if (b.set_at) rows.push(['Recorded', new Date(b.set_at).toLocaleDateString() + (b.set_by ? ' by ' + (b.set_by === 'hr' ? 'HR' : 'employee') : '')]);
    return '<dl>' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>';
  };
})();

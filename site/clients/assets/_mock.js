// Injected into a page fetched from the branch deploy: replaces fetch with a
// mock API so gated dashboards render with sample data for visual review.
(function () {
  var now = new Date().toISOString();
  var uid = "11111111-1111-4111-8111-111111111111";
  var user = { id: uid, email: "sulkhan@met.capital", must_change_password: false, is_client: true, admin: { full_name: "Sulkhan Metreveli", role: "super_admin", apps: [], created_at: now }, created_at: now };
  var profile = { user_id: uid, full_name: "Nodar Example", email: "nodar@example.com", client_reference: "MC-00123", status: "active", created_at: now, address_line1: "12 Rustaveli Avenue", city: "Tbilisi", postal_code: "0108", country: "Georgia", phone_number: "+995 555 000 000", bank_account_holder_name: "Nodar Example", bank_name: "TBC Bank", bank_account_number: "GE00TB0000000000000000", bank_swift_bic: "TBCBGE22", bank_country: "Georgia" };
  var vehicles = [
    { id: "v1", user_id: uid, vehicle_name: "Systematic Global Macro", currency: "USD", balance: 1250000, ytd_performance_pct: 8.4, inception_performance_pct: 27.9, as_of_date: "2026-08-31", status: "active" },
    { id: "v2", user_id: uid, vehicle_name: "Multi-Strategy Fund II", currency: "EUR", balance: 480000, ytd_performance_pct: -1.2, inception_performance_pct: 12.1, as_of_date: "2026-08-31", status: "in_transit_documents_review", notes: "Q3 statement in preparation." },
  ];
  var documents = [
    { id: "d1", user_id: uid, title: "Q2 2026 Statement", category: "statement", storage_path: "client-documents/" + uid + "/q2.pdf", file_name: "q2-statement.pdf", uploaded_at: now },
    { id: "d2", user_id: uid, title: "Investment Management Agreement", category: "agreement", storage_path: "client-documents/" + uid + "/ima.pdf", uploaded_at: "2026-01-12T10:00:00Z" },
    { id: "d3", user_id: uid, title: "Passport Copy", category: "passport", storage_path: "client-documents/" + uid + "/pp.pdf", uploaded_at: "2026-03-02T10:00:00Z" },
  ];
  var withdrawals = [{ id: "w1", user_id: uid, submitted_at: now, status: "pending", withdrawal_type: "partial", amount: 50000, currency: "USD", reason: "Property purchase", investment_vehicle_id: "v1" }];
  var addr = [
    { id: "a1", user_id: uid, submitted_at: now, status: "pending", address_line1: "5 Chavchavadze Ave", city: "Tbilisi", postal_code: "0179", country: "Georgia", proof_of_address_path: "kyc-files/" + uid + "/proof.pdf" },
    { id: "a2", user_id: uid, submitted_at: "2026-05-01T10:00:00Z", status: "approved", reviewed_at: "2026-05-03T10:00:00Z", bank_account_holder_name: "Nodar Example", bank_name: "TBC Bank", bank_account_number: "GE00TB0000000000000000", bank_country: "Georgia", payout_currency: "USD" },
    { id: "a3", user_id: uid, submitted_at: "2026-02-01T10:00:00Z", status: "rejected", reviewed_at: "2026-02-02T10:00:00Z", address_line1: "Old address", city: "Batumi", postal_code: "6000", country: "Georgia", proof_of_address_path: "kyc-files/" + uid + "/old.pdf" },
  ];
  var docsub = [{ id: "s1", user_id: uid, submitted_at: now, status: "in_transit_documents_review", passport_path: "kyc-files/" + uid + "/pp.pdf", proof_of_address_path: null }];
  var gendoc = [{ id: "g1", user_id: uid, submitted_at: now, status: "pending", title: "Tax residency certificate", file_path: "kyc-files/" + uid + "/tax.pdf" }];
  var onboarding = [];
  var admins = [
    { id: uid, email: "sulkhan@met.capital", admin: { full_name: "Sulkhan Metreveli", role: "super_admin", apps: [], created_at: now }, totp_enabled: true },
    { id: "u2", email: "hr@met.capital", admin: { full_name: "Nino K.", role: "admin", apps: ["hr", "dms"], created_at: now }, totp_enabled: false },
  ];
  var emp = { id: "e1", full_name: "Giorgi Beridze", work_email: "giorgi@met.capital", job_title: "Operations Analyst", department: "Operations", employment_type: "full_time", status: "active", start_date: "2024-03-01", vacation_allowance: 25, phone: "+995 555 111 222", city: "Tbilisi", country: "Georgia", bank: { scheme: "iban", account_holder: "Giorgi Beridze", iban: "GE29NB0000000101904917", bic: "BNLNGE22", bank_name: "Bank of Georgia" }, bank_pending: null, totp_enabled: false, mfa_grace_until: now, must_change_password: false, documents_count: 2 };
  var con = { id: "e2", full_name: "Anna Weber", work_email: "anna@met.capital", job_title: "Compliance Consultant", employment_type: "contractor", status: "active", contract_start: "2026-01-01", contract_end: "2026-10-15", contracting_entity: "Weber Advisory GmbH", engagement_basis: "Retainer", contract_days_left: 28 };
  var vac = [{ id: "r1", employee_id: "e1", employee_name: "Giorgi Beridze", type: "vacation", start_date: "2026-10-05", end_date: "2026-10-09", days: 5, status: "pending", reason: "Family trip", submitted_at: now },
             { id: "r2", employee_id: "e1", employee_name: "Giorgi Beridze", type: "sick", start_date: "2026-06-02", end_date: "2026-06-03", days: 2, status: "approved", submitted_at: now }];
  var dmscats = [{ id: "c1", name: "Legal", parent_id: null, document_count: 2 }, { id: "c2", name: "Contracts", parent_id: "c1", document_count: 1 }, { id: "c3", name: "Regulatory", parent_id: null, document_count: 1 }];
  var dmsdocs = [
    { id: "x1", title: "NDA — Weber Advisory", doc_type: "contract", category_id: "c2", file_name: "nda-weber.pdf", uploaded_at: now, action_required: true, action_due_date: "2026-09-20", action_status: "pending", description: "Mutual NDA, 2 years." },
    { id: "x2", title: "FCA correspondence", doc_type: "other", category_id: "c3", file_name: "fca-letter.pdf", uploaded_at: now, action_required: true, action_due_date: "2026-09-01", action_status: "pending" },
    { id: "x3", title: "Office lease", doc_type: "property", category_id: "c1", file_name: null, uploaded_at: "2026-02-01T10:00:00Z", action_required: false, action_status: "none" },
  ];
  function J(o, status) { return Promise.resolve(new Response(JSON.stringify(o), { status: status || 200, headers: { "content-type": "application/json" } })); }
  var realFetch = window.fetch;
  window.fetch = function (url, init) {
    var u = String(url); var m = (init && init.method) || "GET";
    if (u.indexOf("/api/") !== 0) return realFetch(url, init);
    if (u === "/api/portal/auth/me") return J({ user: user, client: profile, mfa: { enabled: false, session_mfa: false, grace_until: new Date(Date.now() + 5 * 86400000).toISOString(), grace_active: true, recovery_codes_left: 0 } });
    if (u === "/api/portal/auth/mfa/status") return J({ enabled: true, session_mfa: true, grace_until: null, grace_active: false, recovery_codes_left: 6 });
    if (u === "/api/portal/client/overview") return J({ profile: profile, vehicles: vehicles });
    if (u === "/api/portal/client/vehicles") return J({ vehicles: vehicles });
    if (u === "/api/portal/client/documents") return J({ documents: documents });
    if (u === "/api/portal/client/general-documents") return J({ submissions: gendoc });
    if (u === "/api/portal/client/document-submissions") return J({ submissions: [] });
    if (u === "/api/portal/client/onboarding") return J({ submissions: [] });
    if (u === "/api/portal/admin/overview") return J({ stats: { clients: 4, onboarding: 0, updates: 1, withdrawals: 1, documents: 1, generaldocs: 1 }, pending: [
      { type: "Withdrawal Request", detail: "50,000 USD — USD", submitted_at: now, user_id: uid, client_name: "Nodar Example" },
      { type: "Address & Bank Update", detail: "New address in Georgia", submitted_at: now, user_id: uid, client_name: "Nodar Example" },
      { type: "General Document", detail: "Tax residency certificate", submitted_at: now, user_id: uid, client_name: "Nodar Example" }],
      clients: [profile, { user_id: "u9", full_name: "Elene Gogoladze", email: "elene@example.com", client_reference: "MC-00124", status: "active", created_at: now }] });
    if (u.indexOf("/api/portal/admin/clients/") === 0 && m === "GET") return J({ profile: profile, user: { id: uid, totp_enabled: false, mfa_grace_until: now }, vehicles: vehicles, documents: documents, document_submissions: docsub, general_documents: gendoc, onboarding: onboarding, address_requests: addr, withdrawals: withdrawals });
    if (u === "/api/portal/admin/admins") return J({ admins: admins });
    if (u === "/api/hr/admin/overview") return J({ stats: { active: 6, contractors: 2, away_today: 1, pending: 1, expiring: 1, bank_pending: 1 }, employees: [emp, { id: "e3", full_name: "Mariam L.", work_email: "mariam@met.capital", job_title: "Client Relations", department: "Sales", employment_type: "full_time", status: "on_leave", start_date: "2023-01-09" }], contractors: [con], pending: vac.filter(function (r) { return r.status === "pending"; }), expiring: [con], bank_pending: [{ id: "e1", full_name: "Giorgi Beridze", employment_type: "full_time", scheme: "iban", submitted_at: now }] });
    if (u.indexOf("/api/hr/admin/employees/") === 0) return J({ employee: emp, is_contractor: false, contract_days_left: null, vacation: vac, balance: { allowance: 25, used: 2, remaining: 23, pending: 5 }, documents: [{ id: "doc1", title: "Employment contract", category: "contract", file_name: "contract.pdf", uploaded_by: "hr", uploaded_at: now }] });
    if (u === "/api/hr/staff/me") return J({ employee: emp, balance: { allowance: 25, used: 2, remaining: 23, pending: 5 }, is_contractor: false, contract_days_left: null, mfa: { enabled: false, grace_until: new Date(Date.now() + 5 * 86400000).toISOString(), grace_active: true } });
    if (u === "/api/hr/staff/vacation") return J({ requests: vac, balance: { allowance: 25, used: 2, remaining: 23, pending: 5 } });
    if (u === "/api/hr/staff/documents") return J({ documents: [{ id: "doc1", title: "Employment contract", category: "contract", file_name: "contract.pdf", uploaded_by: "hr", uploaded_at: now }] });
    if (u === "/api/portal/dms/categories") return J({ categories: dmscats, totalDocuments: 3 });
    if (u.indexOf("/api/portal/dms/documents") === 0) return J({ documents: dmsdocs });
    if (u.indexOf("/api/portal/import/status") === 0) return J({ bootstrap: false, allowed: true, user_count: 5, state: null });
    return J({ error: "mock: " + u }, 404);
  };
})();

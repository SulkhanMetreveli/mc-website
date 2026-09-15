// ============================================================================
// /api/portal/client/*  — what a signed-in client can read and submit
// Every submission here is a REQUEST: nothing changes the client's record
// until an admin reviews it (and verifies the client by phone).
// ============================================================================
import type { Config } from "@netlify/functions";
import { json, readJson, newId, nowIso, claimUpload } from "./_lib/common.mts";
import {
  portalStore, portalFiles, getAuth, mfaOk, mfaRequiredResponse, getClient,
  listRecords, saveRecord, byDateDesc,
} from "./_lib/portal.mts";

const s = (v: any) => { const t = String(v ?? "").trim(); return t ? t : null; };

export default async (req: Request) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/portal\/client\/?/, "").split("/").filter(Boolean);
  const [seg] = parts;
  const method = req.method;

  const auth = await getAuth(req);
  if (!auth) return json({ error: "Not authenticated." }, { status: 401 });
  if (!auth.user.is_client) return json({ error: "Not a client account." }, { status: 403 });
  if (!mfaOk(auth)) return mfaRequiredResponse(auth);
  const uid = auth.user.id;
  const profile = await getClient(uid);
  if (!profile) return json({ error: "Client profile not found." }, { status: 404 });
  if (profile.status === "suspended") return json({ error: "This account is suspended." }, { status: 403 });

  const files = portalFiles(), meta = portalStore();
  async function claim(uploadId: any, key: string) {
    const f = await claimUpload(files, meta, String(uploadId || ""), uid, key);
    if (!f) throw new Error("The uploaded file could not be found. Please attach it again.");
    return f;
  }
  const stamp = () => Date.now();

  try {
    if (seg === "overview" && method === "GET") {
      const vehicles = (await listRecords("vehicle", uid)).sort((a, b) => String(a.vehicle_name).localeCompare(String(b.vehicle_name)));
      return json({ profile, vehicles });
    }
    if (seg === "vehicles" && method === "GET") {
      const vehicles = (await listRecords("vehicle", uid)).sort((a, b) => String(a.vehicle_name).localeCompare(String(b.vehicle_name)));
      return json({ vehicles });
    }
    if (seg === "documents" && method === "GET") {
      return json({ documents: (await listRecords("document", uid)).sort(byDateDesc("uploaded_at")) });
    }

    /* -------------------------------------------------------- withdrawals */
    if (seg === "withdrawals" && method === "GET") {
      return json({ requests: (await listRecords("withdrawal", uid)).sort(byDateDesc("submitted_at")) });
    }
    if (seg === "withdrawals" && method === "POST") {
      const b = await readJson(req);
      const type = b.withdrawal_type === "full" ? "full" : (b.withdrawal_type === "partial" ? "partial" : null);
      if (!type) return json({ error: "Please select a withdrawal type." }, { status: 400 });
      const amount = type === "partial" ? Number(b.amount) : null;
      if (type === "partial" && !(amount! > 0)) return json({ error: "Please enter a valid amount greater than zero." }, { status: 400 });
      if (!s(b.currency)) return json({ error: "Please select a currency." }, { status: 400 });
      if (!s(b.reason)) return json({ error: "Please give a reason." }, { status: 400 });
      if (!b.confirm_bank_on_file) return json({ error: "Please confirm the bank-on-file statement." }, { status: 400 });
      const rec = {
        id: newId(), user_id: uid, submitted_at: nowIso(), status: "pending", reviewed_at: null, reviewed_by: null, reviewer_notes: null,
        investment_vehicle_id: s(b.investment_vehicle_id), withdrawal_type: type, amount, currency: s(b.currency),
        reason: s(b.reason), confirm_bank_on_file: true, additional_notes: s(b.additional_notes),
      };
      await saveRecord("withdrawal", rec);
      return json({ ok: true, request: rec });
    }

    /* ------------------------------------------ address / bank update reqs */
    if (seg === "address-requests" && method === "GET") {
      return json({ requests: (await listRecords("addrreq", uid)).sort(byDateDesc("submitted_at")) });
    }
    if (seg === "address-requests" && method === "POST") {
      const b = await readJson(req);
      const addr = ["address_line1", "city", "postal_code", "country"].some((k) => s(b[k]));
      if (addr && !["address_line1", "city", "postal_code", "country"].every((k) => s(b[k])))
        return json({ error: "Please complete Address Line 1, City, Postal Code, and Country, or clear the address section." }, { status: 400 });
      const bankKeys = ["bank_account_holder_name", "bank_name", "bank_account_number", "bank_country", "payout_currency"];
      const bank = bankKeys.some((k) => s(b[k]));
      if (bank && !bankKeys.every((k) => s(b[k])))
        return json({ error: "Please complete Account Holder Name, Bank Name, Account Number, Bank Country, and Payout Currency, or clear the bank section." }, { status: 400 });
      if (!addr && !bank && !b.passport_upload_id) return json({ error: "Nothing to submit." }, { status: 400 });
      if (addr && !b.proof_upload_id) return json({ error: "Proof of address is required for an address change." }, { status: 400 });
      const id = newId();
      const proof = b.proof_upload_id ? await claim(b.proof_upload_id, `kyc-files/${uid}/address-proof-${stamp()}-${id}.pdf`) : null;
      const passport = b.passport_upload_id ? await claim(b.passport_upload_id, `kyc-files/${uid}/address-request-passport-${stamp()}-${id}.pdf`) : null;
      const rec: any = {
        id, user_id: uid, submitted_at: nowIso(), status: "pending", reviewed_at: null, reviewed_by: null, reviewer_notes: null,
        proof_of_address_path: proof ? proof.key : null, passport_copy_path: passport ? passport.key : null, additional_notes: s(b.additional_notes),
      };
      for (const k of ["address_line1", "address_line2", "city", "state_province", "postal_code", "country"]) rec[k] = addr ? s(b[k]) : null;
      for (const k of [...bankKeys, "bank_swift_bic", "bank_routing_number", "bank_address"]) rec[k] = bank ? s(b[k]) : null;
      await saveRecord("addrreq", rec);
      return json({ ok: true, request: rec });
    }

    /* ---------------------------------------------------------- onboarding */
    if (seg === "onboarding" && method === "GET") {
      return json({ submissions: (await listRecords("onboarding", uid)).sort(byDateDesc("submitted_at")) });
    }
    if (seg === "onboarding" && method === "POST") {
      const b = await readJson(req);
      const required = ["full_legal_name", "date_of_birth", "nationality", "phone_number", "email", "address_line1", "city", "postal_code",
        "country_of_residence", "tax_residency_country", "source_of_funds", "occupation", "bank_account_holder_name", "bank_name",
        "bank_account_number", "bank_country", "payout_currency"];
      for (const k of required) if (!s(b[k])) return json({ error: `Please complete all required fields (${k.replace(/_/g, " ")}).` }, { status: 400 });
      if (!b.passport_upload_id || !b.proof_upload_id) return json({ error: "Both a passport copy and proof of address (PDF) are required." }, { status: 400 });
      const id = newId();
      const passport = await claim(b.passport_upload_id, `kyc-files/${uid}/onboarding-passport-${stamp()}-${id}.pdf`);
      const proof = await claim(b.proof_upload_id, `kyc-files/${uid}/onboarding-address-proof-${stamp()}-${id}.pdf`);
      const rec: any = { id, user_id: uid, submitted_at: nowIso(), status: "pending", reviewer_notes: null, pep_status: !!b.pep_status,
        passport_copy_path: passport.key, proof_of_address_path: proof.key };
      for (const k of [...required, "address_line2", "state_province", "tax_id_number", "bank_swift_bic"]) rec[k] = s(b[k]);
      await saveRecord("onboarding", rec);
      return json({ ok: true, submission: rec });
    }

    /* ------------------------------------------------ document submissions */
    if (seg === "document-submissions" && method === "GET") {
      return json({ submissions: (await listRecords("docsub", uid)).sort(byDateDesc("submitted_at")) });
    }
    if (seg === "document-submissions" && method === "POST") {
      const b = await readJson(req);
      if (!b.passport_upload_id && !b.proof_upload_id) return json({ error: "Please attach at least one document." }, { status: 400 });
      const open = (await listRecords("docsub", uid)).some((r) => r.status === "pending" || r.status === "in_transit_documents_review");
      if (open) return json({ error: "You already have a submission under review. Once it's reviewed, you'll be able to submit another." }, { status: 400 });
      const id = newId();
      const passport = b.passport_upload_id ? await claim(b.passport_upload_id, `kyc-files/${uid}/document-submission-passport-${stamp()}-${id}.pdf`) : null;
      const proof = b.proof_upload_id ? await claim(b.proof_upload_id, `kyc-files/${uid}/document-submission-proof-${stamp()}-${id}.pdf`) : null;
      const rec = { id, user_id: uid, submitted_at: nowIso(), status: "pending", reviewed_at: null,
        passport_path: passport ? passport.key : null, proof_of_address_path: proof ? proof.key : null };
      await saveRecord("docsub", rec);
      return json({ ok: true, submission: rec });
    }

    /* --------------------------------------------- general document uploads */
    if (seg === "general-documents" && method === "GET") {
      return json({ submissions: (await listRecords("gendoc", uid)).sort(byDateDesc("submitted_at")) });
    }
    if (seg === "general-documents" && method === "POST") {
      const b = await readJson(req);
      const title = s(b.title);
      if (!title) return json({ error: "Please give the document a title." }, { status: 400 });
      if (!b.upload_id) return json({ error: "Please attach a PDF file." }, { status: 400 });
      const id = newId();
      const f = await claim(b.upload_id, `kyc-files/${uid}/general-document-${stamp()}-${id}-${b.file_name ? String(b.file_name).replace(/[^a-zA-Z0-9._-]/g, "_") : "document.pdf"}`);
      const rec = { id, user_id: uid, submitted_at: nowIso(), status: "pending", reviewed_at: null, title, file_path: f.key, file_name: f.file_name };
      await saveRecord("gendoc", rec);
      return json({ ok: true, submission: rec });
    }

    return json({ error: "Not found." }, { status: 404 });
  } catch (err: any) {
    return json({ error: err.message || String(err) }, { status: 400 });
  }
};

export const config: Config = { path: "/api/portal/client/*" };

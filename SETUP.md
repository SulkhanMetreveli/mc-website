# Met Capital — Portal & Company Panel: Setup Guide

Everything on met.capital runs on **Netlify** alone: static pages in
`site/`, server code in `netlify/functions/`, data and files in **Netlify
Blobs**. There is no database to administer, no SQL to run, and nothing to
deploy by hand — every push to `main` ships the whole system.

What lives where:

| Area | URL | Code | Blob stores |
| --- | --- | --- | --- |
| Marketing site + forms | `/` | `site/*.html` (Netlify Forms) | — |
| Client portal | `/clients/` | `netlify/functions/portal-auth.mts`, `portal-client.mts` | `portal`, `portal-files` |
| Company panel | `/admin/` | `portal-auth.mts`, `portal-admin.mts` | `portal`, `portal-files` |
| Document Management app | `/admin/dms/` | `portal-dms.mts` | `portal`, `portal-files` |
| HR app + staff portal | `/admin/hr/`, `/staff/` | `hr-admin.mts`, `hr-staff.mts` | `hr`, `hr-files` |
| Shared server helpers | — | `netlify/functions/_lib/common.mts`, `portal.mts`, `hr.mts` | — |
| Shared browser helper | — | `site/clients/assets/portal.js`, `site/staff/assets/staff-auth.js` | — |

## 1. First-time migration from Supabase (one-off)

If the portal previously ran on Supabase, copy the data across once:

1. Supabase → SQL Editor → run `supabase/EXPORT_FOR_MIGRATION.sql`. It
   exposes existing logins (email + bcrypt hash) to the service key so
   **nobody has to change their password**.
2. Copy the project's **service_role** key (Supabase → Project Settings →
   API).
3. Open **met.capital/admin/import/**. While the site has no logins yet, the
   service key itself is the credential; afterwards only a Super Admin can
   open the page. Paste the URL and the key, press *Start import*, and wait
   for *done*. The key is sent only to this site's own functions and is
   never stored.
4. Sign in at `/admin/login/` with your usual email and password. Everyone
   (clients, admins) gets a fresh 7-day window to set up two-factor again —
   authenticator secrets cannot be exported from Supabase.
5. Pause or delete the Supabase project.

The import copies: logins, client profiles, admin grants, investment
vehicles, documents (with files), withdrawal / address-bank / onboarding /
document / general-document submissions (with files), and the DMS
categories and documents (with files). Re-running it overwrites the copy
here with whatever is in Supabase, so run it once and move on.

## 2. Logins, roles and two-factor

One login (email + password) can be a **client** (has a client profile) and
/or an **admin** (has a role and app list). Clients sign in at
`/clients/login/`, admins at `/admin/login/`; each door only admits its own
kind. Staff (employees and contractors) have separate accounts in the HR
app and sign in at `/staff/login/`.

- **Super Admin** — every app, plus the *Admin Users* section on `/admin/`:
  add an admin (creates their login; the temporary password is shown once
  for you to pass on — nothing is emailed), change apps, reset password,
  reset 2FA, remove.
- **Admin** — only the apps ticked: `client_dashboard`, `operations`,
  `sales`, `dms`, `hr`. Enforced in the UI *and* in every API function.
- **Two-factor** is mandatory for all three logins: authenticator app
  (TOTP), 7-day grace period from a person's first sign-in, "remember this
  device for 7 days", 8 single-use recovery codes. Using a recovery code
  or an admin reset removes the authenticator and opens a fresh 7-day
  window. Resets: Super Admin → admins; Client Dashboard → clients (on the
  client page); HR → staff (on the employee record). Verify the person by
  phone first.
- Password rules: minimum 10 characters; new logins must change their
  temporary password at first sign-in; 5 failed attempts lock an email for
  15 minutes; sessions are HttpOnly cookies valid 12 hours.

## 3. Company panel apps

- **Client Dashboard** (`/admin/clients/`) — clients, investment vehicles,
  Document Center uploads, and review queues for onboarding, address & bank
  updates, withdrawals, passport/proof submissions and general documents.
  Documents in the Document Center can be edited after upload (Edit on the
  row): correct the title or category, and optionally replace the file — the
  old file is deleted and the client sees the new one immediately.
  Per-client page: `/admin/client/?u=<id>`. Nothing a client submits is
  applied automatically: approving an address change copies the address to
  the profile; approving a document submission copies the file into the
  client's Document Center; bank, passport and withdrawal approvals only
  record the decision — action them in your banking/custodian systems after
  verifying the client by phone.
- **Operations Management** — served at met.capital/operations/ (proxied
  from the metoperationscontrol Netlify site; its own login).
- **Sales Pipeline** — links to qo-lp-dashboard.netlify.app (its own login).
- **HR — Employees** (`/admin/hr/`) — employee and contractor records,
  time-off/absence, documents (4MB each), bank details in UK / IBAN / US /
  Other formats validated server-side, pending bank changes to approve,
  password and 2FA resets. Staff self-service at `/staff/`.
- **Document Management** (`/admin/dms/`) — nested categories, documents
  with type/description/related party, action-required workflow with
  due dates, search, bulk move, file attachments of any type up to 50MB.

## 4. Files

Uploads go through `/api/portal/auth/upload/*` in 4MB chunks and are
assembled server-side, so PDFs up to 25MB (portal) and files up to 50MB
(DMS) work despite the 6MB function request limit. Downloads stream from
`/api/portal/auth/files/<key>`; who may read a file is decided from its
key: `client-documents/<client-id>/…` and `kyc-files/<client-id>/…` — that
client or a Client Dashboard admin; `dms-files/…` — DMS admins.

## 5. Marketing forms

Contact and Careers are Netlify Forms with a honeypot field. To be emailed
on new entries: Netlify → Forms → Form notifications → add an email
notification to sulkhan@met.capital.

## Security notes

- No automatic emails to clients, ever; all communication is manual.
- Client- or staff-submitted changes to address, bank or payout details are
  staged and must be verified by phone before an admin applies them.
- Passwords are bcrypt-hashed; session and device tokens are stored as
  SHA-256 hashes; TOTP secrets never leave the server; recovery codes are
  stored hashed and shown once.
- Every API function re-checks the session, the second factor, the account
  kind and the app grant on every call — the UI is never the only gate.
- The GitHub token used to push this project was shared in chat and should
  be rotated. The old Supabase keys stop mattering once that project is
  deleted.

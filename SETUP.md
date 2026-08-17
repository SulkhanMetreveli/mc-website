# Met Capital Client Portal — Setup Guide

This adds a client portal at `/clients` and an internal admin panel at
`/admin` on top of the existing static met.capital site. It uses
[Supabase](https://supabase.com) (free tier is enough to start) for real
per-client login, a database, and private file storage — a static site
alone can't do any of that securely.

## 1. Create a Supabase project

1. Go to https://supabase.com, sign up / sign in, and create a new project.
2. Pick a region close to your users (e.g. `eu-west-2` for UK).
3. Wait for it to finish provisioning (~2 minutes).

## 2. Run the database schema

1. In the Supabase dashboard, open **SQL Editor -> New query**.
2. Paste the entire contents of `supabase/schema.sql` from this repo and run it.
   (If you set the portal up before certain features existed, you can
   instead run the individual `supabase/00N_*.sql` migration files —
   they're all safe to run on top of an existing database.)
3. Go to **Storage** and confirm two new buckets exist: `client-documents`
   and `kyc-files`, both marked **Private**. `kyc-files` should show
   `application/pdf` as its only allowed MIME type.

## 3. Get your API keys

In the Supabase dashboard: **Project Settings -> API**.

- **Project URL** and **anon / public key** → go in the frontend (safe to
  be public — they only grant what the Row Level Security policies in
  `schema.sql` allow).
- **service_role key** → NEVER put this in the frontend. It's only used
  in two places, both server-side: the `local-admin-tools` script on your
  own machine (optional, see below), and the `admin-create-client` Edge
  Function (see step 5).

## 4. Configure the frontend

Edit `clients/assets/supabase-config.js` and replace the two placeholder
values with your Project URL and anon key from step 3. Commit and push —
Netlify will redeploy automatically if it's already connected to this repo.
The admin panel (`/admin`) reads the same config file, so this one edit
covers both.

## 5. Make yourself an admin and deploy the create-client function

**Become an admin:**
1. Supabase dashboard → **Authentication → Users → Add user**. Use your
   own email, set a password, check **Auto Confirm User**.
2. Copy the new user's UID.
3. **Table Editor → admin_users → Insert row**: `user_id` = that UID,
   `full_name` = your name.
4. Log in at `/admin/login/` with that email/password.

**Deploy the Edge Functions** (`admin-create-client` and
`admin-reset-password` — these power the "Add a New Client" form and the
"Reset Password" button in `/admin/`):

Via the CLI, if you have a terminal:
```
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>      # e.g. qnysvjbqltnwkjkvjwov
supabase functions deploy admin-create-client
supabase functions deploy admin-reset-password
```

Or with no terminal at all: Supabase dashboard -> **Edge Functions** ->
**Deploy a new function** -> name it exactly `admin-create-client` ->
paste the contents of `supabase/functions/admin-create-client/index.ts`
into the code editor -> **Deploy**. Repeat with `admin-reset-password`
and `supabase/functions/admin-reset-password/index.ts`. (Note: dashboard
deployment isn't available on every Supabase plan — if the deploy button
is missing or greyed out, the CLI route above is the fallback.)

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
automatically available to the function — you don't need to configure
secrets manually. Once deployed, the **Add a New Client** form on
`/admin/` works end-to-end: it creates the login, creates the matching
`client_profiles` row, and shows you a one-time temporary password to
send the client.

**No Supabase CLI / don't want to deploy a function?** Use the offline
fallback instead — see `local-admin-tools/README.md`. It does the exact
same thing from your terminal, using the service_role key directly:

```
cd local-admin-tools
npm install
cp .env.example .env
# edit .env: paste your Project URL and service_role key
node create-client.js --email jane@example.com --name "Jane Client" --reference MC-00123
```

## 6. Day-to-day admin — now via `/admin`

Log in at `/admin/login/` with any account listed in `admin_users`.
From there:

- **Dashboard** (`/admin/`) — pending-item counts across onboarding,
  address/bank updates, and withdrawals; a **Pending Requests** table
  showing exactly which client submitted what and when (click "Review"
  to jump straight to them); the full client list; and the "Add a New
  Client" form.
- **Client page** (`/admin/client/?u=<uuid>`, reached by clicking
  "Manage" on any client) — everything about one client in one place:
  - Edit their profile and **address of record** (this is what shows on
    their dashboard — update it here once you've verified a change, it's
    never automatic). Also has optional fields for **phone number** and
    **banking details on file** (account holder, bank name, account
    number/IBAN, SWIFT/BIC, bank country) — added in
    `supabase/011_client_profile_extra_fields.sql`. These are for your
    own records only: nothing client-facing reads them, saving here
    doesn't move money, and they're separate from the client-submitted
    address/bank update request workflow.
  - Add/edit/delete their **investment vehicles** — one row per
    product/currency they hold. These show as separate cards on their
    dashboard and become quick-pick currencies on their Withdrawal
    Request and Payout Currency forms. The Currency dropdown includes
    a **Multicurrency Account** option for vehicles that hold several
    currencies at once — the balance shows without a fixed currency
    symbol, and when a client withdraws from one of these, they pick
    which currency to withdraw in at that point rather than it being
    locked automatically.
  - Upload/delete **documents** (statements, tax docs, agreements) —
    they appear in the client's Document Center immediately.
  - Review **document submissions** — a client can submit a new
    passport copy and/or proof of address at any time from their
    Documents page, separate from onboarding or an address/bank update
    request (added in `supabase/010_document_submissions.sql`). Has the
    same Mark In Review / Approve / Reject flow as everything else.
    **Approving copies the file(s) straight into that client's Document
    Center** (the same "documents" table/bucket you upload to above) —
    that's the whole point of this feature, so nothing further needed
    on your end after clicking Approve.
  - Review **general document submissions** — a client can also upload
    any single document with a title of their own choosing, from a
    separate "Upload a Document" button on their Documents page (added
    in `supabase/012_general_document_submissions.sql`). Not limited to
    passport/proof of address, and not bundled with any other field.
    Same Mark In Review / Approve / Reject flow, and approving copies
    it into the Document Center the same way. If you reject one, the
    file itself is never deleted — you (and the client, on their own
    submissions list) can still open and view it, it just never gets
    copied into their Document Center.
  - Review **onboarding submissions**, including a direct link to view
    the passport copy and proof-of-address PDFs, with Approve/Reject
    buttons — plus a **Mark In Review** button that moves a pending
    submission into an "In Transit — Documents in Review" state (added
    in `supabase/007_document_review_status.sql`), useful for signalling
    you've started looking at it without committing to approve/reject
    yet. The client sees this status too if they check their onboarding
    page again.
  - Review **address & bank update requests** — a client can submit an
    address change, a payout bank change, a passport refresh, or any
    combination, in one form (added in
    `supabase/006_address_update_optional_sections.sql` — run that
    migration if you set the portal up before this existed). Proof of
    address is required on every submission regardless of what else is
    included. Also has a **Mark In Review** button for the same "In
    Transit — Documents in Review" status as onboarding. Approving
    copies the new address straight to the profile in the same click,
    only if an address change was actually part of the request.
    **Verify the client by phone before clicking Approve**
    — this step doesn't verify anything for you, and nothing here ever
    touches your actual banking/custodian system or physical records
    automatically.
  - Review **withdrawal requests** — same rule: verify by phone, then
    mark approved/rejected. Also has a **Mark In Review** button (added
    in `supabase/008_withdrawal_in_review_status.sql`) if you want to
    flag one as "In Transit — Documents in Review" for any reason —
    there's currently no client-facing page that shows withdrawal
    request status, so this is admin-visible only. Approving here is a
    record-keeping action only; you still action the actual payment
    separately.
  - **Reset Password** — generates a new temporary password and forces
    the client to set their own on next login. Nothing is ever emailed
    automatically anywhere in this system; the new password is shown to
    you once, to send however you choose. Needs the
    `admin-reset-password` Edge Function deployed (see step 5 above),
    or use `local-admin-tools/reset-password.js` as an offline
    fallback.

Everything in the admin panel respects the same rule we designed from
the start: **no financial or identity change ever applies itself.** The
UI just makes the review/approve workflow faster than hand-editing
tables — it still relies on you doing the out-of-band verification call.

The Supabase Table Editor is still there as a fallback if you ever need
to fix something the UI doesn't cover.

## Security notes

- The GitHub token and Supabase secret key used earlier in this project
  should be treated as compromised (they were shared in chat) — rotate
  them if you haven't.
- The Supabase **anon key** is meant to be public; the **service_role
  key** is not. It's used in exactly two places — the Edge Function
  (server-side, never sent to a browser) and `local-admin-tools/.env`
  (kept out of git by `.gitignore`, never in the frontend).
- Being listed in the `admin_users` table is what grants admin access —
  there's no self-serve way for a client account to add itself there
  (no INSERT policy exists for normal users). Only add rows to it from
  the Supabase dashboard yourself.
- All data access is enforced by Postgres Row Level Security: clients
  only ever see their own rows; admins see everything, but only because
  they're listed in `admin_users`. Don't remove these policies.
- For real production use, also consider: enforcing MFA for your own
  Supabase dashboard login, enabling Supabase's leaked-password
  protection, and periodically auditing `admin_users` and
  `client_profiles` for accounts that should be removed/suspended.

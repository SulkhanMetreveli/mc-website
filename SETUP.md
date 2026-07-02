# Met Capital Client Portal — Setup Guide

This adds a client portal at `/clients` on top of the existing static
met.capital site. It uses [Supabase](https://supabase.com) (free tier is
enough to start) for real per-client login, a database, and private file
storage — a static site alone can't do any of that securely.

## 1. Create a Supabase project

1. Go to https://supabase.com, sign up / sign in, and create a new project.
2. Pick a region close to your users (e.g. `eu-west-2` for UK).
3. Wait for it to finish provisioning (~2 minutes).

## 2. Run the database schema

1. In the Supabase dashboard, open **SQL Editor -> New query**.
2. Paste the entire contents of `supabase/schema.sql` from this repo and run it.
3. Go to **Storage** and confirm two new buckets exist: `client-documents`
   and `kyc-files`, both marked **Private**. `kyc-files` should show
   `application/pdf` as its only allowed MIME type.

## 3. Get your API keys

In the Supabase dashboard: **Project Settings -> API**.

- **Project URL** and **anon / public key** → go in the frontend (safe to
  be public — they only grant what the Row Level Security policies in
  `schema.sql` allow).
- **service_role key** → NEVER put this in the frontend. It's only used by
  the local admin script in step 5, on your own machine.

## 4. Configure the frontend

Edit `clients/assets/supabase-config.js` and replace the two placeholder
values with your Project URL and anon key from step 3. Commit and push —
Netlify will redeploy automatically if it's already connected to this repo.

## 5. Create your first client account

```
cd admin
npm install
cp .env.example .env
# edit .env: paste your Project URL and service_role key
node create-client.js --email jane@example.com --name "Jane Client" --reference MC-00123
```

This prints a username (their email) and a temporary password. Send that
to the client over a secure channel. They'll be forced to set their own
password the first time they log in at `/clients/login/`.

Repeat this command for each client. There's no self-serve signup — every
account is created by you, on purpose.

## 6. Day-to-day admin

Everything below is done from the Supabase dashboard (**Table Editor**),
no code needed:

- **Account overview numbers** (balance, performance): edit rows in the
  `account_overview` table. One row per client (`user_id`).
- **Documents**: upload a file in **Storage -> client-documents** under a
  folder named with the client's `user_id`, then add a row to the
  `documents` table pointing at that path so it shows up in their portal.
- **Address / bank update requests**: review new rows in
  `address_update_requests`. **Verify the client out-of-band (phone call
  to the number already on file) before actually changing anything in
  your systems** — this form only records a request, it never applies a
  change automatically. Mark `status` as `approved` or `rejected` once
  handled.
- **Onboarding submissions**: review `onboarding_submissions`, including
  the linked passport and proof-of-address PDFs in the `kyc-files`
  bucket, before marking a client active.

## Security notes

- The GitHub token used earlier in this project should already be treated
  as compromised (it was shared in chat) — rotate it in GitHub settings if
  you haven't.
- The Supabase **anon key** is meant to be public; the **service_role
  key** is not — keep `admin/.env` out of git (already handled by
  `.gitignore`) and never paste it into the `/clients` frontend.
- All client data access is enforced by Postgres Row Level Security: a
  logged-in client can only ever read/write rows where `user_id` matches
  their own auth ID. Don't remove those policies.
- For real production use, also consider: enforcing MFA for your own
  Supabase dashboard login, enabling Supabase's leaked-password
  protection, and periodically auditing the `client_profiles` table for
  accounts that should be suspended.

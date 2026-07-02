# Local admin tools (offline client creation)

This folder is for **your local machine only**. It's an optional fallback
for creating client accounts from the command line if you don't want to
deploy the `admin-create-client` Edge Function — the `/admin/` dashboard's
"Add a New Client" form does the same thing without needing this.

Note: since this site has no build step, everything in this repo
(including this folder) is technically fetchable by URL if someone knows
the exact path — nothing here is linked from the site, and no secrets are
ever committed (`.env` is git-ignored), but don't rely on the file simply
not being linked as your only protection. If that matters to you,
consider moving to a proper build/publish step later that only ships the
`clients/`, `admin/`, and root site files.

## One-time setup

```
cd local-admin-tools
npm install
cp .env.example .env
# edit .env and fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
# (Project Settings -> API in your Supabase dashboard — the "service_role" key,
# NOT the "anon" key)
```

## Create a client account

```
node create-client.js --email client@example.com --name "Jane Client" --reference MC-00123
```

Omit `--password` to auto-generate a strong temporary one (recommended).
The script prints the username/password once — copy it immediately and
send it to the client over a secure channel. They'll be forced to set
their own password on first login.

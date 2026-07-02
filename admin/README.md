# Admin: creating client accounts

This folder is for **your local machine only** — it is never deployed to
the public site (it's excluded via `.gitignore`-style handling in
SETUP.md and contains no build output that Netlify would publish, since
`/clients` is served separately from `/admin`).

## One-time setup

```
cd admin
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

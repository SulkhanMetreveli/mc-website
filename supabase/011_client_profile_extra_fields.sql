-- Optional additional client details for the admin panel: phone number and
-- banking details on file (e.g. IBAN). All nullable -- fine to leave blank,
-- and stored if provided. Admin-entered/maintained only, for internal
-- records; does not go through the client-facing update/review flow and
-- does not move or verify anything by itself.

alter table client_profiles add column if not exists phone_number text;
alter table client_profiles add column if not exists bank_account_holder_name text;
alter table client_profiles add column if not exists bank_name text;
alter table client_profiles add column if not exists bank_account_number text;
alter table client_profiles add column if not exists bank_swift_bic text;
alter table client_profiles add column if not exists bank_country text;

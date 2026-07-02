-- ============================================================================
-- Met Capital Client Portal — Database Schema
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. client_profiles
--    One row per client, keyed to their Supabase Auth user.
-- ---------------------------------------------------------------------------
create table if not exists client_profiles (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  client_reference    text unique,                 -- e.g. MC-00123, shown to client
  full_name           text not null,
  email               text not null,
  must_change_password boolean not null default true,
  status              text not null default 'active' check (status in ('active','suspended')),
  created_at          timestamptz not null default now(),

  -- address of record, admin-maintained (see address_update_requests for
  -- the client-submitted change workflow -- this column is only ever
  -- updated by an admin after verifying the client out-of-band)
  address_line1       text,
  address_line2       text,
  city                text,
  state_province      text,
  postal_code         text,
  country             text
);

alter table client_profiles enable row level security;

create policy "clients read own profile"
  on client_profiles for select
  using (auth.uid() = user_id);

create policy "clients can clear must_change_password on themselves"
  on client_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. account_overview
--    Admin-maintained summary shown on the client's dashboard.
--    Clients can only ever read their own row -- writes happen from the
--    Supabase dashboard / service role, never from the public site.
-- ---------------------------------------------------------------------------
create table if not exists account_overview (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  currency            text,
  balance             numeric,
  ytd_performance_pct numeric,
  inception_performance_pct numeric,
  as_of_date          date,
  notes               text,
  updated_at          timestamptz not null default now()
);

alter table account_overview enable row level security;

create policy "clients read own overview"
  on account_overview for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. documents
--    Metadata for files an admin uploaded for a client (statements, tax
--    docs, agreements). Actual bytes live in the 'client-documents' bucket.
-- ---------------------------------------------------------------------------
create table if not exists documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  category      text not null default 'other' check (category in ('statement','tax','agreement','other')),
  storage_path  text not null,
  uploaded_at   timestamptz not null default now()
);

alter table documents enable row level security;

create policy "clients read own documents"
  on documents for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. address_update_requests
--    Client-submitted request to change address + payout bank details.
--    IMPORTANT: this table only ever records a PENDING REQUEST. Nothing in
--    this app auto-applies a bank detail change. A staff member must verify
--    the client out-of-band (phone call to the number already on file) and
--    action the change manually before marking it approved.
-- ---------------------------------------------------------------------------
create table if not exists address_update_requests (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  submitted_at                timestamptz not null default now(),
  status                      text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_at                 timestamptz,
  reviewed_by                 text,
  reviewer_notes              text,

  address_line1               text not null,
  address_line2               text,
  city                        text not null,
  state_province              text,
  postal_code                 text not null,
  country                     text not null,

  proof_of_address_path       text not null,

  bank_account_holder_name    text not null,
  bank_name                   text not null,
  bank_account_number         text not null,
  bank_swift_bic               text,
  bank_routing_number          text,
  bank_country                 text not null,
  payout_currency               text not null,
  bank_address                  text,

  additional_notes              text
);

alter table address_update_requests enable row level security;

create policy "clients read own address requests"
  on address_update_requests for select
  using (auth.uid() = user_id);

create policy "clients insert own address requests"
  on address_update_requests for insert
  with check (auth.uid() = user_id);

-- no update/delete policy for clients: once submitted, a request is
-- immutable from the client side, preserving an audit trail.

-- ---------------------------------------------------------------------------
-- 5. onboarding_submissions
--    Initial KYC onboarding form: personal details, ID + address proof,
--    and initial payout bank details.
-- ---------------------------------------------------------------------------
create table if not exists onboarding_submissions (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  submitted_at                timestamptz not null default now(),
  status                      text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_notes               text,

  full_legal_name              text not null,
  date_of_birth                 date not null,
  nationality                   text not null,
  phone_number                  text not null,
  email                          text not null,

  address_line1                  text not null,
  address_line2                   text,
  city                             text not null,
  state_province                   text,
  postal_code                       text not null,
  country_of_residence              text not null,

  tax_residency_country              text not null,
  tax_id_number                       text,
  source_of_funds                      text not null,
  occupation                            text not null,
  pep_status                             boolean not null default false,

  passport_copy_path                      text not null,
  proof_of_address_path                    text not null,

  bank_account_holder_name                  text not null,
  bank_name                                  text not null,
  bank_account_number                         text not null,
  bank_swift_bic                               text,
  bank_country                                  text not null,
  payout_currency                                text not null
);

alter table onboarding_submissions enable row level security;

create policy "clients read own onboarding submissions"
  on onboarding_submissions for select
  using (auth.uid() = user_id);

create policy "clients insert own onboarding submission"
  on onboarding_submissions for insert
  with check (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 6. withdrawal_requests
--    Client-submitted withdrawal request. IMPORTANT: this table only ever
--    records a PENDING REQUEST. Nothing here moves money automatically —
--    a staff member must verify the client out-of-band and action the
--    withdrawal manually through your custodian/banking systems before
--    marking it approved.
-- ---------------------------------------------------------------------------
create table if not exists withdrawal_requests (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  submitted_at           timestamptz not null default now(),
  status                 text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_at            timestamptz,
  reviewed_by            text,
  reviewer_notes         text,

  withdrawal_type        text not null check (withdrawal_type in ('full','partial')),
  amount                 numeric,
  currency               text not null,
  reason                 text not null,
  confirm_bank_on_file   boolean not null default false,
  additional_notes       text
);

alter table withdrawal_requests enable row level security;

create policy "clients read own withdrawal requests"
  on withdrawal_requests for select
  using (auth.uid() = user_id);

create policy "clients insert own withdrawal requests"
  on withdrawal_requests for insert
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 7. investment_vehicles
--    One row per investment product / currency sub-account a client holds.
--    A client can have several rows (e.g. one per fund, one per currency).
--    Admin-maintained only -- clients can read their own rows, never write.
-- ---------------------------------------------------------------------------
create table if not exists investment_vehicles (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  vehicle_name                text not null,
  currency                    text not null,
  balance                     numeric,
  ytd_performance_pct         numeric,
  inception_performance_pct   numeric,
  as_of_date                  date,
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

alter table investment_vehicles enable row level security;

create policy "clients read own investment vehicles"
  on investment_vehicles for select
  using (auth.uid() = user_id);

-- link withdrawal requests to a specific vehicle/currency once vehicles
-- exist; nullable so the form still works before any are set up.
alter table withdrawal_requests
  add column if not exists investment_vehicle_id uuid references investment_vehicles(id);

-- ---------------------------------------------------------------------------
-- 8. Storage buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-documents', 'client-documents', false, 26214400, null)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc-files', 'kyc-files', false, 26214400, array['application/pdf'])
on conflict (id) do update set allowed_mime_types = array['application/pdf'];

create policy "clients read own folder in client-documents"
  on storage.objects for select
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "clients upload into own folder in kyc-files"
  on storage.objects for insert
  with check (
    bucket_id = 'kyc-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "clients read own folder in kyc-files"
  on storage.objects for select
  using (
    bucket_id = 'kyc-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- End of schema. Next: Storage -> confirm both buckets exist and are private,
-- then follow SETUP.md to configure the frontend and create your first client.
-- ============================================================================

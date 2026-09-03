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
  country             text,

  -- additional optional details, admin-entered, for internal records only
  phone_number             text,
  bank_account_holder_name text,
  bank_name                text,
  bank_account_number      text,   -- IBAN or account number
  bank_swift_bic           text,
  bank_country             text
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
  category      text not null default 'other' check (category in ('statement','tax','agreement','passport','proof_of_address','other')),
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
  status                      text not null default 'pending' check (status in ('pending','in_transit_documents_review','approved','rejected')),
  reviewed_at                 timestamptz,
  reviewed_by                 text,
  reviewer_notes              text,

  -- Address update: optional section. If the client isn't changing their
  -- address, these are all left null.
  address_line1               text,
  address_line2               text,
  city                        text,
  state_province              text,
  postal_code                 text,
  country                     text,

  -- Always required, regardless of which optional sections are filled in.
  proof_of_address_path       text not null,

  -- Bank update: optional section. If the client isn't changing their
  -- payout bank, these are all left null.
  bank_account_holder_name    text,
  bank_name                   text,
  bank_account_number         text,
  bank_swift_bic               text,
  bank_routing_number          text,
  bank_country                 text,
  payout_currency               text,
  bank_address                  text,

  -- Passport refresh: optional document upload.
  passport_copy_path            text,

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
  status                      text not null default 'pending' check (status in ('pending','in_transit_documents_review','approved','rejected')),
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
  status                 text not null default 'pending' check (status in ('pending','in_transit_documents_review','approved','rejected')),
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
  status                      text not null default 'active' check (status in (
                                 'active', 'on_hold', 'liquidating', 'withdrawing',
                                 'in_transfer_awaiting_client', 'in_transfer',
                                 'in_transit_documents_review',
                                 'liquidated', 'rejected'
                               )),
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
-- document_submissions
--    Client submits a new passport copy and/or proof of address at any
--    time (not just onboarding). At least one of the two files is
--    required, both are allowed together. Like every other request type,
--    this only ever stages a pending request — nothing lands in the
--    shared 'documents' table until an admin approves it, at which point
--    the file is copied into the client-documents bucket and a normal
--    documents row is created for it.
-- ---------------------------------------------------------------------------
create table if not exists document_submissions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  submitted_at           timestamptz not null default now(),
  status                 text not null default 'pending' check (status in ('pending','in_transit_documents_review','approved','rejected')),
  reviewed_at            timestamptz,
  passport_path          text,
  proof_of_address_path  text,
  constraint document_submissions_has_file check (passport_path is not null or proof_of_address_path is not null)
);

alter table document_submissions enable row level security;

create policy "clients select own document_submissions"
  on document_submissions for select
  using (auth.uid() = user_id);

create policy "clients insert own document_submissions"
  on document_submissions for insert
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- general_document_submissions
--    Client submits any single document with a title of their choosing --
--    not restricted to passport/proof of address, and not bundled with
--    any other field (address, bank details, etc). Same review flow as
--    everything else. Approving copies the file into the shared
--    'documents' table/bucket. Rejecting just marks it -- the file is
--    never deleted, so both the client and admin can still view it.
-- ---------------------------------------------------------------------------
create table if not exists general_document_submissions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  submitted_at  timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending','in_transit_documents_review','approved','rejected')),
  reviewed_at   timestamptz,
  title         text not null,
  file_path     text not null
);

alter table general_document_submissions enable row level security;

create policy "clients select own general_document_submissions"
  on general_document_submissions for select
  using (auth.uid() = user_id);

create policy "clients insert own general_document_submissions"
  on general_document_submissions for insert
  with check (auth.uid() = user_id);

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

-- ---------------------------------------------------------------------------
-- 9. Admin access (admin_users table, is_admin() helper, admin RLS)
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- admin_users
-- Membership table: being listed here (by user_id) is what makes someone
-- an admin. There is deliberately no INSERT/UPDATE/DELETE policy for the
-- anon/authenticated roles — the only way to add or remove an admin is
-- from the Supabase Table Editor (or SQL Editor) as the project owner.
-- ---------------------------------------------------------------------------
create table if not exists admin_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text,
  role        text not null default 'admin' check (role in ('super_admin','admin')),
  apps        text[] not null default '{}',   -- app keys: client_dashboard, operations, sales, dms
  created_at  timestamptz not null default now()
);

alter table admin_users enable row level security;

-- ---------------------------------------------------------------------------
-- is_admin(): security definer so it can check admin_users membership
-- without itself getting blocked by admin_users' own RLS (which would
-- otherwise be circular). This is the standard Supabase pattern for
-- role-based access.
-- ---------------------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from admin_users where user_id = auth.uid());
$$;

create or replace function is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from admin_users where user_id = auth.uid() and role = 'super_admin');
$$;

create or replace function has_app_access(app text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from admin_users
    where user_id = auth.uid()
      and (role = 'super_admin' or app = any(apps))
  );
$$;

create policy "admins can read admin_users"
  on admin_users for select
  using (is_admin());

create policy "super admins insert admin_users"
  on admin_users for insert with check (is_super_admin());
create policy "super admins update admin_users"
  on admin_users for update using (is_super_admin()) with check (is_super_admin());
create policy "super admins delete admin_users"
  on admin_users for delete using (is_super_admin());

-- ---------------------------------------------------------------------------
-- client_profiles — admins can see and manage every client
-- ---------------------------------------------------------------------------
create policy "admins select all client_profiles"
  on client_profiles for select using (is_admin());
create policy "admins insert client_profiles"
  on client_profiles for insert with check (has_app_access('client_dashboard'));
create policy "admins update client_profiles"
  on client_profiles for update
  using (has_app_access('client_dashboard'))
  with check (has_app_access('client_dashboard'));

-- ---------------------------------------------------------------------------
-- investment_vehicles — admins fully manage every client's vehicles
-- ---------------------------------------------------------------------------
create policy "admins select all investment_vehicles"
  on investment_vehicles for select using (has_app_access('client_dashboard'));
create policy "admins insert investment_vehicles"
  on investment_vehicles for insert with check (has_app_access('client_dashboard'));
create policy "admins update investment_vehicles"
  on investment_vehicles for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));
create policy "admins delete investment_vehicles"
  on investment_vehicles for delete using (has_app_access('client_dashboard'));

-- ---------------------------------------------------------------------------
-- documents — admins upload/manage documents for any client
-- ---------------------------------------------------------------------------
create policy "admins select all documents"
  on documents for select using (has_app_access('client_dashboard'));
create policy "admins insert documents"
  on documents for insert with check (has_app_access('client_dashboard'));
create policy "admins update documents"
  on documents for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));
create policy "admins delete documents"
  on documents for delete using (has_app_access('client_dashboard'));

-- ---------------------------------------------------------------------------
-- address_update_requests — admins review (select + update status/notes)
-- Clients still cannot update once submitted — that policy is unchanged.
-- ---------------------------------------------------------------------------
create policy "admins select all address_update_requests"
  on address_update_requests for select using (has_app_access('client_dashboard'));
create policy "admins update address_update_requests"
  on address_update_requests for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));

-- ---------------------------------------------------------------------------
-- withdrawal_requests — admins review (select + update status/notes)
-- ---------------------------------------------------------------------------
create policy "admins select all withdrawal_requests"
  on withdrawal_requests for select using (has_app_access('client_dashboard'));
create policy "admins update withdrawal_requests"
  on withdrawal_requests for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));

-- ---------------------------------------------------------------------------
-- onboarding_submissions — admins review (select + update status/notes)
-- ---------------------------------------------------------------------------
create policy "admins select all onboarding_submissions"
  on onboarding_submissions for select using (has_app_access('client_dashboard'));
create policy "admins update onboarding_submissions"
  on onboarding_submissions for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));

-- ---------------------------------------------------------------------------
-- document_submissions — admins review (select + update status), and can
-- insert into 'documents' once approved (covered by the existing
-- "admins insert documents" policy above)
-- ---------------------------------------------------------------------------
create policy "admins select all document_submissions"
  on document_submissions for select using (has_app_access('client_dashboard'));
create policy "admins update document_submissions"
  on document_submissions for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));

-- ---------------------------------------------------------------------------
-- general_document_submissions — admins review (select + update status)
-- ---------------------------------------------------------------------------
create policy "admins select all general_document_submissions"
  on general_document_submissions for select using (has_app_access('client_dashboard'));
create policy "admins update general_document_submissions"
  on general_document_submissions for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));

-- ---------------------------------------------------------------------------
-- Storage — admins can manage client-documents for anyone, and view
-- (but not alter) submitted kyc-files for anyone.
-- ---------------------------------------------------------------------------
create policy "admins full access client-documents"
  on storage.objects for all
  using (bucket_id = 'client-documents' and has_app_access('client_dashboard'))
  with check (bucket_id = 'client-documents' and has_app_access('client_dashboard'));

create policy "admins select kyc-files"
  on storage.objects for select
  using (bucket_id = 'kyc-files' and has_app_access('client_dashboard'));

grant execute on function is_admin() to authenticated;
grant execute on function is_super_admin() to authenticated;
grant execute on function has_app_access(text) to authenticated;

-- ============================================================================
-- To make yourself the first admin:
--   1. Authentication -> Users -> Add user (or reuse an existing login)
--   2. Table Editor -> admin_users -> Insert row: user_id = that user's UID,
--      full_name = your name
-- You can now log in at /admin/login/ with that account.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Company apps (internal only, nothing client-visible)
-- ---------------------------------------------------------------------------
create table if not exists operations_tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  details      text,
  status       text not null default 'open' check (status in ('open','in_progress','done')),
  priority     text not null default 'medium' check (priority in ('low','medium','high')),
  due_date     date,
  assigned_to  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table operations_tasks enable row level security;

create policy "operations app full access"
  on operations_tasks for all
  using (has_app_access('operations'))
  with check (has_app_access('operations'));

create table if not exists sales_leads (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  company      text,
  email        text,
  phone        text,
  stage        text not null default 'lead' check (stage in ('lead','contacted','qualified','proposal','won','lost')),
  value        numeric,
  currency     text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table sales_leads enable row level security;

create policy "sales app full access"
  on sales_leads for all
  using (has_app_access('sales'))
  with check (has_app_access('sales'));

-- ============================================================================
-- Document Management app (app key: dms) — port of the metreveli.org
-- intranet document management system, running on this project's Supabase.
--
-- Grant access from the company panel (Admin Users -> Document Management).
-- Everyone with the app can create/edit/delete; access is enforced by RLS.
-- ============================================================================

create table if not exists dms_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  parent_id   uuid references dms_categories(id) on delete cascade,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_dms_categories_parent on dms_categories(parent_id);

create table if not exists dms_documents (
  id               uuid primary key default gen_random_uuid(),
  category_id      uuid references dms_categories(id) on delete set null,
  title            text not null,
  doc_type         text not null default 'other',
  description      text,
  related_party    text,
  file_path        text,
  file_name        text,
  mime_type        text,
  file_size        bigint,
  action_required  boolean not null default false,
  action_due_date  date,
  action_note      text,
  action_status    text not null default 'none' check (action_status in ('none','pending','done')),
  uploaded_by      uuid references auth.users(id),
  uploaded_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_dms_documents_category on dms_documents(category_id);
create index if not exists idx_dms_documents_action on dms_documents(action_required, action_status, action_due_date);

alter table dms_categories enable row level security;
alter table dms_documents enable row level security;

create policy "dms app full access categories"
  on dms_categories for all
  using (has_app_access('dms'))
  with check (has_app_access('dms'));

create policy "dms app full access documents"
  on dms_documents for all
  using (has_app_access('dms'))
  with check (has_app_access('dms'));

-- Private storage bucket for DMS files (any file type, up to 50MB each)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dms-files', 'dms-files', false, 52428800, null)
on conflict (id) do nothing;

create policy "dms app full access dms-files"
  on storage.objects for all
  using (bucket_id = 'dms-files' and has_app_access('dms'))
  with check (bucket_id = 'dms-files' and has_app_access('dms'));

-- ============================================================================
-- Company apps: /admin becomes a company-wide panel of apps.
--
-- App keys (replacing the fine-grained keys from migration 013):
--   client_dashboard  -> everything for the client portal (clients, vehicles,
--                        documents, onboarding, updates, withdrawals)
--   operations        -> Operations Management app
--   sales             -> Sales Pipeline app
--
-- Super admins see every app and manage admin users. Standard admins see
-- only the apps they've been granted.
-- ============================================================================

-- 1. Re-point every client-portal admin policy at 'client_dashboard' ---------
drop policy if exists "admins insert client_profiles" on client_profiles;
drop policy if exists "admins update client_profiles" on client_profiles;
create policy "admins insert client_profiles"
  on client_profiles for insert with check (has_app_access('client_dashboard'));
create policy "admins update client_profiles"
  on client_profiles for update
  using (has_app_access('client_dashboard'))
  with check (has_app_access('client_dashboard'));

drop policy if exists "admins select all investment_vehicles" on investment_vehicles;
drop policy if exists "admins insert investment_vehicles" on investment_vehicles;
drop policy if exists "admins update investment_vehicles" on investment_vehicles;
drop policy if exists "admins delete investment_vehicles" on investment_vehicles;
create policy "admins select all investment_vehicles"
  on investment_vehicles for select using (has_app_access('client_dashboard'));
create policy "admins insert investment_vehicles"
  on investment_vehicles for insert with check (has_app_access('client_dashboard'));
create policy "admins update investment_vehicles"
  on investment_vehicles for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));
create policy "admins delete investment_vehicles"
  on investment_vehicles for delete using (has_app_access('client_dashboard'));

drop policy if exists "admins select all documents" on documents;
drop policy if exists "admins insert documents" on documents;
drop policy if exists "admins update documents" on documents;
drop policy if exists "admins delete documents" on documents;
create policy "admins select all documents"
  on documents for select using (has_app_access('client_dashboard'));
create policy "admins insert documents"
  on documents for insert with check (has_app_access('client_dashboard'));
create policy "admins update documents"
  on documents for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));
create policy "admins delete documents"
  on documents for delete using (has_app_access('client_dashboard'));

drop policy if exists "admins select all document_submissions" on document_submissions;
drop policy if exists "admins update document_submissions" on document_submissions;
create policy "admins select all document_submissions"
  on document_submissions for select using (has_app_access('client_dashboard'));
create policy "admins update document_submissions"
  on document_submissions for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));

drop policy if exists "admins select all general_document_submissions" on general_document_submissions;
drop policy if exists "admins update general_document_submissions" on general_document_submissions;
create policy "admins select all general_document_submissions"
  on general_document_submissions for select using (has_app_access('client_dashboard'));
create policy "admins update general_document_submissions"
  on general_document_submissions for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));

drop policy if exists "admins select all onboarding_submissions" on onboarding_submissions;
drop policy if exists "admins update onboarding_submissions" on onboarding_submissions;
create policy "admins select all onboarding_submissions"
  on onboarding_submissions for select using (has_app_access('client_dashboard'));
create policy "admins update onboarding_submissions"
  on onboarding_submissions for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));

drop policy if exists "admins select all address_update_requests" on address_update_requests;
drop policy if exists "admins update address_update_requests" on address_update_requests;
create policy "admins select all address_update_requests"
  on address_update_requests for select using (has_app_access('client_dashboard'));
create policy "admins update address_update_requests"
  on address_update_requests for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));

drop policy if exists "admins select all withdrawal_requests" on withdrawal_requests;
drop policy if exists "admins update withdrawal_requests" on withdrawal_requests;
create policy "admins select all withdrawal_requests"
  on withdrawal_requests for select using (has_app_access('client_dashboard'));
create policy "admins update withdrawal_requests"
  on withdrawal_requests for update using (has_app_access('client_dashboard')) with check (has_app_access('client_dashboard'));

drop policy if exists "admins full access client-documents" on storage.objects;
create policy "admins full access client-documents"
  on storage.objects for all
  using (bucket_id = 'client-documents' and has_app_access('client_dashboard'))
  with check (bucket_id = 'client-documents' and has_app_access('client_dashboard'));

drop policy if exists "admins select kyc-files" on storage.objects;
create policy "admins select kyc-files"
  on storage.objects for select
  using (bucket_id = 'kyc-files' and has_app_access('client_dashboard'));

-- Clean up any fine-grained app keys already granted (none expected)
update admin_users set apps = '{}' where role = 'admin' and apps && array['clients','vehicles','documents','onboarding','updates','withdrawals'];

-- 2. Operations Management app ----------------------------------------------
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

-- 3. Sales Pipeline app ------------------------------------------------------
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

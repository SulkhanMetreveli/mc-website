-- ============================================================================
-- Admin roles: super_admin vs per-app access
--
-- App keys: clients, vehicles, documents, onboarding, updates, withdrawals
--
-- * super_admin  -> full access to every app + manages admin users
-- * admin        -> only the apps listed in their apps[] column
--
-- All EXISTING rows in admin_users are promoted to super_admin, so nothing
-- breaks for anyone who is already an admin today.
-- ============================================================================

-- 1. Columns ----------------------------------------------------------------
alter table admin_users add column if not exists role text not null default 'admin'
  check (role in ('super_admin','admin'));
alter table admin_users add column if not exists apps text[] not null default '{}';
alter table admin_users add column if not exists email text;

update admin_users set role = 'super_admin';

-- 2. Helper functions (security definer, same pattern as is_admin) ----------
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

grant execute on function is_super_admin() to authenticated;
grant execute on function has_app_access(text) to authenticated;

-- 3. admin_users management: super admins only ------------------------------
create policy "super admins insert admin_users"
  on admin_users for insert with check (is_super_admin());
create policy "super admins update admin_users"
  on admin_users for update using (is_super_admin()) with check (is_super_admin());
create policy "super admins delete admin_users"
  on admin_users for delete using (is_super_admin());

-- 4. Per-app policies replacing blanket admin policies ----------------------
-- client_profiles: every admin can still READ (names are needed to review
-- anything), but only 'clients' app (or 'updates', for the address-approve
-- copy step) can WRITE.
drop policy if exists "admins insert client_profiles" on client_profiles;
drop policy if exists "admins update client_profiles" on client_profiles;
create policy "admins insert client_profiles"
  on client_profiles for insert with check (has_app_access('clients'));
create policy "admins update client_profiles"
  on client_profiles for update
  using (has_app_access('clients') or has_app_access('updates'))
  with check (has_app_access('clients') or has_app_access('updates'));

-- investment_vehicles -> 'vehicles'
drop policy if exists "admins select all investment_vehicles" on investment_vehicles;
drop policy if exists "admins insert investment_vehicles" on investment_vehicles;
drop policy if exists "admins update investment_vehicles" on investment_vehicles;
drop policy if exists "admins delete investment_vehicles" on investment_vehicles;
create policy "admins select all investment_vehicles"
  on investment_vehicles for select using (has_app_access('vehicles'));
create policy "admins insert investment_vehicles"
  on investment_vehicles for insert with check (has_app_access('vehicles'));
create policy "admins update investment_vehicles"
  on investment_vehicles for update using (has_app_access('vehicles')) with check (has_app_access('vehicles'));
create policy "admins delete investment_vehicles"
  on investment_vehicles for delete using (has_app_access('vehicles'));

-- documents + both submission tables -> 'documents'
drop policy if exists "admins select all documents" on documents;
drop policy if exists "admins insert documents" on documents;
drop policy if exists "admins update documents" on documents;
drop policy if exists "admins delete documents" on documents;
create policy "admins select all documents"
  on documents for select using (has_app_access('documents'));
create policy "admins insert documents"
  on documents for insert with check (has_app_access('documents'));
create policy "admins update documents"
  on documents for update using (has_app_access('documents')) with check (has_app_access('documents'));
create policy "admins delete documents"
  on documents for delete using (has_app_access('documents'));

drop policy if exists "admins select all document_submissions" on document_submissions;
drop policy if exists "admins update document_submissions" on document_submissions;
create policy "admins select all document_submissions"
  on document_submissions for select using (has_app_access('documents'));
create policy "admins update document_submissions"
  on document_submissions for update using (has_app_access('documents')) with check (has_app_access('documents'));

drop policy if exists "admins select all general_document_submissions" on general_document_submissions;
drop policy if exists "admins update general_document_submissions" on general_document_submissions;
create policy "admins select all general_document_submissions"
  on general_document_submissions for select using (has_app_access('documents'));
create policy "admins update general_document_submissions"
  on general_document_submissions for update using (has_app_access('documents')) with check (has_app_access('documents'));

-- onboarding_submissions -> 'onboarding'
drop policy if exists "admins select all onboarding_submissions" on onboarding_submissions;
drop policy if exists "admins update onboarding_submissions" on onboarding_submissions;
create policy "admins select all onboarding_submissions"
  on onboarding_submissions for select using (has_app_access('onboarding'));
create policy "admins update onboarding_submissions"
  on onboarding_submissions for update using (has_app_access('onboarding')) with check (has_app_access('onboarding'));

-- address_update_requests -> 'updates'
drop policy if exists "admins select all address_update_requests" on address_update_requests;
drop policy if exists "admins update address_update_requests" on address_update_requests;
create policy "admins select all address_update_requests"
  on address_update_requests for select using (has_app_access('updates'));
create policy "admins update address_update_requests"
  on address_update_requests for update using (has_app_access('updates')) with check (has_app_access('updates'));

-- withdrawal_requests -> 'withdrawals'
drop policy if exists "admins select all withdrawal_requests" on withdrawal_requests;
drop policy if exists "admins update withdrawal_requests" on withdrawal_requests;
create policy "admins select all withdrawal_requests"
  on withdrawal_requests for select using (has_app_access('withdrawals'));
create policy "admins update withdrawal_requests"
  on withdrawal_requests for update using (has_app_access('withdrawals')) with check (has_app_access('withdrawals'));

-- Storage: client-documents writes -> 'documents'; kyc-files stays readable
-- by any admin (onboarding, updates, and documents reviewers all need it).
drop policy if exists "admins full access client-documents" on storage.objects;
create policy "admins full access client-documents"
  on storage.objects for all
  using (bucket_id = 'client-documents' and has_app_access('documents'))
  with check (bucket_id = 'client-documents' and has_app_access('documents'));

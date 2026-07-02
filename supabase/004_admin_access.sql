-- ============================================================================
-- Met Capital Client Portal — Migration 004: Admin Access
-- Run this once in the Supabase SQL Editor (New query -> paste -> Run).
--
-- Adds an admin_users table and an is_admin() helper, then grants admins
-- read/write access across client data via ADDITIONAL row-level-security
-- policies. Existing client-facing policies are untouched — Postgres ORs
-- multiple permissive policies together, so clients still only ever see
-- their own rows, while a logged-in admin sees everything.
-- ============================================================================

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

create policy "admins can read admin_users"
  on admin_users for select
  using (is_admin());

-- ---------------------------------------------------------------------------
-- client_profiles — admins can see and manage every client
-- ---------------------------------------------------------------------------
create policy "admins select all client_profiles"
  on client_profiles for select using (is_admin());
create policy "admins insert client_profiles"
  on client_profiles for insert with check (is_admin());
create policy "admins update client_profiles"
  on client_profiles for update using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- investment_vehicles — admins fully manage every client's vehicles
-- ---------------------------------------------------------------------------
create policy "admins select all investment_vehicles"
  on investment_vehicles for select using (is_admin());
create policy "admins insert investment_vehicles"
  on investment_vehicles for insert with check (is_admin());
create policy "admins update investment_vehicles"
  on investment_vehicles for update using (is_admin()) with check (is_admin());
create policy "admins delete investment_vehicles"
  on investment_vehicles for delete using (is_admin());

-- ---------------------------------------------------------------------------
-- documents — admins upload/manage documents for any client
-- ---------------------------------------------------------------------------
create policy "admins select all documents"
  on documents for select using (is_admin());
create policy "admins insert documents"
  on documents for insert with check (is_admin());
create policy "admins update documents"
  on documents for update using (is_admin()) with check (is_admin());
create policy "admins delete documents"
  on documents for delete using (is_admin());

-- ---------------------------------------------------------------------------
-- address_update_requests — admins review (select + update status/notes)
-- Clients still cannot update once submitted — that policy is unchanged.
-- ---------------------------------------------------------------------------
create policy "admins select all address_update_requests"
  on address_update_requests for select using (is_admin());
create policy "admins update address_update_requests"
  on address_update_requests for update using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- withdrawal_requests — admins review (select + update status/notes)
-- ---------------------------------------------------------------------------
create policy "admins select all withdrawal_requests"
  on withdrawal_requests for select using (is_admin());
create policy "admins update withdrawal_requests"
  on withdrawal_requests for update using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- onboarding_submissions — admins review (select + update status/notes)
-- ---------------------------------------------------------------------------
create policy "admins select all onboarding_submissions"
  on onboarding_submissions for select using (is_admin());
create policy "admins update onboarding_submissions"
  on onboarding_submissions for update using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Storage — admins can manage client-documents for anyone, and view
-- (but not alter) submitted kyc-files for anyone.
-- ---------------------------------------------------------------------------
create policy "admins full access client-documents"
  on storage.objects for all
  using (bucket_id = 'client-documents' and is_admin())
  with check (bucket_id = 'client-documents' and is_admin());

create policy "admins select kyc-files"
  on storage.objects for select
  using (bucket_id = 'kyc-files' and is_admin());

-- ============================================================================
-- To make yourself the first admin:
--   1. Authentication -> Users -> Add user (or reuse an existing login)
--   2. Table Editor -> admin_users -> Insert row: user_id = that user's UID,
--      full_name = your name
-- You can now log in at /admin/login/ with that account.
-- ============================================================================

-- Make sure the is_admin() RPC is callable by logged-in users (needed by
-- the admin-create-client Edge Function to verify the caller before it
-- does anything privileged).
grant execute on function is_admin() to authenticated;

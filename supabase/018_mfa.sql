-- ============================================================================
-- Mandatory two-factor authentication (authenticator app / TOTP) for every
-- client-portal and company-panel login.
--
-- * Enrolment is Supabase's built-in TOTP MFA (session reaches "aal2").
-- * 7-day grace period: a user who has not enrolled yet keeps access until
--   their grace window ends; after that, nothing is readable until they
--   enrol. The window starts the first time they sign in after this
--   migration (the portal inserts the row).
-- * Enforcement is at the database: a RESTRICTIVE policy on every table and
--   on storage requires mfa_ok(), so the rule can't be bypassed client-side.
-- * Recovery codes live in mfa_recovery_codes (hashed); using one, or a
--   super admin/HR reset, removes the factor so the person can re-enrol.
--   That path runs through the mfa-recovery Edge Function.
-- ============================================================================

-- 1. Grace tracking ----------------------------------------------------------
create table if not exists mfa_grace (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  grace_until  timestamptz not null default (now() + interval '7 days'),
  created_at   timestamptz not null default now()
);
alter table mfa_grace enable row level security;
drop policy if exists "users read own mfa_grace" on mfa_grace;
drop policy if exists "users start own mfa_grace" on mfa_grace;
create policy "users read own mfa_grace" on mfa_grace for select using (auth.uid() = user_id);
create policy "users start own mfa_grace" on mfa_grace for insert with check (auth.uid() = user_id);

-- 2. Recovery codes (hashed) -------------------------------------------------
create table if not exists mfa_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_mfa_recovery_user on mfa_recovery_codes(user_id);
alter table mfa_recovery_codes enable row level security;
-- No client policies on purpose: only the mfa-recovery Edge Function
-- (service role) reads or writes these.

-- 3. The gate ----------------------------------------------------------------
create or replace function mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
    or (
      not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      )
      and coalesce(
        (select g.grace_until from mfa_grace g where g.user_id = auth.uid()),
        now() + interval '7 days'
      ) > now()
    );
$$;
grant execute on function mfa_ok() to authenticated;

-- Company-panel app access now also requires MFA (covers the panel, the
-- Edge Functions, and the HR API's admin check, all of which call this).
create or replace function has_app_access(app text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select mfa_ok() and exists (
    select 1 from admin_users
    where user_id = auth.uid()
      and (role = 'super_admin' or app = any(apps))
  );
$$;

create or replace function is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select mfa_ok() and exists (select 1 from admin_users where user_id = auth.uid() and role = 'super_admin');
$$;

-- 4. Restrictive MFA policies on everything a signed-in user can touch -------
do $$
declare t text;
begin
  foreach t in array array[
    'client_profiles', 'documents', 'address_update_requests', 'onboarding_submissions',
    'withdrawal_requests', 'investment_vehicles', 'document_submissions',
    'general_document_submissions', 'admin_users', 'dms_categories', 'dms_documents'
  ] loop
    if to_regclass(t) is not null then
      execute format('drop policy if exists "mfa required" on %I', t);
      execute format('create policy "mfa required" on %I as restrictive for all to authenticated using (mfa_ok()) with check (mfa_ok())', t);
    end if;
  end loop;
end $$;

drop policy if exists "mfa required" on storage.objects;
create policy "mfa required" on storage.objects as restrictive for all to authenticated
  using (mfa_ok()) with check (mfa_ok());

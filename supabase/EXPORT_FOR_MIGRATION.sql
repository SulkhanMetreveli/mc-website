-- ============================================================================
-- Met Capital — run ONCE in the old Supabase project (SQL Editor) before
-- using /admin/import/ on met.capital.
--
-- It exposes the existing logins (email + bcrypt password hash) to the
-- service_role key only, so the import can carry passwords across and nobody
-- has to reset theirs. Delete the Supabase project afterwards.
-- ============================================================================
create or replace function public.export_auth_users()
returns table (id uuid, email text, encrypted_password text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select id, email::text, encrypted_password, created_at from auth.users;
$$;

revoke all on function public.export_auth_users() from public, anon, authenticated;
grant execute on function public.export_auth_users() to service_role;

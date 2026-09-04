-- ============================================================================
-- HR / Employees app (app key: hr)
--
-- Two sides, same pattern as the client system:
--   * Staff self-service portal at /staff/  -> employees see and edit their
--     own record (contact details only), request time off, upload documents.
--   * Admin app at /admin/hr/               -> anyone granted the 'hr' app
--     manages every employee, approves/rejects/overrides time off, uploads
--     documents, resets passwords.
--
-- Employees are Supabase Auth users with an employee_profiles row (the way
-- clients have client_profiles). An account can't reach the client portal
-- unless it also has a client_profiles row, and vice versa.
-- ============================================================================

-- 1. Employee records --------------------------------------------------------
create table if not exists employee_profiles (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  employee_number         text unique,
  full_name               text not null,
  work_email              text not null,
  personal_email          text,
  phone                   text,
  date_of_birth           date,
  nationality             text,
  address_line1           text,
  address_line2           text,
  city                    text,
  postal_code             text,
  country                 text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  emergency_contact_relationship text,
  -- job details: admin-only (protected by trigger below)
  job_title               text,
  department              text,
  employment_type         text not null default 'full_time' check (employment_type in ('full_time','part_time','contractor','intern')),
  start_date              date,
  end_date                date,
  manager_user_id         uuid references auth.users(id),
  status                  text not null default 'active' check (status in ('active','on_leave','terminated')),
  vacation_days_per_year  numeric not null default 25,
  must_change_password    boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table employee_profiles enable row level security;

create or replace function is_employee()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from employee_profiles where user_id = auth.uid()); $$;
grant execute on function is_employee() to authenticated;

-- Employees: read + update own row (columns restricted by trigger)
create policy "employees read own profile"
  on employee_profiles for select using (auth.uid() = user_id);
create policy "employees update own profile"
  on employee_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- HR app: everything
create policy "hr select employee_profiles" on employee_profiles for select using (has_app_access('hr'));
create policy "hr insert employee_profiles" on employee_profiles for insert with check (has_app_access('hr'));
create policy "hr update employee_profiles" on employee_profiles for update using (has_app_access('hr')) with check (has_app_access('hr'));
create policy "hr delete employee_profiles" on employee_profiles for delete using (has_app_access('hr'));

-- Employees may only change contact/personal fields on their own row. Job,
-- status, allowance, employee number etc. are HR-only. (must_change_password
-- is allowed so they can clear it after setting their own password.)
create or replace function employee_profiles_protect_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if has_app_access('hr') then
    new.updated_at := now();
    return new;
  end if;
  if new.user_id is distinct from old.user_id
     or new.employee_number is distinct from old.employee_number
     or new.full_name is distinct from old.full_name
     or new.work_email is distinct from old.work_email
     or new.job_title is distinct from old.job_title
     or new.department is distinct from old.department
     or new.employment_type is distinct from old.employment_type
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or new.manager_user_id is distinct from old.manager_user_id
     or new.status is distinct from old.status
     or new.vacation_days_per_year is distinct from old.vacation_days_per_year
     or new.created_at is distinct from old.created_at then
    raise exception 'Only HR can change job details, status, allowance, or identity fields.';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists employee_profiles_protect on employee_profiles;
create trigger employee_profiles_protect
  before update on employee_profiles
  for each row execute function employee_profiles_protect_columns();

-- 2. Employee documents ------------------------------------------------------
create table if not exists employee_documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  category      text not null default 'other' check (category in ('contract','id','payslip','certificate','policy','other')),
  storage_path  text not null,
  uploaded_by   text not null default 'employee' check (uploaded_by in ('employee','hr')),
  uploaded_at   timestamptz not null default now()
);

alter table employee_documents enable row level security;

create policy "employees read own documents"
  on employee_documents for select using (auth.uid() = user_id);
create policy "employees upload own documents"
  on employee_documents for insert with check (auth.uid() = user_id and uploaded_by = 'employee');
create policy "employees delete own uploads"
  on employee_documents for delete using (auth.uid() = user_id and uploaded_by = 'employee');

create policy "hr full access employee_documents"
  on employee_documents for all using (has_app_access('hr')) with check (has_app_access('hr'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-files', 'employee-files', false, 26214400, null)
on conflict (id) do nothing;

create policy "employees read own folder in employee-files"
  on storage.objects for select
  using (bucket_id = 'employee-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "employees upload into own folder in employee-files"
  on storage.objects for insert
  with check (bucket_id = 'employee-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "employees delete own folder in employee-files"
  on storage.objects for delete
  using (bucket_id = 'employee-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "hr full access employee-files"
  on storage.objects for all
  using (bucket_id = 'employee-files' and has_app_access('hr'))
  with check (bucket_id = 'employee-files' and has_app_access('hr'));

-- 3. Time off ----------------------------------------------------------------
create table if not exists vacation_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  type           text not null default 'vacation' check (type in ('vacation','sick','unpaid','other')),
  start_date     date not null,
  end_date       date not null,
  days           numeric not null,           -- working days, computed on submit
  reason         text,
  status         text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewer_note  text,
  reviewed_at    timestamptz,
  created_by     text not null default 'employee' check (created_by in ('employee','hr')),
  created_at     timestamptz not null default now(),
  constraint vacation_dates_ok check (end_date >= start_date)
);
create index if not exists idx_vacation_user on vacation_requests(user_id, start_date);

alter table vacation_requests enable row level security;

create policy "employees read own vacation"
  on vacation_requests for select using (auth.uid() = user_id);
create policy "employees request vacation"
  on vacation_requests for insert with check (auth.uid() = user_id and created_by = 'employee' and status = 'pending');
create policy "employees update own vacation"
  on vacation_requests for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "hr full access vacation_requests"
  on vacation_requests for all using (has_app_access('hr')) with check (has_app_access('hr'));

-- Employees can only cancel their own still-pending requests; everything
-- else about a request is HR's to decide.
create or replace function vacation_requests_employee_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if has_app_access('hr') then return new; end if;
  if old.status <> 'pending' or new.status <> 'cancelled'
     or new.user_id is distinct from old.user_id
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or new.days is distinct from old.days
     or new.type is distinct from old.type then
    raise exception 'You can only cancel a request that is still pending.';
  end if;
  return new;
end $$;

drop trigger if exists vacation_requests_guard on vacation_requests;
create trigger vacation_requests_guard
  before update on vacation_requests
  for each row execute function vacation_requests_employee_guard();

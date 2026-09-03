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

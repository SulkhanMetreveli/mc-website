-- Lets clients submit a new passport copy and/or proof of address at any
-- time, outside of the full Address & Bank Update form. At least one file
-- is required; both are allowed together. Admin approval copies the file(s)
-- into the existing 'documents' table / client-documents bucket so they
-- show up in the Document Center both sides already use.

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

create policy "admins select all document_submissions"
  on document_submissions for select using (is_admin());

create policy "admins update document_submissions"
  on document_submissions for update using (is_admin()) with check (is_admin());

-- allow the new document categories that admin approval will create
alter table documents drop constraint if exists documents_category_check;
alter table documents add constraint documents_category_check
  check (category in ('statement','tax','agreement','passport','proof_of_address','other'));

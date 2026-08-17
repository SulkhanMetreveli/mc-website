-- Lets clients submit any single document with a title of their choosing --
-- not restricted to passport/proof of address (see document_submissions),
-- and not bundled with any other field. Same review flow as everything
-- else. Approving copies the file into the shared 'documents' table/bucket.
-- Rejecting just marks it -- the file is never deleted, so both the client
-- and admin can still view it afterwards.

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

create policy "admins select all general_document_submissions"
  on general_document_submissions for select using (is_admin());

create policy "admins update general_document_submissions"
  on general_document_submissions for update using (is_admin()) with check (is_admin());

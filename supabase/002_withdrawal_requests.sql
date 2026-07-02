-- ============================================================================
-- Met Capital Client Portal — Migration 002: Withdrawal Requests
-- Run this once in the Supabase SQL Editor (New query -> paste -> Run).
-- Safe to run even if you already ran schema.sql before this table existed.
-- ============================================================================

create table if not exists withdrawal_requests (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  submitted_at           timestamptz not null default now(),
  status                 text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_at            timestamptz,
  reviewed_by            text,
  reviewer_notes         text,

  withdrawal_type        text not null check (withdrawal_type in ('full','partial')),
  amount                 numeric,               -- required for 'partial', null for 'full'
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

-- no update/delete policy for clients: once submitted, a request is
-- immutable from the client side, preserving an audit trail. As with
-- address_update_requests, this table only ever records a PENDING
-- REQUEST — nothing here moves money automatically. A staff member must
-- verify the client out-of-band before actioning a withdrawal.

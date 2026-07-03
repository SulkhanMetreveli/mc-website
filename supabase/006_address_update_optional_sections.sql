-- ============================================================================
-- Met Capital Client Portal — Migration 006: Optional Address/Bank sections
-- Run this once in the Supabase SQL Editor (New query -> paste -> Run).
--
-- The Address & Bank Update form now treats the address fields and the
-- bank fields as two independent OPTIONAL sections -- a client can submit
-- just one, both, or (with a passport refresh) neither. Proof of address
-- remains mandatory on every submission regardless (unchanged, still
-- NOT NULL). This makes the previously-required columns nullable and
-- adds a new optional passport upload.
-- ============================================================================

alter table address_update_requests alter column address_line1 drop not null;
alter table address_update_requests alter column city drop not null;
alter table address_update_requests alter column postal_code drop not null;
alter table address_update_requests alter column country drop not null;

alter table address_update_requests alter column bank_account_holder_name drop not null;
alter table address_update_requests alter column bank_name drop not null;
alter table address_update_requests alter column bank_account_number drop not null;
alter table address_update_requests alter column bank_country drop not null;
alter table address_update_requests alter column payout_currency drop not null;

alter table address_update_requests
  add column if not exists passport_copy_path text;

-- proof_of_address_path is intentionally left NOT NULL -- it stays
-- mandatory on every submission of this form.

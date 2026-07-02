-- ============================================================================
-- Met Capital Client Portal — Migration 003: Investment Vehicles + Address
-- Run this once in the Supabase SQL Editor (New query -> paste -> Run).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Address of record on client_profiles.
-- This is the authoritative address shown on the client's dashboard. It is
-- admin-maintained: when you approve an address_update_request (after
-- verifying the client by phone), copy the new address in here.
-- ---------------------------------------------------------------------------
alter table client_profiles add column if not exists address_line1 text;
alter table client_profiles add column if not exists address_line2 text;
alter table client_profiles add column if not exists city text;
alter table client_profiles add column if not exists state_province text;
alter table client_profiles add column if not exists postal_code text;
alter table client_profiles add column if not exists country text;

-- ---------------------------------------------------------------------------
-- investment_vehicles
-- One row per investment product / currency sub-account a client holds.
-- A client can have several rows (e.g. one per fund, one per currency).
-- Admin-maintained only — clients can read their own rows, never write.
-- ---------------------------------------------------------------------------
create table if not exists investment_vehicles (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  vehicle_name                text not null,      -- e.g. "Systematic Multi-Asset Fund"
  currency                    text not null,       -- e.g. "USD", "EUR", "CHF"
  balance                     numeric,
  ytd_performance_pct         numeric,
  inception_performance_pct   numeric,
  as_of_date                  date,
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

alter table investment_vehicles enable row level security;

create policy "clients read own investment vehicles"
  on investment_vehicles for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Link withdrawal requests to the specific vehicle/currency being drawn
-- from, once vehicles exist. Nullable so the form still works for clients
-- who don't have any vehicles set up yet (falls back to manual currency
-- entry on the frontend).
-- ---------------------------------------------------------------------------
alter table withdrawal_requests
  add column if not exists investment_vehicle_id uuid references investment_vehicles(id);

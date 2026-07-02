-- ============================================================================
-- Met Capital Client Portal — Migration 005: Investment Vehicle Status
-- Run this once in the Supabase SQL Editor (New query -> paste -> Run).
-- ============================================================================

alter table investment_vehicles
  add column if not exists status text not null default 'active';

alter table investment_vehicles
  drop constraint if exists investment_vehicles_status_check;

alter table investment_vehicles
  add constraint investment_vehicles_status_check
  check (status in (
    'active',
    'on_hold',
    'liquidating',
    'withdrawing',
    'in_transfer_awaiting_client',
    'in_transfer',
    'liquidated',
    'rejected'
  ));

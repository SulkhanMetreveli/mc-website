-- Add 'in_transit_documents_review' as a selectable status for investment
-- vehicles too (in addition to onboarding, address/bank, and withdrawal
-- requests). Useful e.g. while a new vehicle's opening paperwork is being
-- reviewed, before it goes Active.

alter table investment_vehicles drop constraint if exists investment_vehicles_status_check;
alter table investment_vehicles add constraint investment_vehicles_status_check
  check (status in (
    'active', 'on_hold', 'liquidating', 'withdrawing',
    'in_transfer_awaiting_client', 'in_transfer',
    'in_transit_documents_review',
    'liquidated', 'rejected'
  ));

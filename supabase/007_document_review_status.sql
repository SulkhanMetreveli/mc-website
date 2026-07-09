-- ============================================================================
-- Met Capital Client Portal — Migration 007: "In Transit - Documents in
-- Review" status
-- Run this once in the Supabase SQL Editor (New query -> paste -> Run).
--
-- Adds a new selectable status for the two request types that involve a
-- client submitting documents (onboarding, and address/bank/passport
-- updates), so you can mark something as actively being reviewed instead
-- of just "pending". Client-submitted default is still 'pending' -- this
-- is a status you move things into yourself.
-- ============================================================================

alter table onboarding_submissions drop constraint if exists onboarding_submissions_status_check;
alter table onboarding_submissions add constraint onboarding_submissions_status_check
  check (status in ('pending', 'in_transit_documents_review', 'approved', 'rejected'));

alter table address_update_requests drop constraint if exists address_update_requests_status_check;
alter table address_update_requests add constraint address_update_requests_status_check
  check (status in ('pending', 'in_transit_documents_review', 'approved', 'rejected'));

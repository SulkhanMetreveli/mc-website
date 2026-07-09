-- Allow withdrawal_requests to also use the 'in_transit_documents_review' status,
-- so admins can mark a withdrawal as In Transit - Documents in Review for any
-- reason they choose, same as onboarding and address/bank update requests.

alter table withdrawal_requests drop constraint if exists withdrawal_requests_status_check;
alter table withdrawal_requests add constraint withdrawal_requests_status_check
  check (status in ('pending', 'in_transit_documents_review', 'approved', 'rejected'));

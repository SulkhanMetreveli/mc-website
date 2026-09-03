-- Allow bank-only update requests without a proof-of-address document.
-- The full Address & Bank Update form still requires proof of address;
-- the new /clients/kyc/bank-update/ form submits bank details alone.
-- Nothing changes in the review flow: every request is still staged as
-- pending and applied only after an admin verifies the client by phone.

alter table address_update_requests alter column proof_of_address_path drop not null;

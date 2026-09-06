-- Add the intermediate application state in its own migration.
-- PostgreSQL enum values must be committed before later migrations use them.
alter type public.application_status
  add value if not exists 'payment_pending' after 'pending';

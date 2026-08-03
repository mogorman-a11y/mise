-- Purge stripe_events older than 90 days, far beyond any idempotency window
-- needed (Stripe retries for at most a few days). Prevents indefinite
-- retention of personal data (customer names/emails/addresses in payload).
select cron.schedule(
  'purge-old-stripe-events',
  '0 4 * * *',
  $$ delete from public.stripe_events where received_at < now() - interval '90 days'; $$
);

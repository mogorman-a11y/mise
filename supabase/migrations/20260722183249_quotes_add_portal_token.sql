-- VQ-003 (2026-07-22 security audit): public quote portal was keyed on
-- quotes.id, a client-generated Date.now() timestamp string — low entropy
-- and enumerable, effectively a guessable bearer credential for client
-- financial/PII data. Add a separate, cryptographically random portal
-- token for the public /pay and /api/get-quote lookups; the internal `id`
-- is untouched and keeps being used for authenticated/internal linking
-- (invoices.quote_id, job linking, etc).
alter table public.quotes add column portal_token text;

update public.quotes
set portal_token = encode(gen_random_bytes(16), 'hex')
where portal_token is null;

alter table public.quotes alter column portal_token set not null;
alter table public.quotes alter column portal_token set default encode(gen_random_bytes(16), 'hex');

create unique index quotes_portal_token_idx on public.quotes (portal_token);

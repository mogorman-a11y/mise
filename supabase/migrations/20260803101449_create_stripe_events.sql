create table public.stripe_events (
  id          text primary key,
  type        text not null,
  customer_id text,
  payload     jsonb not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
-- no policies: service role access only
create index stripe_events_customer_id_idx on public.stripe_events (customer_id);
create index stripe_events_received_at_idx on public.stripe_events (received_at desc);

-- Shared suite schema for Veriqo, Carte, and Finance.
-- Draft migration: review before running in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.business_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_name text,
  trading_name text,
  chef_name text,
  email text,
  phone text,
  address text,
  logo text,
  vat_number text,
  vat_registered boolean not null default false,
  invoice_prefix text not null default 'INV',
  invoice_next_number integer not null default 1,
  invoice_payment_terms_days integer not null default 7,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address text,
  notes text,
  preferences text,
  source text,
  legacy_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_user_id_idx on public.clients(user_id);
create index if not exists clients_user_name_idx on public.clients(user_id, lower(name));

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  role text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_user_id_idx on public.staff(user_id);

create table if not exists public.dishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text,
  allergens text[] not null default array[]::text[],
  notes text,
  source text,
  legacy_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dishes_user_id_idx on public.dishes(user_id);
create index if not exists dishes_user_name_idx on public.dishes(user_id, lower(name));

create table if not exists public.menus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  notes text,
  source text,
  legacy_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists menus_user_id_idx on public.menus(user_id);
create index if not exists menus_user_name_idx on public.menus(user_id, lower(name));

create table if not exists public.menu_dishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  menu_id uuid not null references public.menus(id) on delete cascade,
  dish_id uuid references public.dishes(id) on delete set null,
  dish_name text not null,
  category text,
  allergens text[] not null default array[]::text[],
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists menu_dishes_user_id_idx on public.menu_dishes(user_id);
create index if not exists menu_dishes_menu_id_idx on public.menu_dishes(menu_id);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  title text,
  job_date date not null,
  start_time text,
  end_time text,
  location text,
  headcount integer,
  status text not null default 'confirmed',
  notes text,
  source text,
  legacy_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_user_id_idx on public.jobs(user_id);
create index if not exists jobs_client_id_idx on public.jobs(client_id);
create index if not exists jobs_user_date_idx on public.jobs(user_id, job_date);

create table if not exists public.job_menus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  menu_id uuid references public.menus(id) on delete set null,
  menu_name text not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_menus_user_id_idx on public.job_menus(user_id);
create index if not exists job_menus_job_id_idx on public.job_menus(job_id);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  file_name text not null,
  file_type text,
  storage_path text,
  public_url text,
  kind text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attachments_user_id_idx on public.attachments(user_id);
create index if not exists attachments_job_id_idx on public.attachments(job_id);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  invoice_number text not null,
  issue_date date not null default current_date,
  due_date date,
  status text not null default 'draft',
  currency text not null default 'GBP',
  subtotal numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid_total numeric(12,2) not null default 0,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, invoice_number)
);

create index if not exists invoices_user_id_idx on public.invoices(user_id);
create index if not exists invoices_client_id_idx on public.invoices(client_id);
create index if not exists invoices_job_id_idx on public.invoices(job_id);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  menu_id uuid references public.menus(id) on delete set null,
  dish_id uuid references public.dishes(id) on delete set null,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  line_total numeric(12,2) not null default 0,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoice_items_user_id_idx on public.invoice_items(user_id);
create index if not exists invoice_items_invoice_id_idx on public.invoice_items(invoice_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  paid_at timestamptz not null default now(),
  amount numeric(12,2) not null,
  method text,
  reference text,
  stripe_payment_intent_id text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_user_id_idx on public.payments(user_id);
create index if not exists payments_invoice_id_idx on public.payments(invoice_id);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  spent_on date not null default current_date,
  supplier text,
  category text,
  description text,
  amount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  receipt_attachment_id uuid references public.attachments(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expenses_user_id_idx on public.expenses(user_id);
create index if not exists expenses_job_id_idx on public.expenses(job_id);

create table if not exists public.mileage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  journey_date date not null default current_date,
  origin text,
  destination text,
  miles numeric(10,2) not null default 0,
  rate numeric(10,2) not null default 0,
  amount numeric(12,2) not null default 0,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mileage_user_id_idx on public.mileage(user_id);
create index if not exists mileage_job_id_idx on public.mileage(job_id);

create table if not exists public.tax_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null default 'expense',
  default_tax_rate numeric(6,3) not null default 0,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name, kind)
);

create index if not exists tax_categories_user_id_idx on public.tax_categories(user_id);

alter table public.business_settings enable row level security;
alter table public.clients enable row level security;
alter table public.staff enable row level security;
alter table public.dishes enable row level security;
alter table public.menus enable row level security;
alter table public.menu_dishes enable row level security;
alter table public.jobs enable row level security;
alter table public.job_menus enable row level security;
alter table public.attachments enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.mileage enable row level security;
alter table public.tax_categories enable row level security;

create policy "business_settings_owner_all" on public.business_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "clients_owner_all" on public.clients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "staff_owner_all" on public.staff
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "dishes_owner_all" on public.dishes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "menus_owner_all" on public.menus
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "menu_dishes_owner_all" on public.menu_dishes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "jobs_owner_all" on public.jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "job_menus_owner_all" on public.job_menus
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "attachments_owner_all" on public.attachments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "invoices_owner_all" on public.invoices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "invoice_items_owner_all" on public.invoice_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "payments_owner_all" on public.payments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "expenses_owner_all" on public.expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "mileage_owner_all" on public.mileage
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tax_categories_owner_all" on public.tax_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


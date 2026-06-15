-- Keryx schema for the Supabase (deploy) adapter. Mirrors lib/db/sqlite-adapter.ts.
-- Apply with: supabase db push   (or paste into the Supabase SQL editor).
-- Public read everywhere (dashboard is public); writes via the service-role key only.

create table if not exists public.sources (
  id text primary key,
  name text not null,
  url text,
  description text,
  rss_url text,
  wallet_address text not null,
  fetch_price numeric not null default 0.002,
  tags jsonb not null default '[]'::jsonb,
  authors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.source_items (
  id text primary key,
  source_id text not null references public.sources(id) on delete cascade,
  title text,
  summary text,
  content text,
  link text,
  published_at text
);
create index if not exists source_items_source_idx on public.source_items(source_id);

create table if not exists public.cache_items (
  source_id text primary key,
  text text,
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_events (
  id text primary key,
  created_at timestamptz not null default now(),
  kind text not null,                 -- 'fetch' | 'citation'
  query_id text not null,
  source_id text not null,
  source_name text,
  payer text not null,
  payee text not null,
  amount_usdc numeric not null,
  weight numeric,
  rationale text,
  tx_hash text,
  network text not null,
  settled boolean not null default false
);
create index if not exists payment_events_created_idx on public.payment_events(created_at desc);
create index if not exists payment_events_source_idx on public.payment_events(source_id);

create table if not exists public.query_runs (
  id text primary key,
  created_at timestamptz not null default now(),
  question text not null,
  budget numeric not null,
  engine text,
  total_spent numeric not null default 0,
  total_to_creators numeric not null default 0,
  answer text,
  data jsonb not null
);
create index if not exists query_runs_created_idx on public.query_runs(created_at desc);

-- RLS: public read, service-role write.
do $$
declare t text;
begin
  foreach t in array array['sources','source_items','cache_items','payment_events','query_runs'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$create policy "public read %1$s" on public.%1$I for select using (true);$f$, t);
    execute format($f$create policy "service write %1$s" on public.%1$I for all to service_role using (true) with check (true);$f$, t);
  end loop;
exception when duplicate_object then null;
end $$;

-- Optional: live dashboard via Supabase realtime
alter publication supabase_realtime add table public.payment_events;
alter publication supabase_realtime add table public.query_runs;

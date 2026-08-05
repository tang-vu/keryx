-- Tie every new fetch/citation receipt to the exact article version it paid for.
-- All columns remain nullable so historical source-level receipts stay readable.
alter table public.payment_events add column if not exists item_id text;
alter table public.payment_events add column if not exists item_title text;
alter table public.payment_events add column if not exists item_url text;
alter table public.payment_events add column if not exists content_version text;
alter table public.payment_events add column if not exists item_published_at text;

create index if not exists payment_events_item_idx
  on public.payment_events (item_id, created_at desc)
  where item_id is not null;

-- SourceRegistry provenance existed in SQLite but was missing from the Supabase projection. The
-- article toll route needs the same on-chain payout authority on either adapter.
alter table public.sources add column if not exists onchain_id text;
alter table public.sources add column if not exists register_tx text;
create unique index if not exists sources_onchain_id_idx
  on public.sources (lower(onchain_id))
  where onchain_id is not null;

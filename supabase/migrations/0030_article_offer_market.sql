-- Creator-signed, version-bound article discounts. One current immutable revision per article.
create table if not exists public.article_offers (
  source_id text not null references public.sources(id) on delete cascade,
  item_id text not null references public.source_items(id) on delete cascade,
  id text not null unique,
  content_version text not null,
  price_usdc6 bigint not null check (price_usdc6 > 0),
  expires_at bigint not null,
  signer text not null,
  nonce text not null,
  signature text not null,
  created_at timestamptz not null default now(),
  primary key (source_id, item_id)
);

create index if not exists article_offers_expires_idx
  on public.article_offers(expires_at);

alter table public.article_offers enable row level security;

create policy "public read article_offers"
  on public.article_offers for select using (true);

create policy "service write article_offers"
  on public.article_offers for all to service_role using (true) with check (true);

alter table public.payment_events
  add column if not exists offer_id text,
  add column if not exists list_price_usdc numeric;

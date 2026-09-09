-- Preparatory private storage only: no private payment or execution route is enabled.
create table if not exists public.private_research_intents (
  id text primary key check (id ~ '^prv_[a-f0-9]{64}$'),
  payer text not null check (payer ~ '^0x[a-f0-9]{40}$'),
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists private_research_intents_payer on public.private_research_intents(payer, created_at);
alter table public.private_research_intents enable row level security;
revoke all on table public.private_research_intents from public, anon, authenticated;
-- Application reservations are append-only. Removal/retention needs a separate reviewed workflow.
revoke all on table public.private_research_intents from service_role;
grant select, insert on table public.private_research_intents to service_role;

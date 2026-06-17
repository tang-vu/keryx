-- Migration 0002: sync state table + ipfs_cid column on sources.
--
-- sync_state: key/value store for the registry indexer checkpoint.
-- The indexer writes `lastSyncedBlock` here after each polling pass so
-- server restarts resume from the last synced block rather than re-scanning
-- the entire chain from the deploy block.
--
-- ipfs_cid: IPFS CID for a source's gated content. Populated by the indexer
-- from the on-chain SourceRecord.contentCid field. Content fetch stays lazy
-- (pulled on first agent demand, cached in cache_items). Column added here
-- so the indexer can persist it immediately when a source is indexed.

create table if not exists public.sync_state (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- RLS: public read, service-role write (matches the pattern from migration 0001).
alter table public.sync_state enable row level security;

do $$ begin
  create policy "public read sync_state"
    on public.sync_state for select using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "service write sync_state"
    on public.sync_state for all to service_role using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- Add ipfs_cid to sources if it doesn't already exist.
do $$ begin
  alter table public.sources add column ipfs_cid text;
exception when duplicate_column then null;
end $$;

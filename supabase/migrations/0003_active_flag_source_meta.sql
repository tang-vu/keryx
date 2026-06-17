-- Migration 0003: active flag on sources + source_meta table.
--
-- active: boolean flag set false when a creator calls deactivate() on-chain.
--   listSources() filters to active=true so deactivated sources are never
--   discovered, fetched, or cited by the agent (H1 fix).
--
-- source_meta: off-chain human-readable metadata (name, description, url) for
--   on-chain registered sources. Keyed by source id. The indexer reads this
--   table when processing SourceRegistered events and merges name/description/url
--   into the on-chain cache row, preventing hex-placeholder display (H2 fix).
--   POST /api/sources writes here at register time so the merge is available
--   immediately when the indexer processes the event.

-- Add active column if it doesn't already exist.
do $$ begin
  alter table public.sources add column active boolean not null default true;
exception when duplicate_column then null;
end $$;

-- Create source_meta table for off-chain human-readable metadata.
create table if not exists public.source_meta (
  id          text primary key,
  name        text not null default '',
  description text not null default '',
  url         text not null default '',
  updated_at  timestamptz not null default now()
);

-- RLS: public read (name/description are not sensitive), service-role write.
alter table public.source_meta enable row level security;

do $$ begin
  create policy "public read source_meta"
    on public.source_meta for select using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "service write source_meta"
    on public.source_meta for all to service_role using (true) with check (true);
exception when duplicate_object then null;
end $$;

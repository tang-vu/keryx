-- Migration 0012: source_meta.rss_url
--
-- A source registered through the on-chain registry never touches the sources table until the
-- indexer projects its SourceRegistered event, and the feed URL is not part of the on-chain
-- record. Without somewhere to carry it, the indexer mints the row with a null rss_url and
-- /api/sources/verify falls back to the site's homepage — where the creator's ownership token
-- never appears, because they put it in the feed as instructed. The source can then never
-- verify, and never earns.

do $$ begin
  alter table public.source_meta add column rss_url text;
exception when duplicate_column then null;
end $$;

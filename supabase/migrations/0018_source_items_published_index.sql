-- Migration 0018: index the way source_items is actually read.
--
-- Every read of this table is "one source, newest first": discovery, the ingest dedupe pass, and
-- the freshness counts behind a dispatch's "published since this answer" note. Without this the
-- freshness read scans the whole item log on every archived answer that gets rendered.

create index if not exists source_items_source_published
  on public.source_items (source_id, published_at desc);

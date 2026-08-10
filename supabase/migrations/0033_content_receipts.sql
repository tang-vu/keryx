-- Migration 0033: honest paid-body metadata, publisher manifests, and private paid caches.
-- SourceRegistry remains payout authority; these fields describe/authenticate content only.

alter table public.source_items add column if not exists item_wrap_iv text;
alter table public.source_items add column if not exists delivery_kind text;
alter table public.source_items add column if not exists storage_mode text;
alter table public.source_items add column if not exists plaintext_bytes integer;
alter table public.source_items add column if not exists body_hash text;
alter table public.source_items add column if not exists manifest_id text;
alter table public.source_items add column if not exists manifest_signer text;
alter table public.source_items add column if not exists manifest_nonce text;
alter table public.source_items add column if not exists manifest_signature text;
alter table public.source_items add column if not exists manifest_created_at timestamptz;

alter table public.source_items
  drop constraint if exists source_items_delivery_kind_check;
alter table public.source_items
  add constraint source_items_delivery_kind_check
  check (
    delivery_kind is null or
    delivery_kind in ('full_text', 'excerpt', 'abstract', 'metadata_only')
  );

alter table public.source_items
  drop constraint if exists source_items_storage_mode_check;
alter table public.source_items
  add constraint source_items_storage_mode_check
  check (
    storage_mode is null or
    storage_mode in ('ipfs_encrypted', 'db_encrypted', 'db_plaintext')
  );

-- These tables can contain purchased plaintext or decryption envelopes. Public metadata is served
-- through bounded application routes, never through direct PostgREST reads.
drop policy if exists "public read source_items" on public.source_items;
drop policy if exists "public read cache_items" on public.cache_items;
revoke select on table public.source_items from anon, authenticated;
revoke select on table public.cache_items from anon, authenticated;

-- Migration 0013: scope an API key to operations and sources.
--
-- Until the earnings export existed, a key did one thing: identify a caller on the ask paths.
-- The same key can now also read every payout its wallet ever received, so a key handed to a
-- script that only asks questions also hands over the accounts. These columns split that.
--
-- Both are NULL on every existing key, and NULL is read as "all scopes, all owned sources".
-- Keys already working in someone's integration must not silently lose access; an owner who
-- wants a narrow key mints a new one and revokes the old.

alter table public.api_keys add column if not exists scopes     text;
alter table public.api_keys add column if not exists source_ids text;

comment on column public.api_keys.scopes is
  'Comma-separated operations (ask, export). NULL = every scope (pre-scopes key).';
comment on column public.api_keys.source_ids is
  'Comma-separated source ids the key is pinned to. NULL = every source the wallet owns. '
  'Always intersected with live ownership at read time — a restriction can never widen access.';

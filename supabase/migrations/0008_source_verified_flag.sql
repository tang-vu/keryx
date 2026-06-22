-- Migration 0008: feed-ownership verification flag on sources.
--
-- verified: boolean gate on EARNING (not listing). Listing a source stays permissionless
--   (anyone may paste any RSS feed), but the agent only discovers/reads/cites/pays sources
--   whose owner proved control of the feed by placing `keryx-verify:<payoutWallet>` in it
--   (see lib/sources/feed-verification.ts and POST /api/sources/verify). An impostor who
--   lists a feed they don't own can never make it carry their wallet, so can never verify
--   or earn — removing the incentive to squat other people's feeds for citation rewards.
--
--   DEFAULT true grandfathers every pre-existing row (operator-curated seed sources + live
--   traction rows) as verified so the volume engine keeps earning. Only public web
--   submissions registered after this column exists start unverified (set explicitly false).

do $$ begin
  alter table public.sources add column verified boolean not null default true;
exception when duplicate_column then null;
end $$;

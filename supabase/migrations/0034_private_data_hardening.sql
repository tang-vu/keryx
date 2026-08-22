-- Close Supabase schema parity and exposed-schema privileges.
--
-- Keryx never lets browser clients write database rows directly: public application data is
-- served through bounded Next routes and the adapter always uses the server-only service role.
-- Paid bodies/caches were already made private in 0033. This migration applies the same explicit
-- grants/RLS posture to every remaining table and RPC, creates the two SQLite-parity tables that
-- the Supabase adapter already calls, and removes legacy rate-limit rows that contained raw API
-- bearer keys.

create table if not exists public.answer_feedback (
  id text primary key,
  query_id text not null,
  rating text not null check (rating in ('up', 'down')),
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists answer_feedback_query on public.answer_feedback(query_id);

create table if not exists public.query_memories (
  id text primary key,
  source_scores jsonb not null,
  sources_read jsonb,
  topics jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists query_memories_created on public.query_memories(created_at desc);

-- Every Keryx table lives in Supabase's exposed `public` schema, so RLS is mandatory even when
-- grants also deny the request before policy evaluation.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sources', 'source_items', 'cache_items', 'payment_events', 'query_runs',
    'sync_state', 'source_meta', 'api_keys', 'api_key_usage', 'users', 'withdrawals',
    'source_notify', 'session_grants', 'rate_limit_counters', 'source_notify_email',
    'gap_intents', 'reasoning_circuits', 'article_offers', 'answer_feedback', 'query_memories'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end $$;

-- These rows are intentionally public metadata/proof, but only for reads. Application writes stay
-- service-role-only. Existing select policies from their creation migrations remain authoritative.
grant select on table public.sources, public.source_meta, public.payment_events,
  public.query_runs, public.sync_state, public.gap_intents, public.article_offers
  to anon, authenticated;

-- Postgres grants function execution to PUBLIC by default. All Keryx RPCs mutate shared economic,
-- rate-limit, or operational state and are called only by the service-role adapter.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Keep later raw-SQL migrations closed by default; a migration that deliberately exposes a read
-- must grant it explicitly beside its RLS policy.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Before authenticated routes were fixed, this bucket held the full `kx_live_...` bearer value.
delete from public.rate_limit_counters
where bucket like 'ask:kx\_live\_%' escape '\';

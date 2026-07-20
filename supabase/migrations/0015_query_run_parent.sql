-- Migration 0015: follow-up dispatches.
--
-- A follow-up records which dispatch it continues from. It is a full paid dispatch in its own
-- right — it buys sources and pays creators again; the parent only supplied the question's
-- context, never its answer text.
--
-- NULL on every existing row, which is accurate: they were all asked standalone.

alter table public.query_runs add column if not exists parent_id text;

-- Indexed so a permalink can list its follow-ups without scanning the whole run log.
create index if not exists query_runs_parent on public.query_runs (parent_id);

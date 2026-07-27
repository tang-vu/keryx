-- Remote MCP is an external request channel in its own right. Keep the channel first-class so
-- product metrics can distinguish MCP clients from paid x402 A2A callers without losing either
-- from the external-traction bucket.

alter table public.query_runs
  drop constraint if exists query_runs_origin_check;
alter table public.query_runs
  add constraint query_runs_origin_check
  check (origin in ('engine', 'web', 'a2a', 'mcp'));

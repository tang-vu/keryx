-- Self-declared Remote MCP distribution channel. This field is activation telemetry only:
-- callers can edit the URL query, so it must never be used for identity or payment authority.
ALTER TABLE query_runs
  ADD COLUMN IF NOT EXISTS mcp_client text;

ALTER TABLE query_runs
  DROP CONSTRAINT IF EXISTS query_runs_mcp_client_check;

ALTER TABLE query_runs
  ADD CONSTRAINT query_runs_mcp_client_check
  CHECK (
    mcp_client IS NULL
    OR mcp_client IN ('codex', 'claude', 'cursor', 'direct', 'other')
  );

CREATE INDEX IF NOT EXISTS query_runs_mcp_client_created
  ON query_runs (mcp_client, created_at DESC)
  WHERE origin = 'mcp';

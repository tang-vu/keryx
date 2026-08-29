-- Compact, additive telemetry projection for the read-only testnet economics observer.
-- Historical rows remain NULL: token usage and funding provenance must not be guessed.
ALTER TABLE public.query_runs
  ADD COLUMN IF NOT EXISTS economics_data jsonb;

COMMENT ON COLUMN public.query_runs.economics_data IS
  'Testnet-only run-local token counters and funding provenance; never payment authority';

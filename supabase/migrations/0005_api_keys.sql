-- API key identity + usage metering tables.
-- Keys are issued to SIWE wallets; no fund custody, no balance column.
-- Callers still pay via x402 on every request — key = identity + rate-limit only.

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  prefix       TEXT NOT NULL UNIQUE,  -- first 16 chars of raw key, non-secret lookup handle
  key_hash     TEXT NOT NULL,         -- SHA-256 hex of full raw key; raw key never stored
  wallet       TEXT NOT NULL,         -- issuing wallet (lowercase)
  label        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ           -- NULL = active; soft-delete on revoke
);

CREATE INDEX IF NOT EXISTS api_keys_prefix ON api_keys(prefix);
CREATE INDEX IF NOT EXISTS api_keys_wallet ON api_keys(wallet);

-- Daily aggregate counters for usage display on the dev portal.
-- Metering (counting calls) is separate from billing (x402 settlement, already in payment_events).
CREATE TABLE IF NOT EXISTS api_key_usage (
  key_id     TEXT    NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  day        DATE    NOT NULL,      -- ISO date, truncated to day
  call_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, day)
);

-- Supabase Postgres function for atomic upsert of daily usage counter.
-- Called by the Supabase adapter's incrementUsage() via sb.rpc().
CREATE OR REPLACE FUNCTION upsert_api_key_usage(p_key_id TEXT, p_day DATE)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO api_key_usage (key_id, day, call_count)
  VALUES (p_key_id, p_day, 1)
  ON CONFLICT (key_id, day) DO UPDATE SET call_count = api_key_usage.call_count + 1;
$$;

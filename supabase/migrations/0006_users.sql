-- User accounts, created on first SIWE sign-in.
-- Non-custodial: an identity/profile index only — no funds, no keys, no credentials.
-- Access control still re-derives the role live (env allowlist + source ownership);
-- the role column here is a display snapshot taken at the last sign-in.

CREATE TABLE IF NOT EXISTS users (
  wallet_address TEXT PRIMARY KEY,        -- lowercased; identity = wallet
  role           TEXT NOT NULL,           -- asker | creator | dev (display snapshot)
  display_handle TEXT NOT NULL,           -- compact "0x….." handle
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

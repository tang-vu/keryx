-- Preserve the exact signed EIP-3009 validity boundary for operational reconciliation.
-- Historical rows remain NULL: deriving an expiry from created_at would fabricate evidence.
alter table public.payment_events
  add column if not exists authorization_expires_at timestamptz;

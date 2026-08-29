-- One settled inbound x402 authorization may launch at most one downstream creator-spend run.
CREATE TABLE IF NOT EXISTS public.a2a_orders (
  id text PRIMARY KEY,
  query_id text NOT NULL UNIQUE,
  authorization_id text NOT NULL,
  request_hash text NOT NULL,
  payer text NOT NULL,
  payee text NOT NULL,
  amount_usdc numeric NOT NULL CHECK (amount_usdc > 0),
  creator_budget_usdc numeric NOT NULL CHECK (creator_budget_usdc > 0),
  service_fee_usdc numeric NOT NULL CHECK (service_fee_usdc > 0),
  research_mode text NOT NULL CHECK (research_mode IN ('quick','deep')),
  status text NOT NULL CHECK (status IN ('running','completed','failed')),
  transaction_id text NOT NULL,
  response_data jsonb,
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE public.a2a_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.a2a_orders FROM anon, authenticated;

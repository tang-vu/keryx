-- Immutable buyer-visible execution/SLO snapshot for versioned A2A research packages.
-- Historical rows stay NULL and must never be presented as package-v1 work.
ALTER TABLE public.a2a_orders ADD COLUMN IF NOT EXISTS package_data jsonb;

COMMENT ON COLUMN public.a2a_orders.package_data IS
  'Exact research package accepted before x402 settlement; bound into request_hash.';

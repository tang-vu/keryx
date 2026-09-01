-- A settled A2A request can be acknowledged quickly, then claimed once by a private worker.
ALTER TABLE public.a2a_orders ADD COLUMN IF NOT EXISTS request_data jsonb;
ALTER TABLE public.a2a_orders ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.a2a_orders ADD COLUMN IF NOT EXISTS worker_id text;

-- Historical `running` rows are ambiguous: they may already have paid creators. Never requeue them.
UPDATE public.a2a_orders
SET started_at = updated_at,
    worker_id = COALESCE(worker_id, 'legacy')
WHERE status = 'running' AND started_at IS NULL AND request_data IS NULL;

CREATE INDEX IF NOT EXISTS a2a_orders_queued
  ON public.a2a_orders (created_at, id)
  WHERE status = 'running' AND started_at IS NULL;

CREATE OR REPLACE FUNCTION public.claim_a2a_order(
  p_worker_id text,
  p_started_at timestamptz
)
RETURNS SETOF public.a2a_orders
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidate AS (
    SELECT id
    FROM public.a2a_orders
    WHERE status = 'running'
      AND started_at IS NULL
      AND request_data IS NOT NULL
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.a2a_orders AS orders
    SET started_at = p_started_at,
        worker_id = p_worker_id,
        updated_at = p_started_at
    FROM candidate
    WHERE orders.id = candidate.id
      AND orders.status = 'running'
      AND orders.started_at IS NULL
    RETURNING orders.*
  )
  SELECT * FROM claimed;
$$;

REVOKE ALL ON FUNCTION public.claim_a2a_order(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_a2a_order(text, timestamptz) TO service_role;

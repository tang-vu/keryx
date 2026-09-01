-- Private, evidence-bound terminal resolution for paid A2A jobs that must never be rerun.
ALTER TABLE public.a2a_orders ADD COLUMN IF NOT EXISTS resolution_data jsonb;
ALTER TABLE public.a2a_orders ADD COLUMN IF NOT EXISTS execution_journal_version smallint
  CHECK (execution_journal_version IS NULL OR execution_journal_version = 1);
ALTER TABLE public.a2a_orders ADD COLUMN IF NOT EXISTS payment_started_at timestamptz;
ALTER TABLE public.a2a_orders ADD COLUMN IF NOT EXISTS result_saving_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_a2a_payment_started(
  p_id text,
  p_started_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE public.a2a_orders
     SET payment_started_at = COALESCE(payment_started_at, p_started_at),
         updated_at = p_started_at
   WHERE id = p_id
     AND status = 'running'
     AND started_at IS NOT NULL
     AND execution_journal_version = 1;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_a2a_payment_started(text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_a2a_payment_started(text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_a2a_result_saving(
  p_id text,
  p_started_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE public.a2a_orders
     SET result_saving_at = COALESCE(result_saving_at, p_started_at),
         updated_at = p_started_at
   WHERE id = p_id
     AND status = 'running'
     AND started_at IS NOT NULL
     AND execution_journal_version = 1;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_a2a_result_saving(text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_a2a_result_saving(text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_a2a_order(
  p_id text,
  p_outcome text,
  p_response jsonb,
  p_error_code text,
  p_resolution jsonb,
  p_started_before timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed integer;
  evidence_attempts bigint;
  evidence_settled bigint;
  evidence_pending bigint;
  evidence_failed bigint;
  evidence_simulated bigint;
  creator_cap bigint;
  journal_version smallint;
  payment_boundary_crossed boolean;
  result_save_boundary_crossed boolean;
BEGIN
  IF p_resolution IS NULL OR jsonb_typeof(p_resolution) <> 'object' THEN
    RAISE EXCEPTION 'A2A resolution evidence is required';
  END IF;

  SELECT COUNT(*),
         COALESCE(SUM(CASE WHEN state='settled' THEN micros ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN state='pending' THEN micros ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN state='failed' THEN micros ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN state='simulated' THEN micros ELSE 0 END), 0)
    INTO evidence_attempts, evidence_settled, evidence_pending, evidence_failed, evidence_simulated
    FROM (
      SELECT ROUND(payments.amount_usdc * 1000000)::bigint AS micros,
             COALESCE(
               payments.settlement_status,
               CASE WHEN payments.settled THEN 'settled' ELSE 'simulated' END
             ) AS state
        FROM public.payment_events AS payments
       WHERE payments.query_id = (
         SELECT orders.query_id FROM public.a2a_orders AS orders WHERE orders.id = p_id
       )
         AND payments.kind <> 'inbound'
    ) AS creator_payments;
  SELECT ROUND(orders.creator_budget_usdc * 1000000)::bigint,
         orders.execution_journal_version,
         orders.payment_started_at IS NOT NULL,
         orders.result_saving_at IS NOT NULL
    INTO creator_cap, journal_version, payment_boundary_crossed, result_save_boundary_crossed
    FROM public.a2a_orders AS orders
   WHERE orders.id = p_id;

  IF evidence_attempts IS DISTINCT FROM
       (p_resolution#>>'{evidence,creatorAttempts}')::bigint
     OR evidence_settled IS DISTINCT FROM
       (p_resolution#>>'{evidence,settledCreatorMicros}')::bigint
     OR evidence_pending IS DISTINCT FROM
       (p_resolution#>>'{evidence,pendingCreatorMicros}')::bigint
     OR evidence_failed IS DISTINCT FROM
       (p_resolution#>>'{evidence,failedCreatorMicros}')::bigint
     OR evidence_simulated IS DISTINCT FROM
       (p_resolution#>>'{evidence,simulatedCreatorMicros}')::bigint
     OR journal_version IS DISTINCT FROM
       (p_resolution#>>'{evidence,executionJournalVersion}')::smallint
     OR payment_boundary_crossed IS DISTINCT FROM
       (p_resolution#>>'{evidence,paymentBoundaryCrossed}')::boolean
     OR result_save_boundary_crossed IS DISTINCT FROM
       (p_resolution#>>'{evidence,resultSaveBoundaryCrossed}')::boolean
     OR creator_cap IS NULL
     OR evidence_settled + evidence_pending > creator_cap THEN
    RETURN false;
  END IF;

  IF p_outcome = 'completed' THEN
    IF p_response IS NULL OR p_error_code IS NOT NULL
       OR p_resolution->>'action' <> 'repair_completed'
       OR (p_resolution#>>'{evidence,queryRunFound}')::boolean IS DISTINCT FROM true
       OR evidence_simulated > 0 THEN
      RAISE EXCEPTION 'invalid A2A completion resolution';
    END IF;
    WITH live_evidence AS (
      SELECT COUNT(*) AS attempts,
             COALESCE(SUM(CASE WHEN state='settled' THEN micros ELSE 0 END), 0) AS settled,
             COALESCE(SUM(CASE WHEN state='pending' THEN micros ELSE 0 END), 0) AS pending,
             COALESCE(SUM(CASE WHEN state='failed' THEN micros ELSE 0 END), 0) AS failed,
             COALESCE(SUM(CASE WHEN state='simulated' THEN micros ELSE 0 END), 0) AS simulated
        FROM (
          SELECT ROUND(payments.amount_usdc * 1000000)::bigint AS micros,
                 COALESCE(
                   payments.settlement_status,
                   CASE WHEN payments.settled THEN 'settled' ELSE 'simulated' END
                 ) AS state
            FROM public.payment_events AS payments
           WHERE payments.query_id = (
             SELECT query_id FROM public.a2a_orders WHERE id = p_id
           )
             AND payments.kind <> 'inbound'
        ) AS current_creator_payments
    )
    UPDATE public.a2a_orders AS orders
       SET status = 'completed',
           response_data = p_response,
           error_code = NULL,
           resolution_data = p_resolution,
           updated_at = (p_resolution->>'resolvedAt')::timestamptz
     WHERE orders.id = p_id
       AND orders.status = 'running'
       AND orders.started_at IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.query_runs AS runs
          WHERE runs.id = orders.query_id AND runs.payment_mode = 'real'
       )
       AND orders.execution_journal_version IS NOT DISTINCT FROM journal_version
       AND (orders.payment_started_at IS NOT NULL) IS NOT DISTINCT FROM payment_boundary_crossed
       AND (orders.result_saving_at IS NOT NULL) IS NOT DISTINCT FROM result_save_boundary_crossed
       AND (SELECT attempts FROM live_evidence) = evidence_attempts
       AND (SELECT settled FROM live_evidence) = evidence_settled
       AND (SELECT pending FROM live_evidence) = evidence_pending
       AND (SELECT failed FROM live_evidence) = evidence_failed
       AND (SELECT simulated FROM live_evidence) = evidence_simulated;
  ELSIF p_outcome = 'failed' THEN
    IF p_response IS NOT NULL OR p_error_code <> 'operator_reviewed_no_result'
       OR p_started_before IS NULL OR p_resolution->>'action' <> 'close_failed'
       OR (p_resolution#>>'{evidence,queryRunFound}')::boolean IS DISTINCT FROM false
       OR journal_version IS DISTINCT FROM 1 OR payment_boundary_crossed
       OR result_save_boundary_crossed
       OR evidence_attempts > 0 THEN
      RAISE EXCEPTION 'invalid A2A failure resolution';
    END IF;
    UPDATE public.a2a_orders AS orders
       SET status = 'failed',
           response_data = NULL,
           error_code = p_error_code,
           resolution_data = p_resolution,
           updated_at = (p_resolution->>'resolvedAt')::timestamptz
     WHERE orders.id = p_id
       AND orders.status = 'running'
       AND orders.started_at IS NOT NULL
       AND orders.started_at <= p_started_before
       AND orders.execution_journal_version = 1
       AND orders.payment_started_at IS NULL
       AND orders.result_saving_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.query_runs AS runs WHERE runs.id = orders.query_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_events AS payments
          WHERE payments.query_id = orders.query_id AND payments.kind <> 'inbound'
       );
  ELSE
    RAISE EXCEPTION 'invalid A2A resolution outcome';
  END IF;

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_a2a_order(text, text, jsonb, text, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_a2a_order(text, text, jsonb, text, jsonb, timestamptz)
  TO service_role;

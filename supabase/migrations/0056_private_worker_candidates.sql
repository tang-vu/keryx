-- Service-role worker hints only. Selection never grants execution or renews a claim.
CREATE OR REPLACE FUNCTION public.list_private_worker_candidates(p_signer text, p_after text DEFAULT NULL)
RETURNS TABLE(id text, payer text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF p_signer IS NULL OR p_signer !~ '^0x[0-9a-f]{40}$'
    OR p_signer = '0x0000000000000000000000000000000000000000'
    OR (p_after IS NOT NULL AND p_after !~ '^prv_[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Invalid private worker selection';
  END IF;
  RETURN QUERY SELECT i.id, i.payer FROM public.private_treasury_reservations r
    JOIN public.private_research_intents i ON i.id = r.job_id
    JOIN public.private_research_payment_attempts p ON p.id = i.id
    LEFT JOIN public.private_research_executions e ON e.id = i.id
    WHERE r.signer = p_signer AND p.confirmation IS NOT NULL AND p.settled_at IS NOT NULL
      AND e.id IS NULL AND (p_after IS NULL OR i.id > p_after)
    ORDER BY i.id ASC LIMIT 25;
END;
$$;
REVOKE ALL ON FUNCTION public.list_private_worker_candidates(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_private_worker_candidates(text, text) TO service_role;

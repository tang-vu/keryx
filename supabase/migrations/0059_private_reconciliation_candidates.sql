-- Internal reserved-job selection includes incoming ambiguity and already executed jobs.
CREATE OR REPLACE FUNCTION public.list_private_reconciliation_candidates(p_signer text, p_after text DEFAULT NULL)
RETURNS TABLE(id text, payer text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF p_signer IS NULL OR p_signer !~ '^0x[0-9a-f]{40}$'
    OR p_signer = '0x0000000000000000000000000000000000000000'
    OR (p_after IS NOT NULL AND p_after !~ '^prv_[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Invalid private reconciliation selection';
  END IF;
  RETURN QUERY SELECT i.id, i.payer FROM public.private_treasury_reservations r
    JOIN public.private_research_intents i ON i.id = r.job_id
    WHERE r.signer = p_signer AND (p_after IS NULL OR i.id > p_after)
    ORDER BY i.id ASC LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.list_private_reconciliation_candidates(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_private_reconciliation_candidates(text, text) TO service_role;

-- Read-only operator accounting. Never a balance, capacity release or payment authority.
CREATE OR REPLACE FUNCTION public.private_treasury_summary(p_signer text)
RETURNS TABLE(capacity text, allocated text, committed text, confirmed text, invalid text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF p_signer IS NULL OR p_signer !~ '^0x[0-9a-f]{40}$'
    OR p_signer = '0x0000000000000000000000000000000000000000' THEN
    RAISE EXCEPTION 'Invalid private treasury selection';
  END IF;
  RETURN QUERY WITH legs AS (
    SELECT s.amount_micros,
      CASE WHEN
        (s.data#>>'{submission,amountMicros}') IS DISTINCT FROM s.amount_micros::text OR
        (s.data#>>'{submission,payer}') IS DISTINCT FROM r.signer OR
        (c.authorization_id IS NOT NULL AND (
        (c.data->'submission') IS DISTINCT FROM (s.data->'submission') OR
        NOT (COALESCE(c.data->>'source','')='circle-facilitator-success' OR
          (COALESCE(c.data->>'source','')='circle-transfer-search' AND
           COALESCE(c.data->>'transferStatus','') IN ('received','batched','confirmed','completed')))
      )) THEN 1 ELSE 0 END AS bad,
      CASE WHEN c.data->>'source'='circle-facilitator-success' OR
        (c.data->>'source'='circle-transfer-search' AND c.data->>'transferStatus' IN ('confirmed','completed'))
      THEN s.amount_micros ELSE 0 END AS settled
    FROM public.private_treasury_reservations r JOIN public.private_creator_submissions s ON s.job_id=r.job_id
    LEFT JOIN public.private_creator_confirmations c ON c.authorization_id=s.authorization_id WHERE r.signer=p_signer
  ) SELECT p.capacity_micros::text,
    COALESCE((SELECT SUM(r.amount_micros) FROM public.private_treasury_reservations r WHERE r.signer=p.signer),0)::text,
    COALESCE((SELECT SUM(l.amount_micros) FROM legs l),0)::text,
    COALESCE((SELECT SUM(l.settled) FROM legs l),0)::text,
    COALESCE((SELECT SUM(l.bad) FROM legs l),0)::text
    FROM public.private_treasury_pools p WHERE p.signer=p_signer;
END;
$$;
REVOKE ALL ON FUNCTION public.private_treasury_summary(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_treasury_summary(text) TO service_role;

-- Read-only historical observation for a separately recovered signer. The
-- privileged application still validates owner proofs and exact original bytes.
-- One STABLE SELECT binds the phase/signer filter and full retained projection.
create function public.browser_signing_exposed_snapshot_for_signer(p_signer text,p_session_id text,p_request_id text) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('original',o.original,'journal',o.journal||jsonb_strip_nulls(jsonb_build_object('phase',p.authorization_phase,
  'payment',(o.journal->'payment')||jsonb_build_object('authorizationPhase',p.authorization_phase,'settled',p.settled,'settlementStatus',p.settlement_status,'txHash',p.tx_hash),
  'signedValidAfter',b.valid_after,'signedValidBefore',b.valid_before,'signedHeaderHash',b.header_hash)),
 'currentGrant',case when g.session_id is null then null else jsonb_build_object('sessionId',g.session_id,'sessAddr',g.sess_addr,'ownerAddr',g.owner_addr,'cap',g.cap,'spent',g.spent,'expiry',g.expiry,'txHash',g.tx_hash,'grantEpoch',g.grant_epoch) end,
 'policy',jsonb_build_object('policy',pol.verified->'policy','signature',pol.verified->>'signature'),
 'namespace',jsonb_build_object('namespace',n.namespace,'owner',n.owner,'signer',n.signer,'service',n.service,'network',n.network,'ceilingMicros',n.ceiling_micro::text,'jobLimit',n.job_limit,'allocatedMicros',n.allocated_micro::text,'jobs',n.jobs,'ceilingProof',n.ceiling_proof),
 'query',jsonb_build_object('queryId',q.query_id,'namespace',q.namespace,'ceilingMicros',q.ceiling_micro::text,'spentMicros',q.spent_micro::text,'proofDigest',pol.verified->>'proofDigest'),
 'signerSpentMicros',c.spent_micro::text,'retainedEpochSpentMicros',r.spent_micro::text,'active',
  ((select active from public.browser_signing_v2_control where id=1) is true and (select active from public.browser_journal_control where id=1) is true))
 from public.browser_signing_originals o join public.browser_signing_namespaces n on n.namespace=o.namespace
 join public.browser_signing_queries q on (q.namespace,q.query_id)=(o.namespace,o.query_id)
 join public.browser_signing_policies pol on (pol.namespace,pol.policy_id)=(q.namespace,q.policy_id)
 join public.payment_events p on p.id='x402:'||o.nonce join public.browser_journal_bindings b on b.nonce=o.nonce
 join public.browser_signer_capacity c on c.signer=n.signer join public.browser_retained_grants r on r.grant_epoch=o.original->>'grantEpoch' and r.signer=n.signer
 left join public.session_grants g on g.session_id=o.session_id
 where n.signer=lower(p_signer) and o.original#>>'{authorization,from}'=lower(p_signer)
  and o.session_id=p_session_id and o.request_id=p_request_id
  and p.authorization_phase in ('exposed','signed','submission_attempted','settled','failed');
$$;
revoke all on function public.browser_signing_exposed_snapshot_for_signer(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.browser_signing_exposed_snapshot_for_signer(text,text,text) to service_role;

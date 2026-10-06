begin;
-- Ordinary service-role observation only. Sealed PostgreSQL stays explicitly
-- unsupported until its own domain-RPC enrollment, not a REST slice fallback.
create function public.operator_inventory_v1(p_network text,p_payee text,p_now timestamptz)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if p_network not in ('eip155:5042','eip155:5042002') or p_payee !~ '^0x[0-9a-f]{40}$' or p_now is null then
    raise exception 'Operator inventory input refused';
  end if;
  with obligations as (
    select started_at,round(creator_budget_usdc*1000000) cap,
      case when lower(payee)<>p_payee or request_data is null or jsonb_typeof(request_data)<>'object'
        or coalesce(request_data->>'network','eip155:5042002')<>p_network
        or creator_budget_usdc<=0 or creator_budget_usdc>1000000
        or creator_budget_usdc<>round(creator_budget_usdc*1000000)/1000000
        or started_at>p_now or transaction_id is null or btrim(transaction_id)=''
        then 1 else 0 end invalid
      from public.a2a_orders where status='running'
  ), prepaid as (
    -- Original Monthly admission validates canonical types/timestamps/caps. An
    -- invalid retained original causes RPC refusal rather than inferred credit.
    select 4-(select count(*) from public.research_monthly_redemptions r where r.monthly_id=m.id) remaining,
      (data->>'creatorBudgetMicros')::numeric cap,(data->>'expiresAt')::timestamptz>p_now active,
      case when jsonb_typeof(data)<>'object' or lower(data->>'payee') is distinct from p_payee
        or coalesce(data->>'network','eip155:5042002')<>p_network
        or jsonb_typeof(data->'creatorBudgetMicros') is distinct from 'number'
        or (data->>'creatorBudgetMicros')::numeric<=0 or (data->>'creatorBudgetMicros')::numeric>1000000000000
        or (data->>'creatorBudgetMicros')::numeric<>trunc((data->>'creatorBudgetMicros')::numeric)
        or data->>'createdAt' is null or (data->>'createdAt')::timestamptz>p_now or data->>'expiresAt' is null
        or jsonb_typeof(data->'transaction') is distinct from 'string' or btrim(data->>'transaction')=''
        or (select count(*) from public.research_monthly_redemptions r where r.monthly_id=m.id)>4
        then 1 else 0 end invalid
      from public.research_monthly m
  ) select jsonb_build_object('observedAt',to_char(p_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'network',p_network,
    'queuedJobs',count(*) filter(where started_at is null),
    'processingJobs',count(*) filter(where started_at>p_now-interval '15 minutes'),
    'reviewRequiredJobs',count(*) filter(where started_at<=p_now-interval '15 minutes'),
    'invalidJobs',coalesce(sum(invalid),0)+(select coalesce(sum(invalid),0) from prepaid),
    'queuedCreatorMicroUsdc',coalesce(sum(cap) filter(where started_at is null),0)::text,
    'unfinishedCreatorMicroUsdc',coalesce(sum(cap) filter(where started_at is not null),0)::text,
    'prepaidRequests',(select coalesce(sum(remaining) filter(where active),0) from prepaid),
    'prepaidCreatorMicroUsdc',(select trunc(coalesce(sum(remaining*cap) filter(where active),0))::text from prepaid),
    'largestCreatorMicroUsdc',trunc(greatest(coalesce(max(cap) filter(where started_at is null),0),
      (select coalesce(max(cap) filter(where active and remaining>0),0) from prepaid)))::text)
    into result from obligations;
  return result;
end;
$$;
revoke all on function public.operator_inventory_v1(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.operator_inventory_v1(text,text,timestamptz) to service_role;
create function public.operator_public_snapshot_v1(p_now timestamptz) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  with rows as (
    select *, greatest(0,floor(extract(epoch from (p_now-created_at)))) queued_age,
      greatest(0,floor(extract(epoch from (p_now-started_at)))) processing_age,
      round(extract(epoch from (updated_at-created_at))*1000) latency
      from public.a2a_orders where status='running' or updated_at>=p_now-interval '24 hours'
  ), counts as (
    select count(*) filter(where status='running' and started_at is null) queued,
      count(*) filter(where status='running' and started_at>p_now-interval '15 minutes') processing,
      count(*) filter(where status='running' and started_at<=p_now-interval '15 minutes') review,
      count(*) filter(where status='completed' and updated_at between p_now-interval '24 hours' and p_now) completed,
      count(*) filter(where status='failed' and updated_at between p_now-interval '24 hours' and p_now) failed,
      max(queued_age) filter(where status='running' and started_at is null) queued_age,
      max(processing_age) filter(where status='running' and started_at is not null) processing_age,
      percentile_disc(0.5) within group(order by latency) filter(where status='completed' and created_at<=updated_at
        and updated_at between p_now-interval '24 hours' and p_now) p50,
      percentile_disc(0.95) within group(order by latency) filter(where status='completed' and created_at<=updated_at
        and updated_at between p_now-interval '24 hours' and p_now) p95 from rows
  ) select jsonb_build_object('jobs',jsonb_build_object('queued',queued,'processing',processing,'reviewRequired',review,
    'completedLast24h',completed,'failedLast24h',failed,
    'completionRateLast24h',case when completed+failed=0 then null else round(completed::numeric/(completed+failed),4) end,
    'oldestQueuedAgeSeconds',queued_age,'oldestProcessingAgeSeconds',processing_age,
    'completionLatencyP50Ms',p50,'completionLatencyP95Ms',p95,'degraded',review>0 or coalesce(queued_age>120,false)),
    'creatorCatalog',jsonb_build_object('registered',(select count(*) from public.sources where active=true))) from counts;
$$;
revoke all on function public.operator_public_snapshot_v1(timestamptz) from public,anon,authenticated;
grant execute on function public.operator_public_snapshot_v1(timestamptz) to service_role;
commit;

begin;
-- Source migration only. Applying this to an enrolled target changes its protected
-- storage contract and requires separate review/enrollment. No sealed REST fallback.
-- These are recorded path labels, not verification of payment, provider or deliverable proof.
create function public.operator_recorded_completion_cohort_v1(
  p_resolution jsonb,p_receipt jsonb,p_package jsonb,p_journal integer,
  p_created timestamptz,p_started timestamptz,p_updated timestamptz
) returns text language plpgsql immutable security invoker set search_path=pg_catalog,public as $$
declare finished timestamptz;
begin
  if p_resolution is not null and p_resolution<>'null'::jsonb then
    if jsonb_typeof(p_resolution)<>'object' or jsonb_typeof(p_resolution->'evidence') is distinct from 'object'
      or coalesce(p_resolution->>'actor','') not in ('automatic-poll','operator-cli')
      or p_resolution->>'resolvedAt' is distinct from to_char(p_updated at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      or p_resolution->'evidence'->'queryRunFound' is distinct from 'true'::jsonb then return 'unknown'; end if;
    if p_resolution->>'action'='repair_completed' and p_resolution->>'reason'='saved_real_query_run' then return 'recovered'; end if;
    if p_resolution->>'action'='fulfill_failed_original' and p_resolution->>'actor'='operator-cli'
      and p_resolution->>'reason'='verified_failed_original_fulfilled'
      and p_resolution->'evidence'->'executionJournalVersion'='1'::jsonb
      and jsonb_typeof(p_resolution->'fulfillment')='object'
      and not exists(select 1 from unnest(array['claimId','originalFailureSha256','authoritySha256','providerLedgerSha256','runSha256']) as fields(field)
        where jsonb_typeof(p_resolution->'fulfillment'->fields.field) is distinct from 'string'
          or coalesce(p_resolution->'fulfillment'->>fields.field,'')!~'^[a-f0-9]{64}$') then return 'recovered'; end if;
    return 'unknown';
  end if;
  if p_journal is distinct from 1 or jsonb_typeof(p_receipt) is distinct from 'object'
    or jsonb_typeof(p_package) is distinct from 'object' or p_created is null or p_updated is null
    or p_started is null or p_started<p_created
    or p_package->>'schema' is distinct from 'urn:keryx:a2a-research-package:1'
    or p_package->>'version' is distinct from '1.0.0' or coalesce(p_package->>'id','') not in ('keryx-quick','keryx-deep')
    or p_receipt->>'packageId' is distinct from p_package->>'id'
    or p_receipt->>'packageVersion' is distinct from p_package->>'version'
    or p_receipt->>'outcome' is distinct from 'completed'
    or p_receipt->>'objectiveKind' is distinct from 'provisional_slo' or p_receipt->>'remedy' is distinct from 'none'
    or p_receipt->>'acceptedAt' is distinct from to_char(p_created at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or p_receipt->>'startedAt' is distinct from to_char(p_started at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or coalesce(p_receipt->>'finishedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or not pg_input_is_valid(p_receipt->>'finishedAt','timestamp with time zone') then return 'unknown'; end if;
  finished:=(p_receipt->>'finishedAt')::timestamptz;
  if finished<p_started or finished>p_updated then return 'unknown'; end if;
  return 'ordinary';
end; $$;
revoke all on function public.operator_recorded_completion_cohort_v1(jsonb,jsonb,jsonb,integer,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.operator_recorded_completion_cohort_v1(jsonb,jsonb,jsonb,integer,timestamptz,timestamptz,timestamptz) to service_role;

create or replace function public.operator_public_snapshot_v1(p_now timestamptz) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  with rows as (
    select status,created_at,updated_at,started_at,
      greatest(0,floor(extract(epoch from (p_now-created_at)))) queued_age,
      greatest(0,floor(extract(epoch from (p_now-started_at)))) processing_age,
      round(extract(epoch from (updated_at-created_at))*1000) latency,
      public.operator_recorded_completion_cohort_v1(resolution_data,response_data->'serviceReceipt',package_data,
        execution_journal_version,created_at,started_at,updated_at) cohort
      from public.a2a_orders where status='running' or updated_at>=p_now-interval '24 hours'
  ), completed_rows as (
    select * from rows where status='completed' and updated_at between p_now-interval '24 hours' and p_now
  ), cohort_names as (select unnest(array['ordinary','recovered','unknown']) cohort), cohort_counts as (
    select name.cohort,jsonb_build_object('completed',count(r.cohort),
      'timedSamples',count(r.latency) filter(where r.created_at<=r.updated_at),
      'p50Ms',percentile_disc(0.5) within group(order by r.latency) filter(where r.created_at<=r.updated_at),
      'p95Ms',percentile_disc(0.95) within group(order by r.latency) filter(where r.created_at<=r.updated_at)) summary
      from cohort_names name left join completed_rows r on r.cohort=name.cohort group by name.cohort
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
    'completionLatencyP50Ms',p50,'completionLatencyP95Ms',p95,
    'completionLatencyCohorts',(select jsonb_object_agg(cohort,summary) from cohort_counts),
    'degraded',review>0 or coalesce(queued_age>120,false)),
    'creatorCatalog',jsonb_build_object('registered',(select count(*) from public.sources where active=true))) from counts;
$$;
-- Existing public snapshot remains service-role-only. No table or row is rewritten.
revoke all on function public.operator_public_snapshot_v1(timestamptz) from public,anon,authenticated;
grant execute on function public.operator_public_snapshot_v1(timestamptz) to service_role;
commit;

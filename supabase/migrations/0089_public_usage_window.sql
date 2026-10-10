-- Ordinary storage only. No history rewrite, payment mutation, or native enrollment.
do $$ begin
  if to_regclass('public.keryx_storage_identity') is not null or to_regclass('keryx_storage.identity') is not null then
    raise exception 'usage_unavailable';
  end if;
end $$;

create or replace function public.public_usage_window_v1(p_window jsonb)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public set statement_timeout = '15s'
as $$
declare
  lower_bound timestamptz; upper_bound timestamptz; result jsonb; runs jsonb; payments jsonb;
begin
  if to_regclass('public.keryx_storage_identity') is not null or to_regclass('keryx_storage.identity') is not null then
    raise exception 'usage_unavailable';
  end if;
  if p_window is null or jsonb_typeof(p_window) <> 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(p_window) k) is distinct from array['network','period','since','until']
    or p_window->>'network' not in ('eip155:5042','eip155:5042002')
    or p_window->>'period' not in ('all','7d','30d','custom')
    or jsonb_typeof(p_window->'network') <> 'string' or jsonb_typeof(p_window->'period') <> 'string'
    or jsonb_typeof(p_window->'since') <> 'string' or jsonb_typeof(p_window->'until') <> 'string'
    or p_window->>'since' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or p_window->>'until' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
    raise exception 'usage_unavailable';
  end if;
  lower_bound := (p_window->>'since')::timestamptz; upper_bound := (p_window->>'until')::timestamptz;
  if lower_bound >= upper_bound
    or to_char(lower_bound at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> p_window->>'since'
    or to_char(upper_bound at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> p_window->>'until'
    or ((p_window->>'period')='all' and (p_window->>'since')<>'1970-01-01T00:00:00.000Z')
    or ((p_window->>'period')='custom' and (p_window->>'since') not like '%T00:00:00.000Z')
    or ((p_window->>'period')='7d' and upper_bound-lower_bound<>interval '7 days')
    or ((p_window->>'period')='30d' and upper_bound-lower_bound<>interval '30 days') then
    raise exception 'usage_unavailable';
  end if;
  -- One PostgreSQL statement snapshot. Metadata only; never pull run bodies to
  -- bypass a REST page limit. The extra row proves whether the finite window fits.
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,
    'createdAt',to_char(q.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'usage',case when jsonb_typeof(q.data->'usage')='object' and octet_length((q.data->'usage')::text)<=2048 then q.data->'usage' else 'null'::jsonb end,
    'provenance',case when jsonb_typeof(q.data->'provenance')='object' and octet_length((q.data->'provenance')::text)<=1024 then q.data->'provenance' else 'null'::jsonb end,
    'actorId',case when q.asker ~ '^0x[0-9a-fA-F]{40}$' then q.asker else null end)), '[]'::jsonb)
    into runs from (select id,created_at,data,asker from public.query_runs
      where created_at>=lower_bound and created_at<upper_bound limit 10001) q;
  if jsonb_array_length(runs)>10000 then raise exception 'usage_unavailable'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'queryId',p.query_id,'network',p.network,'kind',p.kind,
    'amountUsdc',p.amount_usdc::text,'settled',p.settled,'settlementStatus',p.settlement_status,'txHash',p.tx_hash,'payee',p.payee)), '[]'::jsonb)
    into payments from (select p.id,p.query_id,p.network,p.kind,p.amount_usdc,p.settled,p.settlement_status,p.tx_hash,p.payee
      from public.payment_events p join public.query_runs q on q.id=p.query_id
      where q.created_at>=lower_bound and q.created_at<upper_bound limit 50001) p;
  if jsonb_array_length(payments)>50000 then raise exception 'usage_unavailable'; end if;
  result := jsonb_build_object('complete',true,'window',p_window,'runs',runs,'payments',payments);
  if octet_length(result::text)>8388608 then raise exception 'usage_unavailable'; end if;
  return result;
exception when others then raise exception 'usage_unavailable';
end $$;
revoke all on function public.public_usage_window_v1(jsonb) from public, anon, authenticated;
grant execute on function public.public_usage_window_v1(jsonb) to service_role;

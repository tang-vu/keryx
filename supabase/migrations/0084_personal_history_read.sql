begin;
-- SOURCE ONLY: additive ordinary read RPC. No enrollment or sealed-generation refresh.
do $$ declare enrolled boolean; begin
  if to_regclass('keryx_storage.identity') is not null then
    execute 'select exists(select 1 from keryx_storage.identity)' into enrolled;
    if enrolled then raise exception 'Personal history unavailable in enrolled storage'; end if;
  end if;
end; $$;

create function public.personal_history_read_v1(p_wallet text,p_filters jsonb,p_take integer,p_upper jsonb,p_before jsonb) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare enrolled boolean; result jsonb; r record;
begin
  if to_regclass('keryx_storage.identity') is not null then
    execute 'select exists(select 1 from keryx_storage.identity)' into enrolled;
    if enrolled then raise exception 'Personal history unavailable in enrolled storage'; end if;
  end if;
  if p_wallet is null or p_wallet !~ '^0x[0-9a-f]{40}$' or p_take is null or p_take not between 1 and 51
    or p_filters is null or jsonb_typeof(p_filters) <> 'object' then raise exception 'Invalid history query'; end if;
  if exists(select 1 from jsonb_each(p_filters) where key not in ('search','surface','funding','from','to') or jsonb_typeof(value)<>'string')
    or octet_length(p_filters::text)>2048 or char_length(p_filters->>'search')>200
    or (p_filters ? 'surface' and p_filters->>'surface' not in ('web','remote-mcp','stdio-mcp','api','agent-to-agent','telegram','discord','slack','extension','desktop','cli','unknown'))
    or (p_filters ? 'funding' and p_filters->>'funding' not in ('browser-recorded','other-or-unknown')) then raise exception 'Invalid history filters'; end if;
  for r in select value from jsonb_each(p_filters) where key in ('from','to') union all
    select value->'createdAt' from (values(p_upper),(p_before)) positions(value) where value is not null loop
    if r.value #>> '{}' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
      or to_char((r.value #>> '{}')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> r.value #>> '{}'
      then raise exception 'Invalid history date'; end if;
  end loop;
  if (p_filters->>'from')::timestamptz > (p_filters->>'to')::timestamptz then raise exception 'Invalid history bounds'; end if;
  for r in select value from (values(p_upper),(p_before)) positions(value) where value is not null loop
    if jsonb_typeof(r.value)<>'object' or not (r.value ?& array['createdAt','id'])
      or (select count(*) from jsonb_object_keys(r.value))<>2
      or jsonb_typeof(r.value->'createdAt')<>'string' or jsonb_typeof(r.value->'id')<>'string'
      or r.value->>'id' !~ '^[a-zA-Z0-9_-]{1,128}$' then raise exception 'Invalid history position'; end if;
  end loop;
  -- No SELECT * or raw run JSON: summaries cannot disclose private fulfillment or answers.
  with selected as (
    select id,created_at,question,asker,total_spent,total_to_creators,payment_mode,parent_id,
      data->'asker' recorded_owner,data->'askerFunded' funded,
      case when jsonb_typeof(data->'provenance')='object' then
        case when (select count(*) from jsonb_object_keys(data->'provenance'))=3
          and data->'provenance'->'version'='1'::jsonb
          and data->'provenance'->>'surface' in ('web','remote-mcp','stdio-mcp','api','agent-to-agent','telegram','discord','slack','extension','desktop','cli','unknown')
          and data->'provenance'->>'ownershipMethod' in ('session','api-key','verified-payer','unknown')
          then data->'provenance' end end provenance
    from public.query_runs where asker=p_wallet
  ), page as (
    select * from selected where
      (p_upper is null or created_at<(p_upper->>'createdAt')::timestamptz or (created_at=(p_upper->>'createdAt')::timestamptz and id collate "C" <= (p_upper->>'id') collate "C"))
      and (p_before is null or created_at<(p_before->>'createdAt')::timestamptz or (created_at=(p_before->>'createdAt')::timestamptz and id collate "C" < (p_before->>'id') collate "C"))
      and (not (p_filters ? 'from') or created_at >= (p_filters->>'from')::timestamptz)
      and (not (p_filters ? 'to') or created_at <= (p_filters->>'to')::timestamptz)
      and (not (p_filters ? 'search') or strpos(question,p_filters->>'search')>0)
      and (not (p_filters ? 'surface') or coalesce(provenance->>'surface','unknown')=p_filters->>'surface')
      and (not (p_filters ? 'funding') or case when funded='true'::jsonb then 'browser-recorded' else 'other-or-unknown' end=p_filters->>'funding')
    order by created_at desc,id collate "C" desc limit p_take
  ) select jsonb_build_object('wallet',p_wallet,'rows',coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'createdAt',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'question',question,'provenance',provenance,'funding',case when funded='true'::jsonb then 'browser-recorded' else 'other-or-unknown' end,
      'recordedSpendUsdc',total_spent,'recordedCreatorAllocationUsdc',total_to_creators,'paymentMode',payment_mode,'isFollowUp',parent_id is not null
    ) order by created_at desc,id collate "C" desc),'[]'::jsonb),
    'invalid',coalesce(bool_or(id !~ '^[a-zA-Z0-9_-]{1,128}$' or question is null or char_length(question)>8192
      or total_spent is null or total_to_creators is null or total_spent<0 or total_to_creators<0
      or payment_mode is not null and payment_mode not in ('real','offline')
      or extract(microseconds from created_at)::bigint % 1000 <> 0
      or recorded_owner is not null and recorded_owner <> 'null'::jsonb and (jsonb_typeof(recorded_owner)<>'string' or lower(recorded_owner #>> '{}')<>p_wallet)),false)) into result from page;
  if result->'invalid'='true'::jsonb then raise exception 'Personal history projection unavailable'; end if;
  return result - 'invalid';
end; $$;
revoke all on function public.personal_history_read_v1(text,jsonb,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.personal_history_read_v1(text,jsonb,integer,jsonb,jsonb) to service_role;
commit;

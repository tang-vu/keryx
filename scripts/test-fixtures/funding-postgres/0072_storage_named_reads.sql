begin;
create function public.storage_list_article_offers(p_expected_identity jsonb,p_source_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.require_identity(p_expected_identity);
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from
    (select * from public.article_offers where p_source_id is null or source_id=p_source_id order by created_at desc limit 1001) r;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  return result;
end; $$;
create function public.storage_a2a_operations_snapshot(p_expected_identity jsonb,p_since timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.require_identity(p_expected_identity);
  if p_since is null then raise exception 'invalid snapshot window'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from
    (select status,created_at,updated_at,started_at from public.a2a_orders where status='running' or updated_at>=p_since limit 1001) r;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  return result;
end; $$;
create function public.storage_get_feedback_stats(p_expected_identity jsonb,p_query_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.require_identity(p_expected_identity);
  select jsonb_build_object('total',count(*),'up',count(*) filter(where rating='up'),
    'down',count(*) filter(where rating='down')) into result from public.answer_feedback
    where p_query_id is null or query_id=p_query_id;
  return result;
end; $$;
create function public.storage_list_creator_withdrawal_history(p_expected_identity jsonb,p_owner text,p_before_time timestamptz,p_before_id text,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.require_identity(p_expected_identity);
  if p_limit is null or p_limit<2 or p_limit>26 or p_owner is null
    or (p_before_time is null)<>(p_before_id is null) then raise exception 'invalid history selection'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from
    (select id,owner,created_at,data from public.creator_withdrawal_requests where owner=p_owner
      and (p_before_time is null or (created_at,id)<(p_before_time,p_before_id)) order by created_at desc,id desc limit p_limit) r;
  return result;
end; $$;
create function public.storage_list_private_research_history(p_expected_identity jsonb,p_owner text,p_before_time timestamptz,p_before_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.require_identity(p_expected_identity);
  if p_owner is null or (p_before_time is null)<>(p_before_id is null) then raise exception 'invalid history selection'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from
    (select id,data,created_at from public.private_research_intents where payer=p_owner
      and (p_before_time is null or (created_at,id)<(p_before_time,p_before_id)) order by created_at desc,id desc limit 26) r;
  return result;
end; $$;
create function public.storage_iterate_recent_queries(p_expected_identity jsonb,p_before_time timestamptz,p_before_id text,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.require_identity(p_expected_identity);
  if p_limit is null or p_limit<1 or p_limit>32 or (p_before_time is null)<>(p_before_id is null) then raise exception 'invalid query cursor'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from
    (select id,created_at,data from public.query_runs
      where p_before_time is null or (created_at,id)<(p_before_time,p_before_id) order by created_at desc,id desc limit p_limit) r;
  return result;
end; $$;

-- Owner installation generates six fixed domain scans; no runtime selector exists.
do $$ declare item record; begin
  for item in select * from (values
    ('scan_cache_for_encryption','cache_items','source_id'),('scan_payment_metrics','payment_events','id'),
    ('scan_query_metrics','query_runs','id'),('scan_feedback_metrics','answer_feedback','id'),
    ('scan_gap_metrics','gap_intents','id'),('scan_order_economics','a2a_orders','id')) as x(operation,relation,sort_key) loop
    execute format($fn$create function public.storage_%I(p_expected_identity jsonb,p_offset integer,p_limit integer) returns jsonb
      language plpgsql security definer set search_path=pg_catalog,pg_temp as $body$
      declare result jsonb; begin
        perform keryx_storage.require_identity(p_expected_identity);
        if p_offset is null or p_offset<0 or p_offset>200000 or p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'invalid complete scan bounds'; end if;
        select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from
          (select * from public.%I order by %I limit p_limit offset p_offset) r;
        return result;
      end; $body$;$fn$,item.operation,item.relation,item.sort_key);
  end loop;
end; $$;
revoke all on all functions in schema public from public,anon,authenticated;
commit;

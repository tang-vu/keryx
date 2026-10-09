begin;
-- SOURCE ONLY. Ordinary acceptance requests grant no native domain or financial authority.
create function public.deliverable_acceptance_ordinary_v1() returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if to_regclass('keryx_storage.identity') is not null or to_regclass('public.keryx_storage_identity') is not null then
    raise exception 'acceptance_unavailable';
  end if;
end; $$;
select public.deliverable_acceptance_ordinary_v1();
create table public.deliverable_acceptance_store(singleton boolean primary key check(singleton),id uuid not null default gen_random_uuid());
insert into public.deliverable_acceptance_store(singleton) values(true);
create table public.deliverable_acceptance_entries(
  owner text not null check(owner ~ '^0x[0-9a-f]{40}$'), network text not null check(network in ('eip155:5042','eip155:5042002')),
  original_id text not null references public.a2a_orders(id), revision integer not null check(revision between 1 and 100),
  idempotency_key text not null check(idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  original_fingerprint text not null check(original_fingerprint ~ '^[0-9a-f]{64}$'), delivered_digest text not null check(delivered_digest ~ '^[0-9a-f]{64}$'),
  data jsonb not null, primary key(owner,network,original_id,revision), unique(owner,network,original_id,idempotency_key)
);
create function public.deliverable_acceptance_immutable_v1() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin raise exception 'acceptance_unavailable'; end; $$;
create trigger deliverable_acceptance_store_immutable before update or delete on public.deliverable_acceptance_store
  for each row execute function public.deliverable_acceptance_immutable_v1();
create trigger deliverable_acceptance_entries_immutable before update or delete on public.deliverable_acceptance_entries
  for each row execute function public.deliverable_acceptance_immutable_v1();
alter table public.deliverable_acceptance_store enable row level security;
alter table public.deliverable_acceptance_entries enable row level security;
revoke all on public.deliverable_acceptance_store,public.deliverable_acceptance_entries from public,anon,authenticated;
grant select on public.deliverable_acceptance_store to service_role;
grant select,insert on public.deliverable_acceptance_entries to service_role;
create policy deliverable_acceptance_store_service_read on public.deliverable_acceptance_store for select to service_role using(true);
create policy deliverable_acceptance_entries_service_read on public.deliverable_acceptance_entries for select to service_role using(true);
create policy deliverable_acceptance_entries_service_insert on public.deliverable_acceptance_entries for insert to service_role with check(true);

create function public.deliverable_acceptance_bundle_v1(p_owner text,p_network text,p_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare o public.a2a_orders%rowtype; retained text; latest jsonb;
begin
  perform public.deliverable_acceptance_ordinary_v1();
  if p_owner is null or p_owner !~ '^0x[0-9a-f]{40}$' or p_network is null or p_network not in ('eip155:5042','eip155:5042002')
    or p_id is null or p_id !~ '^a2a_[0-9a-f]{64}$' then raise exception 'acceptance_unavailable'; end if;
  select * into o from public.a2a_orders where id=p_id and lower(payer)=p_owner;
  if not found or o.status<>'completed' or o.query_id<>p_id or o.response_data is null or
    o.request_data->>'network' is distinct from p_network or o.request_data ? 'monthlyId' or
    o.response_data->>'status' is distinct from 'completed' or o.response_data->>'queryId' is distinct from p_id or
    jsonb_typeof(o.response_data->'answer') is distinct from 'string' or
    o.package_data->'serviceLevel'->>'remedy' is distinct from 'none' or
    octet_length(o.response_data::text)>4000000 then raise exception 'acceptance_unavailable'; end if;
  if not exists(select 1 from public.research_purchase_authorizations c join public.payment_events p
    on p.id='inbound_'||p_id and p.kind='inbound' and p.source_id='a2a' and p.query_id=c.purchase_id
    and lower(p.payer)=c.payer and lower(p.payee)=c.payee and lower(p.authorization_id)=c.authorization_id and p.network=c.network
    and p.settled and p.settlement_status='settled' and p.tx_hash=o.transaction_id and p.amount_usdc=o.amount_usdc
    where c.network=p_network and c.payer=p_owner and c.payee=lower(o.payee) and c.authorization_id=lower(o.authorization_id)
    and c.product='a2a' and c.purchase_id=p_id and c.request_hash=o.request_hash and c.amount_micros=o.amount_usdc*1000000
    and not exists(select 1 from public.research_monthly_redemptions where order_id=p_id)) then raise exception 'acceptance_unavailable'; end if;
  retained:=jsonb_build_object('order',to_jsonb(o),'deliveryText',o.response_data::text,'settled',true,'network',p_network)::text;
  if octet_length(retained)>4194304 then raise exception 'acceptance_unavailable'; end if;
  select data into latest from public.deliverable_acceptance_entries where owner=p_owner and network=p_network and original_id=p_id order by revision desc limit 1;
  return jsonb_build_object('storeId',(select id::text from public.deliverable_acceptance_store where singleton),
    'originalText',retained,'latest',latest,'pendingPaymentLegs',exists(select 1 from public.payment_events
      where query_id=p_id and kind is distinct from 'inbound' and (settlement_status='pending' or settlement_status is null)));
end; $$;
create function public.deliverable_acceptance_read_v1(p_owner text,p_network text,p_id text) returns jsonb
language sql security invoker set search_path=pg_catalog,public as $$ select public.deliverable_acceptance_bundle_v1(p_owner,p_network,p_id) $$;

create function public.deliverable_acceptance_submit_v1(p_owner text,p_network text,p_id text,p_input jsonb,p_authority jsonb,p_original_sha256 text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare bundle jsonb; stamp bigint; session_issued bigint; session_expires bigint; fingerprint text; delivered text; original_hash text; current_revision integer; replay jsonb; entry jsonb;
begin
  perform public.deliverable_acceptance_ordinary_v1();
  -- Serialize competing submissions with the exact original. No execution or payment update.
  perform 1 from public.a2a_orders where id=p_id and lower(payer)=p_owner for update;
  if not found then raise exception 'acceptance_unavailable'; end if;
  if jsonb_typeof(p_authority) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_authority))<>2
    or not (p_authority ?& array['kind','id']) or jsonb_typeof(p_authority->'id') is distinct from 'string' then raise exception 'acceptance_unauthenticated'; end if;
  if p_authority->>'kind'='session' then
    -- Acquire durable authority first; a lock wait must not preserve an earlier valid clock.
    select issued_at,expires_at into session_issued,session_expires from public.web_sessions
      where hash=p_authority->>'id' and wallet=p_owner for share;
    if not found then raise exception 'acceptance_unauthenticated'; end if;
    stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
    if session_issued>stamp or session_expires<=stamp then raise exception 'acceptance_unauthenticated'; end if;
  elsif p_authority->>'kind'='api-key' then
    perform 1 from public.api_keys where id=p_authority->>'id' and lower(wallet)=p_owner and revoked_at is null
      and exists(select 1 from unnest(string_to_array(coalesce(scopes,''),',')) value where btrim(value)='deliverable:write') for share;
    if not found then raise exception 'acceptance_unauthenticated'; end if;
  else raise exception 'acceptance_unauthenticated'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_input))<>7 or
    not (p_input ?& array['originalFingerprint','deliveredDigest','expectedRevision','idempotencyKey','choice','reason','publishState']) or
    exists(select 1 from jsonb_each(p_input) where key in ('originalFingerprint','deliveredDigest','idempotencyKey','choice','reason') and jsonb_typeof(value)<>'string') or
    jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or p_input->>'expectedRevision' !~ '^(0|[1-9][0-9]?)$' or
    jsonb_typeof(p_input->'publishState') is distinct from 'boolean' or jsonb_typeof(p_input->'reason') is distinct from 'string' or
    char_length(p_input->>'reason')>1000 or octet_length(p_input::text)>10000 or
    (select coalesce(sum(case when octet_length(convert_to(unit,'UTF8'))=4 then 2 else 1 end),0)
      from regexp_split_to_table(p_input->>'reason','') unit)>1000 or
    regexp_replace(p_input->>'reason',E'[\t\n\r]','','g') ~ E'[\x01-\x1f\x7f]' or
    p_input->>'idempotencyKey' !~ '^[A-Za-z0-9_-]{16,128}$' or p_input->>'choice' not in ('accept','revise','reject') or
    p_input->>'originalFingerprint' !~ '^[0-9a-f]{64}$' or p_input->>'deliveredDigest' !~ '^[0-9a-f]{64}$'
    then raise exception 'acceptance_unavailable'; end if;
  bundle:=public.deliverable_acceptance_bundle_v1(p_owner,p_network,p_id);
  original_hash:=encode(sha256(convert_to(bundle->>'originalText','UTF8')),'hex');
  fingerprint:=encode(sha256(convert_to('keryx-acceptance-original-v1|'||(bundle->>'storeId')||'|'||p_network||'|'||p_owner||'|'||p_id||'|'||original_hash,'UTF8')),'hex');
  delivered:=encode(sha256(convert_to((bundle->>'originalText')::jsonb->>'deliveryText','UTF8')),'hex');
  if original_hash is distinct from p_original_sha256 or fingerprint is distinct from p_input->>'originalFingerprint'
    or delivered is distinct from p_input->>'deliveredDigest' then raise exception 'acceptance_conflict'; end if;
  select data into replay from public.deliverable_acceptance_entries where owner=p_owner and network=p_network and original_id=p_id and idempotency_key=p_input->>'idempotencyKey';
  if found then
    if replay-'revision'-'submittedAt'<>p_input then raise exception 'acceptance_conflict'; end if;
    return bundle;
  end if;
  current_revision:=coalesce((bundle->'latest'->>'revision')::integer,0);
  if current_revision<>(p_input->>'expectedRevision')::integer or
    (current_revision>0 and bundle->'latest'->>'originalFingerprint' is distinct from fingerprint) then raise exception 'acceptance_conflict'; end if;
  entry:=p_input||jsonb_build_object('revision',current_revision+1,'submittedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  insert into public.deliverable_acceptance_entries values(p_owner,p_network,p_id,current_revision+1,p_input->>'idempotencyKey',fingerprint,delivered,entry);
  return public.deliverable_acceptance_bundle_v1(p_owner,p_network,p_id);
end; $$;
create function public.deliverable_acceptance_public_v1(p_network text,p_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare owner text; bundle jsonb; entry jsonb; fingerprint text;
begin
  perform public.deliverable_acceptance_ordinary_v1();
  select lower(payer) into owner from public.a2a_orders where id=p_id;
  if found then
    begin
      bundle:=public.deliverable_acceptance_bundle_v1(owner,p_network,p_id); entry:=bundle->'latest';
      fingerprint:=encode(sha256(convert_to('keryx-acceptance-original-v1|'||(bundle->>'storeId')||'|'||p_network||'|'||owner||'|'||p_id||'|'||encode(sha256(convert_to(bundle->>'originalText','UTF8')),'hex'),'UTF8')),'hex');
      if entry->>'publishState'='true' and entry->>'originalFingerprint'=fingerprint then
        return jsonb_build_object('format','keryx-public-deliverable-state-v1','state',case entry->>'choice' when 'accept' then 'accepted' when 'revise' then 'revision_requested' else 'rejected' end,'submittedAt',entry->'submittedAt');
      end if;
    exception when others then null; end;
  end if;
  return jsonb_build_object('format','keryx-public-deliverable-state-v1','state','not_shared','submittedAt',null);
end; $$;
create function public.deliverable_acceptance_metrics_v1(p_network text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare states jsonb; total integer;
begin
  perform public.deliverable_acceptance_ordinary_v1();
  if p_network is null or p_network not in ('eip155:5042','eip155:5042002') then raise exception 'acceptance_unavailable'; end if;
  with selected as (select distinct on(owner,original_id) owner,original_id,data from public.deliverable_acceptance_entries
    where network=p_network order by owner,original_id,revision desc), bounded as
    (select distinct original_id from selected where data->>'publishState'='true' order by original_id limit 1001)
  select count(*),coalesce(jsonb_agg(public.deliverable_acceptance_public_v1(p_network,original_id)),'[]'::jsonb) into total,states from bounded;
  if total>1000 then raise exception 'acceptance_unavailable'; end if;
  return states;
end; $$;
revoke all on function public.deliverable_acceptance_ordinary_v1(),public.deliverable_acceptance_immutable_v1(),public.deliverable_acceptance_bundle_v1(text,text,text),
  public.deliverable_acceptance_read_v1(text,text,text),public.deliverable_acceptance_submit_v1(text,text,text,jsonb,jsonb,text),public.deliverable_acceptance_public_v1(text,text),public.deliverable_acceptance_metrics_v1(text) from public,anon,authenticated;
grant execute on function public.deliverable_acceptance_ordinary_v1(),public.deliverable_acceptance_bundle_v1(text,text,text),public.deliverable_acceptance_read_v1(text,text,text),
  public.deliverable_acceptance_submit_v1(text,text,text,jsonb,jsonb,text),public.deliverable_acceptance_public_v1(text,text),public.deliverable_acceptance_metrics_v1(text) to service_role;
commit;

-- One verified debit is permanently admitted for exactly one purpose and request contract.
-- Admission is not settlement or entitlement; retain unknown/failed attempts for safe recovery.
create table if not exists public.research_purchase_authorizations (
  network text not null check(network='eip155:5042002'),
  asset text not null check(asset='0x3600000000000000000000000000000000000000'),
  payer text not null, authorization_id text not null, payee text not null,
  product text not null check(product in ('a2a','monthly','resource')),
  purchase_id text not null, request_hash text not null,
  amount_micros bigint not null check(amount_micros between 1 and 9007199254740991),
  primary key(network,asset,payer,authorization_id)
);
create table if not exists public.research_monthly (
  id text primary key check(id ~ '^monthly_[a-f0-9]{64}$'),
  payer text not null check(payer ~ '^0x[a-f0-9]{40}$'), data jsonb not null
);
create table if not exists public.research_monthly_redemptions (
  monthly_id text not null references public.research_monthly(id), request_id text not null,
  order_id text not null unique references public.a2a_orders(id) deferrable initially deferred,
  request_hash text not null, created_at timestamptz not null,
  slot integer not null check(slot between 0 and 3),
  primary key(monthly_id,request_id), unique(monthly_id,slot)
);

-- Backfill durable research first. Unbound historical resource authorizations fail closed.
insert into public.research_purchase_authorizations(network,asset,payer,authorization_id,payee,product,purchase_id,request_hash,amount_micros)
select 'eip155:5042002','0x3600000000000000000000000000000000000000',lower(payer),lower(authorization_id),lower(payee),'a2a',id,request_hash,round(amount_usdc*1000000)::bigint
from public.a2a_orders
where not exists(select 1 from public.research_monthly_redemptions where order_id=a2a_orders.id)
on conflict do nothing;
insert into public.research_purchase_authorizations(network,asset,payer,authorization_id,payee,product,purchase_id,request_hash,amount_micros)
select network,'0x3600000000000000000000000000000000000000',lower(payer),lower(authorization_id),lower(payee),'resource',id,'legacy:unbound',round(amount_usdc*1000000)::bigint
from public.payment_events where network='eip155:5042002' and authorization_id is not null and authorization_id!='' and amount_usdc>0
on conflict do nothing;

do $$ begin
  if exists(select 1 from public.a2a_orders a join public.research_purchase_authorizations c
    on c.payer=lower(a.payer) and c.authorization_id=lower(a.authorization_id)
    where not exists(select 1 from public.research_monthly_redemptions where order_id=a.id)
      and (c.payee!=lower(a.payee) or c.product!='a2a' or c.purchase_id!=a.id or c.request_hash!=a.request_hash or c.amount_micros!=round(a.amount_usdc*1000000)::bigint))
    or exists(select 1 from public.payment_events p join public.research_purchase_authorizations c
      on c.payer=lower(p.payer) and c.authorization_id=lower(p.authorization_id)
      where p.network='eip155:5042002' and p.authorization_id is not null and p.authorization_id!='' and p.amount_usdc>0
        and (c.payee!=lower(p.payee) or c.amount_micros!=round(p.amount_usdc*1000000)::bigint
          or (c.product in ('a2a','monthly') and (p.kind is distinct from 'inbound' or p.query_id is distinct from c.purchase_id)))) then
    raise exception 'Ambiguous historical research authorization; reconciliation required';
  end if;
end $$;

create or replace function public.claim_research_purchase(p_claim jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
declare original public.research_purchase_authorizations; proposed public.research_purchase_authorizations;
begin
  proposed := jsonb_populate_record(null::public.research_purchase_authorizations,p_claim);
  if proposed.network is distinct from 'eip155:5042002' or proposed.asset is distinct from '0x3600000000000000000000000000000000000000'
    or proposed.payer is null or proposed.payer !~ '^0x[a-f0-9]{40}$' or proposed.payee is null or proposed.payee !~ '^0x[a-f0-9]{40}$'
    or proposed.authorization_id is null or length(proposed.authorization_id) not between 1 and 256 or proposed.authorization_id!=lower(proposed.authorization_id)
    or proposed.product is null or proposed.product not in ('a2a','monthly','resource') or proposed.request_hash is null or proposed.request_hash !~ '^[a-f0-9]{64}$'
    or proposed.amount_micros is null or proposed.amount_micros not between 1 and 9007199254740991
    or proposed.purchase_id is distinct from (case when proposed.product='monthly' then 'monthly_' else 'a2a_' end ||
      encode(sha256(convert_to('keryx-a2a-v2|'||proposed.network||'|'||proposed.payer||'|'||proposed.payee||'|'||proposed.authorization_id,'UTF8')),'hex')) then
    raise exception 'Invalid research authorization claim';
  end if;
  insert into public.research_purchase_authorizations select proposed.* on conflict do nothing;
  select * into strict original from public.research_purchase_authorizations
    where network=proposed.network and asset=proposed.asset and payer=proposed.payer and authorization_id=proposed.authorization_id for update;
  if original is distinct from proposed then raise exception 'Research authorization claim conflict'; end if;
  return true;
end $$;

create or replace function public.enforce_a2a_purchase_authorization() returns trigger
language plpgsql security definer set search_path=public as $$
declare original public.research_purchase_authorizations;
begin
  -- A prepaid redemption is already linked within the same transaction and is not a new debit.
  if exists(select 1 from public.research_monthly_redemptions where order_id=new.id) then return new; end if;
  insert into public.research_purchase_authorizations(network,asset,payer,authorization_id,payee,product,purchase_id,request_hash,amount_micros)
  values('eip155:5042002','0x3600000000000000000000000000000000000000',lower(new.payer),lower(new.authorization_id),lower(new.payee),'a2a',new.id,new.request_hash,round(new.amount_usdc*1000000)::bigint)
  on conflict do nothing;
  select * into strict original from public.research_purchase_authorizations
    where network='eip155:5042002' and asset='0x3600000000000000000000000000000000000000'
      and payer=lower(new.payer) and authorization_id=lower(new.authorization_id) for update;
  if original.product!='a2a' or original.payee!=lower(new.payee) or original.purchase_id!=new.id
    or original.request_hash!=new.request_hash or original.amount_micros!=round(new.amount_usdc*1000000)::bigint then
    raise exception 'Research authorization already used';
  end if;
  return new;
end $$;
create trigger a2a_purchase_authorization after insert on public.a2a_orders
for each row execute function public.enforce_a2a_purchase_authorization();

create or replace function public.research_canonical_json(value jsonb) returns text
language sql immutable set search_path=public as $$
  select case jsonb_typeof(value)
    when 'object' then '{'||coalesce((select string_agg(to_json(key)::text||':'||public.research_canonical_json(val),',' order by key collate "C") from jsonb_each(value) as entry(key,val)),'')||'}'
    when 'array' then '['||coalesce((select string_agg(public.research_canonical_json(val),',' order by ord) from jsonb_array_elements(value) with ordinality as entry(val,ord)),'')||']'
    else value::text end;
$$;

create or replace function public.create_research_monthly(p_purchase jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare original jsonb; inserted integer; package jsonb; mode text;
begin
  if jsonb_typeof(p_purchase) is distinct from 'object' or not p_purchase ?& array['id','payer','payee','authorizationId','transaction','quoteId','createdAt','expiresAt','creatorBudgetMicros','serviceFeeMicros','totalMicros','researchPackage']
    or (select count(*) from jsonb_object_keys(p_purchase))!=12
    or jsonb_typeof(p_purchase->'creatorBudgetMicros') is distinct from 'number' or jsonb_typeof(p_purchase->'serviceFeeMicros') is distinct from 'number'
    or jsonb_typeof(p_purchase->'totalMicros') is distinct from 'number' or jsonb_typeof(p_purchase->'createdAt') is distinct from 'string'
    or jsonb_typeof(p_purchase->'expiresAt') is distinct from 'string' or jsonb_typeof(p_purchase->'transaction') is distinct from 'string'
    or jsonb_typeof(p_purchase->'researchPackage') is distinct from 'object' then raise exception 'Invalid Monthly purchase'; end if;
  mode:=p_purchase->'researchPackage'->>'researchMode';
  package:=jsonb_build_object('schema','urn:keryx:a2a-research-package:1','id','keryx-'||mode,'version','1.0.0','researchMode',mode,
    'execution',jsonb_build_object('attentionLimit',case when mode='quick' then 2 else 4 end,'reevaluateRounds',case when mode='quick' then 0 else 1 end),
    'serviceLevel',jsonb_build_object('kind','provisional_slo','targetCompletionMs',case when mode='quick' then 180000 else 300000 end,'startsAt','accepted_at','remedy','none'),
    'quality',jsonb_build_object('measurement','evidence-ledger-v1','groundingThreshold',0.4,'commitment','best_effort'));
  if mode is null or mode not in ('quick','deep') or p_purchase->'researchPackage' is distinct from package
    or (p_purchase->>'totalMicros')::numeric != 4*(p_purchase->>'creatorBudgetMicros')::numeric+(p_purchase->>'serviceFeeMicros')::numeric
    or (p_purchase->>'creatorBudgetMicros')::numeric not between 1 and 9007199254740991
    or (p_purchase->>'serviceFeeMicros')::numeric not between 4 and 9007199254740991
    or mod((p_purchase->>'serviceFeeMicros')::numeric,4)!=0 or mod((p_purchase->>'creatorBudgetMicros')::numeric,1)!=0
    or (p_purchase->>'totalMicros')::numeric not between 1 and 9007199254740991
    or (p_purchase->>'expiresAt')::timestamptz-(p_purchase->>'createdAt')::timestamptz != interval '30 days'
    or coalesce(length(p_purchase->>'transaction'),0) not between 1 and 512 then raise exception 'Invalid Monthly purchase'; end if;
  perform public.claim_research_purchase(jsonb_build_object('network','eip155:5042002','asset','0x3600000000000000000000000000000000000000',
    'payer',lower(p_purchase->>'payer'),'payee',lower(p_purchase->>'payee'),'authorization_id',lower(p_purchase->>'authorizationId'),
    'product','monthly','purchase_id',p_purchase->>'id','request_hash',p_purchase->>'quoteId','amount_micros',p_purchase->'totalMicros'));
  insert into public.research_monthly(id,payer,data) values(p_purchase->>'id',lower(p_purchase->>'payer'),p_purchase) on conflict do nothing;
  get diagnostics inserted=row_count;
  select data into strict original from public.research_monthly where id=p_purchase->>'id' for update;
  if (original-'payer'-'payee'-'authorizationId') is distinct from (p_purchase-'payer'-'payee'-'authorizationId')
    or lower(original->>'payer') is distinct from lower(p_purchase->>'payer') or lower(original->>'payee') is distinct from lower(p_purchase->>'payee')
    or lower(original->>'authorizationId') is distinct from lower(p_purchase->>'authorizationId') then raise exception 'Monthly purchase replay conflict'; end if;
  return jsonb_build_object('created',inserted=1,'purchase',original);
end $$;

create or replace function public.get_research_monthly(p_id text) returns jsonb
language sql security definer set search_path=public as $$
  select jsonb_build_object('purchase',data,'redemptions',coalesce((select jsonb_agg(jsonb_build_object('requestId',request_id,'orderId',order_id,'requestHash',request_hash,'createdAt',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'slot',slot) order by slot)
    from public.research_monthly_redemptions where monthly_id=p_id),'[]'::jsonb)) from public.research_monthly where id=p_id;
$$;

create or replace function public.redeem_research_monthly(p_id text,p_payer text,p_request_id text,p_now timestamptz,p_order jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare purchase jsonb; redemption public.research_monthly_redemptions; original public.a2a_orders; proposed public.a2a_orders;
  used integer; expected_id text; expected_hash text; package_hash text;
begin
  select data into purchase from public.research_monthly where id=p_id for update;
  if purchase is null or lower(p_payer) is distinct from lower(purchase->>'payer') or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception 'Monthly owner/request mismatch'; end if;
  if not purchase ?& array['createdAt','expiresAt','creatorBudgetMicros','serviceFeeMicros','totalMicros','researchPackage']
    or jsonb_typeof(purchase->'createdAt') is distinct from 'string' or jsonb_typeof(purchase->'expiresAt') is distinct from 'string'
    or (purchase->>'expiresAt')::timestamptz-(purchase->>'createdAt')::timestamptz != interval '30 days' then raise exception 'Invalid stored Monthly purchase'; end if;
  proposed:=jsonb_populate_record(null::public.a2a_orders,p_order);
  expected_id:='a2a_'||encode(sha256(convert_to('["keryx-monthly-redemption-v1",'||to_json(p_id)::text||','||to_json(p_request_id)::text||']','UTF8')),'hex');
  package_hash:=encode(sha256(convert_to(public.research_canonical_json(purchase->'researchPackage'),'UTF8')),'hex');
  expected_hash:=encode(sha256(convert_to('{"question":'||coalesce(to_json(proposed.request_data->>'question')::text,'null')||
    ',"creatorBudgetUsdc6":'||(purchase->>'creatorBudgetMicros')||',"serviceFeeUsdc6":'||((purchase->>'serviceFeeMicros')::bigint/4)::text||
    ',"researchMode":'||to_json(purchase->'researchPackage'->>'researchMode')::text||',"researchPackageFingerprint":'||to_json(package_hash)::text||
    ',"model":'||coalesce(to_json(proposed.request_data->>'model')::text,'null')||'}','UTF8')),'hex');
  if proposed.id is distinct from expected_id or proposed.query_id is distinct from expected_id
    or proposed.authorization_id is distinct from (purchase->>'authorizationId')||':monthly:'||p_request_id
    or lower(proposed.payer) is distinct from lower(purchase->>'payer') or lower(proposed.payee) is distinct from lower(purchase->>'payee')
    or proposed.transaction_id is distinct from purchase->>'transaction' or proposed.creator_budget_usdc is distinct from (purchase->>'creatorBudgetMicros')::numeric/1000000
    or proposed.service_fee_usdc is distinct from (purchase->>'serviceFeeMicros')::numeric/4000000 or proposed.amount_usdc is distinct from (purchase->>'totalMicros')::numeric/4000000
    or proposed.package_data is distinct from purchase->'researchPackage' or proposed.research_mode is distinct from purchase->'researchPackage'->>'researchMode'
    or proposed.request_data->>'origin' is distinct from 'a2a' or proposed.request_data->>'monthlyId' is distinct from p_id or jsonb_typeof(proposed.request_data->'question') is distinct from 'string'
    or length(btrim(proposed.request_data->>'question')) not between 1 and 10000
    or (proposed.request_data ? 'model' and (jsonb_typeof(proposed.request_data->'model')!='string' or length(proposed.request_data->>'model')>256))
    or proposed.request_hash is distinct from expected_hash or proposed.status is distinct from 'running'
    or proposed.started_at is not null or proposed.worker_id is not null or proposed.execution_journal_version is distinct from 1
    or proposed.payment_started_at is not null or proposed.result_saving_at is not null or proposed.response_data is not null
    or proposed.error_code is not null or proposed.resolution_data is not null or proposed.created_at is null or proposed.updated_at is distinct from proposed.created_at then raise exception 'Monthly redemption contract mismatch'; end if;
  select * into redemption from public.research_monthly_redemptions where monthly_id=p_id and request_id=p_request_id;
  if found then
    select * into strict original from public.a2a_orders where id=redemption.order_id;
    if original.id is distinct from proposed.id or original.query_id is distinct from proposed.query_id or original.authorization_id is distinct from proposed.authorization_id
      or original.request_hash is distinct from proposed.request_hash or lower(original.payer) is distinct from lower(proposed.payer) or lower(original.payee) is distinct from lower(proposed.payee)
      or original.amount_usdc is distinct from proposed.amount_usdc or original.creator_budget_usdc is distinct from proposed.creator_budget_usdc
      or original.service_fee_usdc is distinct from proposed.service_fee_usdc or original.research_mode is distinct from proposed.research_mode
      or original.package_data is distinct from proposed.package_data or original.transaction_id is distinct from proposed.transaction_id
      or original.request_data is distinct from proposed.request_data or redemption.request_hash is distinct from original.request_hash then raise exception 'Monthly request replay conflict'; end if;
    return jsonb_build_object('created',false,'order',to_jsonb(original));
  end if;
  if p_now is null or p_now<(purchase->>'createdAt')::timestamptz or p_now>=(purchase->>'expiresAt')::timestamptz then raise exception 'Monthly term expired'; end if;
  select count(*) into used from public.research_monthly_redemptions where monthly_id=p_id;
  if used>=4 then raise exception 'Monthly request limit reached'; end if;
  if proposed.created_at is distinct from p_now then raise exception 'Monthly acceptance time mismatch'; end if;
  insert into public.research_monthly_redemptions(monthly_id,request_id,order_id,request_hash,created_at,slot) values(p_id,p_request_id,proposed.id,proposed.request_hash,p_now,used);
  insert into public.a2a_orders select proposed.*;
  return jsonb_build_object('created',true,'order',to_jsonb(proposed));
end $$;

create or replace function public.research_monthly_immutable() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Monthly purchase and redemption records are immutable'; end $$;
create trigger research_monthly_immutable before update or delete on public.research_monthly for each row execute function public.research_monthly_immutable();
create trigger research_monthly_redemptions_immutable before update or delete on public.research_monthly_redemptions for each row execute function public.research_monthly_immutable();
create trigger research_purchase_authorizations_immutable before update or delete on public.research_purchase_authorizations for each row execute function public.research_monthly_immutable();

alter table public.research_purchase_authorizations enable row level security;
alter table public.research_monthly enable row level security;
alter table public.research_monthly_redemptions enable row level security;
revoke all on table public.research_purchase_authorizations,public.research_monthly,public.research_monthly_redemptions from public,anon,authenticated;
grant all on table public.research_purchase_authorizations,public.research_monthly,public.research_monthly_redemptions to service_role;
revoke all on function public.claim_research_purchase(jsonb),public.enforce_a2a_purchase_authorization(),public.research_canonical_json(jsonb),public.create_research_monthly(jsonb),public.get_research_monthly(text),public.redeem_research_monthly(text,text,text,timestamptz,jsonb),public.research_monthly_immutable() from public,anon,authenticated;
grant execute on function public.claim_research_purchase(jsonb),public.create_research_monthly(jsonb),public.get_research_monthly(text),public.redeem_research_monthly(text,text,text,timestamptz,jsonb) to service_role;

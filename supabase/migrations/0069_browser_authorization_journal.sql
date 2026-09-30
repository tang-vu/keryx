-- Staged testnet journal. Applying schema does not enable signing.
alter table public.payment_events add column authorization_phase text
  check (authorization_phase in ('prepared','exposed','signed','submission_attempted','settled','failed','cancelled_unexposed'));
alter table public.payment_events add constraint browser_journal_payment_state check (
  authorization_phase is null or (
    authorization_id is not null and id='x402:'||authorization_id and grant_epoch is not null
    and amount_usdc*1000000=trunc(amount_usdc*1000000) and amount_usdc*1000000 between 1 and 9007199254740991
    and ((authorization_phase in ('prepared','exposed','signed','submission_attempted') and settlement_status='pending' and not settled)
      or (authorization_phase='settled' and settlement_status='settled' and settled)
      or (authorization_phase in ('failed','cancelled_unexposed') and settlement_status='failed' and not settled))
  )
);
alter policy "public read payment_events" on public.payment_events
  using (authorization_phase is null or authorization_phase not in ('prepared','cancelled_unexposed'));
create table public.browser_journal_control(id integer primary key check(id=1),active boolean not null);
insert into public.browser_journal_control values(1,false);
-- No application role can manufacture this capability. Authorized RPCs create/remove it
-- inside their transaction; unlike a custom GUC it cannot survive a successful RPC return.
create table public.browser_journal_writer(transaction_id bigint primary key);
alter table public.browser_journal_writer enable row level security;
revoke all on public.browser_journal_writer from public,anon,authenticated,service_role;
create table public.browser_signer_capacity(signer text primary key,spent_micro bigint not null check(spent_micro>=0));
create table public.browser_retained_grants(grant_epoch text primary key,session_id text not null,signer text not null,spent_micro bigint not null check(spent_micro>=0));
create table public.browser_journal_bindings(nonce text primary key references public.browser_authorization_intents(nonce),
  requirements jsonb not null,payment_metadata jsonb not null,valid_after text,valid_before text,header_hash text);
create unique index browser_journal_payment_nonce on public.payment_events(network,lower(payer),authorization_id)
  where authorization_phase is not null;
create index browser_grants_signer on public.session_grants(lower(sess_addr));
create index browser_signer_confirmed_payments on public.payment_events(lower(payer),lower(authorization_id))
  where settled=true and settlement_status='settled' and grant_epoch is not null and network='eip155:5042002';
alter table public.browser_journal_control enable row level security;
alter table public.browser_signer_capacity enable row level security;
alter table public.browser_retained_grants enable row level security;
alter table public.browser_journal_bindings enable row level security;
revoke all on public.browser_journal_control,public.browser_signer_capacity,public.browser_retained_grants,public.browser_journal_bindings from public,anon,authenticated,service_role;
grant select on public.browser_journal_control,public.browser_signer_capacity,public.browser_retained_grants,public.browser_journal_bindings to service_role;

create function public.browser_journal_write_fence() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if (select active from public.browser_journal_control where id=1)
     and not exists(select 1 from public.browser_journal_writer where transaction_id=txid_current()) then
    raise exception 'browser journal writer required';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger browser_grant_write_fence before insert or update or delete on public.session_grants
  for each row execute function public.browser_journal_write_fence();
create trigger browser_intent_insert_fence before insert on public.browser_authorization_intents
  for each row execute function public.browser_journal_write_fence();

create function public.browser_journal_payment_fence() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if tg_op='DELETE' then
    if old.authorization_phase is not null
       or ((select active from public.browser_journal_control where id=1) and old.grant_epoch is not null) then
      raise exception 'browser journal payment is retained';
    end if;
    return old;
  end if;
  if tg_op<>'DELETE' and new.authorization_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.authorization_id,0));
  end if;
  if tg_op='INSERT' then
    if exists(select 1 from public.browser_journal_bindings where nonce=new.authorization_id)
       and new.id is distinct from ('x402:'||new.authorization_id) then raise exception 'browser journal nonce collision'; end if;
    if (new.authorization_phase is not null or exists(select 1 from public.browser_journal_bindings where nonce=new.authorization_id)
       or ((select active from public.browser_journal_control where id=1) and new.grant_epoch is not null))
       and not exists(select 1 from public.browser_journal_writer where transaction_id=txid_current()) then
      raise exception 'browser journal payment already admitted';
    end if;
    return new;
  end if;
  if old.authorization_phase is not null or new.authorization_phase is not null
     or ((select active from public.browser_journal_control where id=1) and old.grant_epoch is not null) then
    if not exists(select 1 from public.browser_journal_writer where transaction_id=txid_current()) then raise exception 'browser journal writer required'; end if;
    if (new.id,new.authorization_id,new.payer,new.payee,new.amount_usdc,new.network,new.grant_epoch,new.source_id,new.query_id,new.offer_id,new.kind)
       is distinct from (old.id,old.authorization_id,old.payer,old.payee,old.amount_usdc,old.network,old.grant_epoch,old.source_id,old.query_id,old.offer_id,old.kind) then
      raise exception 'browser journal payment tuple is immutable';
    end if;
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.browser_journal_bindings where nonce=new.authorization_id)
     and new.id is distinct from ('x402:'||new.authorization_id) then raise exception 'browser journal nonce collision'; end if;
  return new;
end;
$$;
create trigger browser_payment_write_fence before insert or update or delete on public.payment_events
  for each row execute function public.browser_journal_payment_fence();

create function public.activate_browser_journal() returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_legacy_grant record;
begin
  perform 1 from public.browser_journal_control where id=1 for update;
  if (select active from public.browser_journal_control where id=1) then return; end if;
  lock table public.session_grants in share row exclusive mode;
  lock table public.payment_events in share row exclusive mode;
  if exists(select 1 from public.session_grants where coalesce(sess_addr,'') !~* '^0x[0-9a-f]{40}$'
    or cap*1000000<>trunc(cap*1000000) or spent*1000000<>trunc(spent*1000000)
    or cap<0 or spent<0 or spent*1000000>9007199254740991 or cap*1000000>9007199254740991) then
    raise exception 'Legacy grant requires exact capacity audit';
  end if;
  if exists(select 1 from public.payment_events where grant_epoch is not null and settlement_status in ('pending','settled')
    and (network is distinct from 'eip155:5042002' or coalesce(payer,'') !~* '^0x[0-9a-f]{40}$'
      or amount_usdc<=0 or amount_usdc*1000000<>trunc(amount_usdc*1000000) or amount_usdc*1000000>9007199254740991)) then
    raise exception 'Legacy payment requires exact capacity audit';
  end if;
  if exists(select grant_epoch from (
    select grant_epoch,lower(sess_addr) signer from public.session_grants
    union all select grant_epoch,lower(payer) from public.payment_events where grant_epoch is not null and settlement_status in ('pending','settled')
  ) x group by grant_epoch having count(distinct signer)>1) then raise exception 'Legacy epoch signer mismatch'; end if;
  for v_legacy_grant in select * from public.session_grants loop
    insert into public.browser_retained_grants values(v_legacy_grant.grant_epoch,v_legacy_grant.session_id,
      lower(v_legacy_grant.sess_addr),(v_legacy_grant.spent*1000000)::bigint);
  end loop;
  -- Existing grant spend already includes its payments: use the larger amount per
  -- epoch, then sum epochs. Missing nonce history is never manufactured here.
  insert into public.browser_retained_grants(grant_epoch,session_id,signer,spent_micro)
    select grant_epoch,'legacy:'||grant_epoch,lower(payer),sum(amount_usdc*1000000)::bigint
    from public.payment_events where grant_epoch is not null and settlement_status in ('pending','settled')
    group by grant_epoch,lower(payer)
    on conflict(grant_epoch) do update set spent_micro=greatest(browser_retained_grants.spent_micro,excluded.spent_micro);
  if exists(select signer from public.browser_retained_grants group by signer having sum(spent_micro)>9007199254740991) then
    raise exception 'Legacy signer requires exact capacity audit';
  end if;
  insert into public.browser_signer_capacity select signer,sum(spent_micro)::bigint from public.browser_retained_grants group by signer;
  update public.session_grants g set spent=c.spent_micro::numeric/1000000
    from public.browser_signer_capacity c where lower(g.sess_addr)=c.signer;
  update public.browser_journal_control set active=true where id=1;
end;
$$;

create function public.upsert_browser_journal_grant(p_grant jsonb) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_signer text:=lower(p_grant->>'sess_addr'); v_spent bigint; v_cap numeric:=(p_grant->>'cap')::numeric;
begin
  if not (select active from public.browser_journal_control where id=1) then raise exception 'browser journal inactive'; end if;
  if coalesce(v_signer ~ '^0x[0-9a-f]{40}$',false) is distinct from true
     or v_cap is null or v_cap='NaN'::numeric or v_cap<0 or v_cap*1000000<>trunc(v_cap*1000000) or v_cap*1000000>9007199254740991
     or coalesce(length(p_grant->>'session_id'),0)=0 or coalesce(length(p_grant->>'grant_epoch'),0)=0 then raise exception 'Invalid grant capacity'; end if;
  insert into public.browser_signer_capacity values(v_signer,0) on conflict do nothing;
  select spent_micro into v_spent from public.browser_signer_capacity where signer=v_signer for update;
  if v_spent>v_cap*1000000 then raise exception 'Session recovery cannot reset retained authorization capacity'; end if;
  if exists(select 1 from public.browser_retained_grants where grant_epoch=p_grant->>'grant_epoch') then raise exception 'Grant epoch already retained'; end if;
  insert into public.browser_journal_writer values(txid_current());
  insert into public.browser_retained_grants values(p_grant->>'grant_epoch',p_grant->>'session_id',v_signer,0);
  insert into public.session_grants(session_id,sess_addr,owner_addr,cap,spent,expiry,tx_hash,grant_epoch)
    values(p_grant->>'session_id',v_signer,p_grant->>'owner_addr',v_cap,v_spent::numeric/1000000,(p_grant->>'expiry')::bigint,p_grant->>'tx_hash',p_grant->>'grant_epoch')
    on conflict(session_id) do update set sess_addr=excluded.sess_addr,owner_addr=excluded.owner_addr,cap=excluded.cap,
      spent=excluded.spent,expiry=excluded.expiry,tx_hash=excluded.tx_hash,grant_epoch=excluded.grant_epoch;
  delete from public.browser_journal_writer where transaction_id=txid_current();
end;
$$;

create function public.disable_browser_journal_grant(p_session_id text) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if not (select active from public.browser_journal_control where id=1) then raise exception 'browser journal inactive'; end if;
  insert into public.browser_journal_writer values(txid_current());
  update public.session_grants set expiry=0 where session_id=p_session_id;
  delete from public.browser_journal_writer where transaction_id=txid_current();
end;
$$;

create function public.admit_browser_journal(p_intent jsonb,p_requirements jsonb,p_payment jsonb) returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_amount bigint; v_spent bigint; v_cap numeric; g public.session_grants%rowtype;
begin
  if not (select active from public.browser_journal_control where id=1) then return 'inactive'; end if;
  if coalesce(p_intent->>'amount_micro_usdc','') !~ '^[0-9]+$'
     or coalesce(p_intent->>'nonce','') !~ '^0x[0-9a-f]{64}$'
     or p_intent->>'network' is distinct from 'eip155:5042002'
     or lower(p_intent->>'token') is distinct from '0x3600000000000000000000000000000000000000'
     or lower(p_intent->>'gateway_contract') is distinct from '0x0077777d7eba4688bdef3e311b846f25870a19b9'
     or coalesce(p_intent->>'kind','') not in ('fetch','citation') then raise exception 'Invalid browser authorization intent'; end if;
  v_amount:=(p_intent->>'amount_micro_usdc')::bigint;
  if v_amount<1 or v_amount>9007199254740991 or p_requirements->>'amount' is distinct from v_amount::text
    or p_requirements->>'scheme' is distinct from 'exact' or p_requirements->>'network' is distinct from 'eip155:5042002'
    or lower(p_requirements->>'asset') is distinct from lower(p_intent->>'token')
    or lower(p_requirements->>'payTo') is distinct from lower(p_intent->>'payee')
    or p_requirements#>>'{extra,name}' is distinct from 'GatewayWalletBatched'
    or p_requirements#>>'{extra,version}' is distinct from '1'
    or lower(p_requirements#>>'{extra,verifyingContract}') is distinct from lower(p_intent->>'gateway_contract')
    or coalesce(p_requirements->>'maxTimeoutSeconds','') !~ '^[0-9]+$'
    or (p_requirements->>'maxTimeoutSeconds')::numeric not between 604900 and 691200
    or lower(p_payment->>'payer') is distinct from lower(p_intent->>'signer') or lower(p_payment->>'payee') is distinct from lower(p_intent->>'payee')
    or p_payment->>'network' is distinct from p_intent->>'network' or p_payment->>'queryId' is distinct from p_intent->>'query_id'
    or p_payment->>'sourceId' is distinct from p_intent->>'source_id' or p_payment->>'kind' is distinct from p_intent->>'kind'
    or p_payment->>'grantEpoch' is distinct from p_intent->>'grant_epoch'
    or (p_payment->>'amountUsdc')::numeric*1000000 is distinct from v_amount::numeric
    or (p_payment->>'offerId') is distinct from (p_intent->>'offer_id') then raise exception 'Browser journal economic tuple differs from challenge'; end if;
  -- Always lock signer capacity before grant rows, including replacement/recovery writers.
  select spent_micro into v_spent from public.browser_signer_capacity where signer=lower(p_intent->>'signer') for update;
  if not found then return 'grant_or_cap_refused'; end if;
  select * into g from public.session_grants where session_id=p_intent->>'session_id' and grant_epoch=p_intent->>'grant_epoch'
    and lower(sess_addr)=lower(p_intent->>'signer') and expiry>(extract(epoch from clock_timestamp())*1000)::bigint for update;
  if not found or g.cap*1000000<>trunc(g.cap*1000000) or v_spent+v_amount>g.cap*1000000 then return 'grant_or_cap_refused'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_intent->>'nonce',0));
  if exists(select 1 from public.payment_events where authorization_id=p_intent->>'nonce') then raise exception 'Browser journal nonce collision'; end if;
  insert into public.browser_journal_writer values(txid_current());
  -- Reuse actual D268 admission validation and immutable insert inside the same transaction.
  update public.session_grants set spent=v_spent::numeric/1000000 where session_id=g.session_id;
  if public.admit_browser_authorization(p_intent)<>'admitted' then raise exception 'Journal grant fence changed'; end if;
  insert into public.browser_journal_bindings(nonce,requirements,payment_metadata)
    values(p_intent->>'nonce',jsonb_build_object('scheme','exact','network',p_intent->>'network','asset',p_intent->>'token',
      'payTo',p_intent->>'payee','amount',v_amount::text,'maxTimeoutSeconds',(p_requirements->>'maxTimeoutSeconds')::integer,
      'extra',jsonb_build_object('name','GatewayWalletBatched','version','1','verifyingContract',p_intent->>'gateway_contract')),
      (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_payment)
        where key=any(array['id','createdAt','kind','queryId','sourceId','sourceName','payer','payee','amountUsdc','weight','rationale',
        'network','settled','settlementStatus','authorizationId','grantEpoch','origin','itemId','itemTitle','itemUrl','contentVersion',
        'itemPublishedAt','offerId','listPriceUsdc'])));
  insert into public.payment_events(id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,weight,rationale,network,settled,settlement_status,authorization_id,grant_epoch,origin,item_id,item_title,item_url,content_version,item_published_at,offer_id,list_price_usdc,authorization_phase)
    values('x402:'||(p_intent->>'nonce'),(p_intent->>'created_at')::timestamptz,p_intent->>'kind',p_intent->>'query_id',p_intent->>'source_id',p_payment->>'sourceName',p_intent->>'signer',p_intent->>'payee',v_amount::numeric/1000000,
      (p_payment->>'weight')::numeric,p_payment->>'rationale',p_intent->>'network',false,'pending',p_intent->>'nonce',p_intent->>'grant_epoch',coalesce(p_payment->>'origin','web'),p_payment->>'itemId',p_payment->>'itemTitle',p_payment->>'itemUrl',p_payment->>'contentVersion',(p_payment->>'itemPublishedAt')::timestamptz,p_intent->>'offer_id',(p_payment->>'listPriceUsdc')::numeric,'prepared');
  update public.browser_signer_capacity set spent_micro=spent_micro+v_amount where signer=lower(g.sess_addr);
  update public.browser_retained_grants set spent_micro=spent_micro+v_amount where grant_epoch=g.grant_epoch;
  update public.session_grants set spent=(v_spent+v_amount)::numeric/1000000 where lower(sess_addr)=lower(g.sess_addr);
  delete from public.browser_journal_writer where transaction_id=txid_current();
  return 'admitted';
end;
$$;

create function public.transition_browser_journal(p_session_id text,p_request_id text,p_from text,p_to text) returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare n integer;
begin
  if coalesce((p_from,p_to) in (('prepared','exposed'),('signed','submission_attempted')),false) is distinct from true then raise exception 'Invalid journal transition'; end if;
  insert into public.browser_journal_writer values(txid_current());
  update public.payment_events p set authorization_phase=p_to from public.browser_authorization_intents i,public.browser_journal_bindings b
    where i.session_id=p_session_id and i.request_id=p_request_id and b.nonce=i.nonce and p.id='x402:'||i.nonce
      and p.authorization_phase=p_from and p.settlement_status='pending';
  get diagnostics n=row_count;
  delete from public.browser_journal_writer where transaction_id=txid_current();
  return n=1;
end;
$$;

create function public.sign_browser_journal(p_session_id text,p_request_id text,p_metadata jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_nonce text; v_phase text; b public.browser_journal_bindings%rowtype;
begin
  if coalesce(p_metadata->>'headerHash','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_metadata->>'validAfter','') !~ '^(0|[1-9][0-9]*)$'
     or coalesce(p_metadata->>'validBefore','') !~ '^(0|[1-9][0-9]*)$'
     or (p_metadata->>'validAfter')::numeric>(p_metadata->>'validBefore')::numeric
     or (p_metadata->>'validBefore')::numeric>8640000000000 then raise exception 'Invalid browser signed metadata'; end if;
  select i.nonce,p.authorization_phase into v_nonce,v_phase from public.browser_authorization_intents i join public.payment_events p on p.id='x402:'||i.nonce
    where i.session_id=p_session_id and i.request_id=p_request_id for update of p;
  if not found or coalesce(v_phase,'') not in ('exposed','signed','submission_attempted','settled','failed') then return false; end if;
  select * into b from public.browser_journal_bindings where nonce=v_nonce for update;
  if b.header_hash is not null then return (b.header_hash,b.valid_after,b.valid_before) is not distinct from (p_metadata->>'headerHash',p_metadata->>'validAfter',p_metadata->>'validBefore'); end if;
  if v_phase<>'exposed' then return false; end if;
  insert into public.browser_journal_writer values(txid_current());
  update public.browser_journal_bindings set valid_after=p_metadata->>'validAfter',valid_before=p_metadata->>'validBefore',header_hash=p_metadata->>'headerHash' where nonce=v_nonce;
  update public.payment_events set authorization_phase='signed',authorization_expires_at=to_timestamp((p_metadata->>'validBefore')::double precision) where id='x402:'||v_nonce;
  delete from public.browser_journal_writer where transaction_id=txid_current();
  return true;
end;
$$;

create function public.release_browser_journal_capacity(p_epoch text,p_signer text,p_amount bigint) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare n integer; v_spent bigint;
begin
  update public.browser_retained_grants set spent_micro=spent_micro-p_amount where grant_epoch=p_epoch and signer=lower(p_signer) and spent_micro>=p_amount;
  get diagnostics n=row_count; if n<>1 then raise exception 'Retained grant capacity mismatch'; end if;
  update public.browser_signer_capacity set spent_micro=spent_micro-p_amount where signer=lower(p_signer) and spent_micro>=p_amount returning spent_micro into v_spent;
  if not found then raise exception 'Signer capacity mismatch'; end if;
  update public.session_grants set spent=v_spent::numeric/1000000 where lower(sess_addr)=lower(p_signer);
end;
$$;

create function public.terminal_browser_journal(p_id text,p_nonce text,p_transfer_id text,p_mode text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p public.payment_events%rowtype; v_signer text;
begin
  if coalesce(p_mode,'') not in ('settled','failed','cancelled_unexposed') then raise exception 'Invalid journal terminal mode'; end if;
  if p_mode<>'cancelled_unexposed' and coalesce(length(p_transfer_id),0)=0 then raise exception 'Circle terminal proof identifier required'; end if;
  -- Match lock order used by admission/recovery before touching payment and grant state.
  select payer into v_signer from public.payment_events where id=p_id and authorization_id=p_nonce;
  perform 1 from public.browser_signer_capacity where signer=lower(v_signer) for update;
  select * into p from public.payment_events where id=p_id and authorization_id=p_nonce for update;
  if not found or p.settlement_status is distinct from 'pending' then return jsonb_build_object('resolved',false,'reservation_released',false); end if;
  if p.authorization_phase is null and p.grant_epoch is not null and not (select active from public.browser_journal_control where id=1) then
    raise exception 'browser journal inactive';
  end if;
  if p_mode='cancelled_unexposed' then
    if p.authorization_phase is distinct from 'prepared' then return jsonb_build_object('resolved',false,'reservation_released',false); end if;
  elsif p.authorization_phase is not null and p.authorization_phase not in ('exposed','signed','submission_attempted') then
    return jsonb_build_object('resolved',false,'reservation_released',false);
  end if;
  insert into public.browser_journal_writer values(txid_current());
  update public.payment_events set settlement_status=case when p_mode='settled' then 'settled' else 'failed' end,
    settled=(p_mode='settled'),tx_hash=p_transfer_id,authorization_phase=case when p.authorization_phase is null then null else p_mode end where id=p_id;
  if p_mode<>'settled' and p.grant_epoch is not null then
    perform public.release_browser_journal_capacity(p.grant_epoch,p.payer,(p.amount_usdc*1000000)::bigint);
  end if;
  delete from public.browser_journal_writer where transaction_id=txid_current();
  return jsonb_build_object('resolved',true,'reservation_released',p_mode<>'settled' and p.grant_epoch is not null);
end;
$$;

-- One snapshot keeps economic and lifecycle authority consistent for recovery readers.
create function public.get_browser_journal(p_session_id text,p_request_id text) returns jsonb
language sql security definer set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('intent',to_jsonb(i),'binding',to_jsonb(b),'payment',to_jsonb(p))
  from public.browser_authorization_intents i join public.browser_journal_bindings b using(nonce)
  join public.payment_events p on p.id='x402:'||i.nonce
  where i.session_id=p_session_id and i.request_id=p_request_id;
$$;

create function public.browser_signer_confirmed_spend_micro(p_signer text) returns bigint
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_total numeric;
begin
  if coalesce(p_signer,'') !~* '^0x[0-9a-f]{40}$' then raise exception 'Invalid browser signer'; end if;
  if exists(select 1 from public.payment_events where settled=true and settlement_status='settled'
    and grant_epoch is not null and network='eip155:5042002' and lower(payer)=lower(p_signer)
    and coalesce(trim(tx_hash),'')<>'' and authorization_id ~* '^0x[0-9a-f]{64}$'
    and (amount_usdc<=0 or amount_usdc*1000000<>trunc(amount_usdc*1000000) or coalesce(payee,'') !~* '^0x[0-9a-f]{40}$')) then
    raise exception 'Confirmed spend requires exact capacity audit';
  end if;
  if exists(select lower(authorization_id) from public.payment_events
    where settled=true and settlement_status='settled' and grant_epoch is not null
      and network='eip155:5042002' and lower(payer)=lower(p_signer)
      and coalesce(trim(tx_hash),'')<>'' and authorization_id ~* '^0x[0-9a-f]{64}$'
    group by lower(authorization_id)
    having count(distinct (lower(payee),network,amount_usdc,grant_epoch,source_id,query_id,kind,offer_id))>1) then
    raise exception 'Conflicting confirmed authorization identity';
  end if;
  select coalesce(sum(amount_micro),0) into v_total from (
    select lower(authorization_id),max(amount_usdc*1000000) amount_micro from public.payment_events
    where settled=true and settlement_status='settled' and grant_epoch is not null
      and network='eip155:5042002' and lower(payer)=lower(p_signer)
      and coalesce(trim(tx_hash),'')<>'' and authorization_id ~* '^0x[0-9a-f]{64}$'
    group by lower(authorization_id)
  ) deduplicated;
  if v_total>9007199254740991 then raise exception 'Confirmed spend requires exact capacity audit'; end if;
  return v_total::bigint;
end;
$$;

-- Definer entry points have a fixed catalog-only search path and explicit public
-- relation names. Only the service role can execute them; release is internal only.
do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('browser_journal_write_fence','browser_journal_payment_fence','activate_browser_journal','upsert_browser_journal_grant','disable_browser_journal_grant','admit_browser_journal','transition_browser_journal','sign_browser_journal','release_browser_journal_capacity','terminal_browser_journal','get_browser_journal','browser_signer_confirmed_spend_micro') loop
    execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
    if f.signature::text not like '%release_browser_journal_capacity%' then
      execute 'grant execute on function '||f.signature||' to service_role';
    else
      execute 'revoke all on function '||f.signature||' from service_role';
    end if;
  end loop;
end $$;

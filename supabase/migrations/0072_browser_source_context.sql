-- Dormant source-bound originals share the existing lifetime journal/counters.
-- Owner policy remains durable-v2. Only fixture owners raise the retained floor.
alter table public.browser_signing_v2_control add column min_original_version integer not null default 2 check(min_original_version in (2,3));
alter table public.browser_signing_v2_barrier add column min_original_version integer not null default 2 check(min_original_version in (2,3));
create table public.browser_signing_v3_writer(transaction_id bigint primary key);
alter table public.browser_signing_v3_writer enable row level security;
revoke all on public.browser_signing_v3_writer from public,anon,authenticated,service_role;
-- Writers hold the retained floor against an activation update until commit.
-- FOR SHARE also rejects a stale repeatable-read snapshot after a floor change.
create function public.browser_signing_original_floor_for_write() returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare minimum integer; control_minimum integer;
begin
 -- The barrier starts empty. Lock the always-present control first so a stale
 -- snapshot predating the first barrier INSERT cannot fall back to floor2.
 select min_original_version into control_minimum from public.browser_signing_v2_control where id=1 for share;
 if not found then raise exception 'browser signing control missing'; end if;
 select min_original_version into minimum from public.browser_signing_v2_barrier where id=1 for share;
 return greatest(control_minimum,coalesce(minimum,2));
end $$;
revoke all on function public.browser_signing_original_floor_for_write() from public,anon,authenticated,service_role;

create or replace function public.browser_signing_retention_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'browser signing history is retained'; end if;
 if tg_table_name='browser_signing_queries' then
  if (to_jsonb(new)-'spent_micro') is distinct from (to_jsonb(old)-'spent_micro') or new.spent_micro<old.spent_micro then raise exception 'browser query consumption is monotonic'; end if;
 elsif tg_table_name='browser_signing_namespaces' then
  if (new.namespace,new.owner,new.signer,new.service,new.network) is distinct from (old.namespace,old.owner,old.signer,old.service,old.network)
   or new.allocated_micro<old.allocated_micro or new.jobs<old.jobs then raise exception 'browser namespace history is monotonic'; end if;
 elsif tg_table_name='browser_signing_v2_barrier' then
  if new.id<>old.id or new.min_original_version<old.min_original_version then raise exception 'browser signing minimum is retained'; end if;
 else raise exception 'browser signing original is immutable'; end if;
 return new;
end $$;
create or replace function public.browser_signing_control_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare retained integer;
begin
 if tg_op='DELETE' then raise exception 'browser signing activation is retained'; end if;
 select min_original_version into retained from public.browser_signing_v2_barrier where id=1;
 if new.id<>1 or new.min_original_version<coalesce(retained,2)
  or (tg_op='UPDATE' and (new.min_original_version<old.min_original_version or (old.active and not new.active))) then raise exception 'browser signing minimum is retained'; end if;
 if new.min_original_version=3 and (new.active is distinct from true or (select active from public.browser_journal_control where id=1) is distinct from true) then raise exception 'browser signing base journal inactive'; end if;
 if new.active then
  insert into public.browser_signing_v2_barrier values(1,new.min_original_version)
   on conflict(id) do update set min_original_version=greatest(public.browser_signing_v2_barrier.min_original_version,excluded.min_original_version);
 end if;
 return new;
end $$;
create trigger browser_signing_control_insert_guard before insert on public.browser_signing_v2_control for each row execute function public.browser_signing_control_guard();
create or replace function public.browser_signing_fresh_gate() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if exists(select 1 from public.browser_signing_v2_barrier where id=1)
  and not exists(select 1 from public.browser_signing_v2_writer where transaction_id=txid_current()) then raise exception 'browser signing v2 original required'; end if;
 if public.browser_signing_original_floor_for_write()=3
  and not exists(select 1 from public.browser_signing_v3_writer where transaction_id=txid_current()) then raise exception 'browser signing v3 source original required'; end if;
 return new;
end $$;
create function public.browser_signing_source_original_gate() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if (new.original->>'protocol'='durable-v3' or public.browser_signing_original_floor_for_write()=3)
  and (new.original->>'protocol' is distinct from 'durable-v3' or not exists(select 1 from public.browser_signing_v3_writer where transaction_id=txid_current())) then raise exception 'browser signing v3 source original required'; end if;
 return new;
end $$;
create trigger browser_signing_source_original_gate before insert on public.browser_signing_originals for each row execute function public.browser_signing_source_original_gate();
create function public.browser_signing_source_exposure_gate() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 -- A previously exposed v2 original retains its exact historical callback.
 if old.authorization_phase='prepared' and new.authorization_phase in ('exposed','signed','submission_attempted')
  and exists(select 1 from public.browser_signing_originals where nonce=old.authorization_id and original->>'protocol'='durable-v3')
  and (public.browser_signing_original_floor_for_write()<>3 or (select active from public.browser_journal_control where id=1) is distinct from true
    or (select active from public.browser_signing_v2_control where id=1) is distinct from true) then raise exception 'browser source exposure inactive'; end if;
 if old.authorization_phase='prepared' and new.authorization_phase in ('exposed','signed','submission_attempted','settled','failed')
  and public.browser_signing_original_floor_for_write()=3
  and not exists(select 1 from public.browser_signing_originals where nonce=old.authorization_id and original->>'protocol'='durable-v3') then raise exception 'browser signing v3 source exposure required'; end if;
 return new;
end $$;
create trigger browser_signing_source_exposure_gate before update on public.payment_events for each row execute function public.browser_signing_source_exposure_gate();

-- Replaying a retained request is observation, not new source authority. The
-- immutable input comparison and full projection share one STABLE statement.
create function public.browser_signing_replay_source_original(p_input jsonb) returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce((select case when (o.input-'sourceContext') is distinct from p_input or o.original->>'protocol' is distinct from 'durable-v3'
 then jsonb_build_object('status','refused') else jsonb_build_object('status','admitted','snapshot',
 jsonb_build_object('original',o.original,'journal',o.journal||jsonb_strip_nulls(jsonb_build_object('phase',p.authorization_phase,
  'payment',(o.journal->'payment')||jsonb_build_object('authorizationPhase',p.authorization_phase,'settled',p.settled,'settlementStatus',p.settlement_status,'txHash',p.tx_hash),
  'signedValidAfter',b.valid_after,'signedValidBefore',b.valid_before,'signedHeaderHash',b.header_hash)),
 'currentGrant',case when g.session_id is null then null else jsonb_build_object('sessionId',g.session_id,'sessAddr',g.sess_addr,'ownerAddr',g.owner_addr,'cap',g.cap,'spent',g.spent,'expiry',g.expiry,'txHash',g.tx_hash,'grantEpoch',g.grant_epoch) end,
 'policy',jsonb_build_object('policy',pol.verified->'policy','signature',pol.verified->>'signature'),
 'namespace',jsonb_build_object('namespace',n.namespace,'owner',n.owner,'signer',n.signer,'service',n.service,'network',n.network,'ceilingMicros',n.ceiling_micro::text,'jobLimit',n.job_limit,'allocatedMicros',n.allocated_micro::text,'jobs',n.jobs,'ceilingProof',n.ceiling_proof),
 'query',jsonb_build_object('queryId',q.query_id,'namespace',q.namespace,'ceilingMicros',q.ceiling_micro::text,'spentMicros',q.spent_micro::text,'proofDigest',pol.verified->>'proofDigest'),
 'signerSpentMicros',c.spent_micro::text,'retainedEpochSpentMicros',r.spent_micro::text,'active',
  ((select active from public.browser_signing_v2_control where id=1) is true and (select active from public.browser_journal_control where id=1) is true))) end
 from public.browser_signing_originals o join public.browser_signing_namespaces n on n.namespace=o.namespace
 join public.browser_signing_queries q on (q.namespace,q.query_id)=(o.namespace,o.query_id)
 join public.browser_signing_policies pol on (pol.namespace,pol.policy_id)=(q.namespace,q.policy_id)
 join public.payment_events p on p.id='x402:'||o.nonce join public.browser_journal_bindings b on b.nonce=o.nonce
 join public.browser_signer_capacity c on c.signer=n.signer join public.browser_retained_grants r on r.grant_epoch=o.original->>'grantEpoch' and r.signer=n.signer
 left join public.session_grants g on g.session_id=o.session_id
 where o.session_id=p_input#>>'{journal,sessionId}' and o.request_id=p_input#>>'{journal,requestId}'),
 jsonb_build_object('status',case when (select active from public.browser_journal_control where id=1) is true
  and (select active from public.browser_signing_v2_control where id=1) is true
  and (select min_original_version from public.browser_signing_v2_barrier where id=1)=3 then 'missing' else 'inactive' end));
$$;

-- Keep the old implementation private. Exact v2 replay remains historical;
-- an old binary cannot allocate another original after the retained floor rises.
alter function public.browser_signing_admit_original(jsonb,jsonb,jsonb) rename to browser_signing_v2_admission_internal;
revoke all on function public.browser_signing_v2_admission_internal(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.browser_signing_admit_original(p_input jsonb,p_journal jsonb,p_original jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if public.browser_signing_original_floor_for_write()=3
  and not exists(select 1 from public.browser_signing_originals where session_id=p_input#>>'{journal,sessionId}' and request_id=p_input#>>'{journal,requestId}') then return jsonb_build_object('status','refused'); end if;
 return public.browser_signing_v2_admission_internal(p_input,p_journal,p_original);
end $$;
revoke all on function public.browser_signing_source_original_gate() from public,anon,authenticated,service_role;
revoke all on function public.browser_signing_source_exposure_gate() from public,anon,authenticated,service_role;
revoke all on function public.browser_signing_replay_source_original(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.browser_signing_admit_original(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.browser_signing_replay_source_original(jsonb),public.browser_signing_admit_original(jsonb,jsonb,jsonb) to service_role;

-- Canonical JSON is used only on this bounded, integer-only signed context.
create function public.browser_signing_source_canonical(p_value jsonb) returns text
language sql immutable strict set search_path=pg_catalog,pg_temp as $$
 select case jsonb_typeof(p_value)
 when 'object' then '{'||coalesce((select string_agg(to_jsonb(key)::text||':'||public.browser_signing_source_canonical(value),',' order by key collate "C") from jsonb_each(p_value)),'')||'}'
 when 'array' then '['||coalesce((select string_agg(public.browser_signing_source_canonical(value),',' order by ordinal) from jsonb_array_elements(p_value) with ordinality a(value,ordinal)),'')||']'
 else p_value::text end;
$$;
create function public.browser_signing_source_urlencode(p_value text,p_component boolean) returns text
language plpgsql immutable strict set search_path=pg_catalog,pg_temp as $$
declare bytes bytea:=convert_to(p_value,'UTF8'); i integer; b integer; result text:=''; ch text;
begin
 for i in 0..length(bytes)-1 loop
  b:=get_byte(bytes,i); ch:=chr(b);
  if (b between 48 and 57) or (b between 65 and 90) or (b between 97 and 122)
   or (p_component and ch in ('-','_','.','!','~','*','''','(',')')) or (not p_component and ch in ('*','-','.','_')) then result:=result||ch;
  elsif not p_component and b=32 then result:=result||'+';
  else result:=result||'%'||substr('0123456789ABCDEF',b/16+1,1)||substr('0123456789ABCDEF',b%16+1,1); end if;
 end loop;
 return result;
end $$;
create function public.browser_signing_source_context_check(p_input jsonb,p_journal jsonb,p_original jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare c jsonb:=p_input->'sourceContext'; a jsonb:=p_input->'journal'; r jsonb:=c->'registry'; price jsonb:=c->'price';
 bare jsonb:=p_original-array['sourceContext','sourceContextDigest']; canonical text; path text;
begin
 canonical:=public.browser_signing_source_canonical(c);
 if p_input->>'protocol' is distinct from 'durable-v3' or a->>'kind' is distinct from 'fetch'
  or jsonb_typeof(c) is distinct from 'object' or octet_length(convert_to(canonical,'UTF8'))>6144
  or (select count(*) from jsonb_object_keys(c))<>8
  or (select count(*) from jsonb_object_keys(c->'source'))<>3 or (select count(*) from jsonb_object_keys(c->'item'))<>2
  or (select count(*) from jsonb_object_keys(c->'endpoint'))<>2 or (select count(*) from jsonb_object_keys(r))<>9
  or c->>'version' is distinct from 'source-context-v1' or c->>'service' is distinct from 'https://keryx.cc' or c->>'kind' is distinct from 'fetch'
  or c#>>'{source,sourceId}' is distinct from a->>'sourceId' or c#>>'{source,sourceId}' is distinct from p_input#>>'{source,sourceId}'
  or c#>>'{item,itemId}' is distinct from p_input#>>'{source,itemId}' or c#>>'{item,itemId}' is distinct from p_journal#>>'{payment,itemId}'
  or c#>>'{item,contentVersion}' is distinct from p_input#>>'{source,contentVersion}' or c#>>'{item,contentVersion}' is distinct from p_journal#>>'{payment,contentVersion}'
  or coalesce(c#>>'{source,sourceId}','') !~ '^[A-Za-z0-9:_-]{1,128}$' or coalesce(c#>>'{item,itemId}','') !~ '^[A-Za-z0-9:_-]{1,128}$'
  or coalesce(c#>>'{item,contentVersion}','') !~ '^[!-~]{1,128}$' or length(c#>>'{source,canonicalUrl}')>2048
  or coalesce(c#>>'{source,canonicalUrl}','') !~ '^https?://' or coalesce(c#>>'{source,registryId}','') !~ '^0x[0-9a-f]{64}$'
  or c#>>'{endpoint,method}' is distinct from 'GET' or coalesce(c#>>'{endpoint,path}','') !~ '^/api/source/' or length(c#>>'{endpoint,path}')>2048
  or r->>'network' is distinct from 'eip155:5042002' or r->'active' is distinct from 'true'::jsonb
  or coalesce(r->>'contract','') !~ '^0x[0-9a-f]{40}$' or coalesce(r->>'creator','') !~ '^0x[0-9a-f]{40}$'
  or coalesce(r->>'payoutWallet','') !~ '^0x[0-9a-f]{40}$' or r->>'payoutWallet' is distinct from lower(a->>'payee')
  or coalesce(r->>'blockHash','') !~ '^0x[0-9a-f]{64}$' or coalesce(r->>'blockNumber','') !~ '^(0|[1-9][0-9]{0,77})$'
  or coalesce(r->>'blockTimestamp','') !~ '^(0|[1-9][0-9]{0,77})$' or coalesce(r->>'listPriceMicros','') !~ '^[1-9][0-9]{0,15}$'
  or coalesce(price->>'amountMicros','') !~ '^[1-9][0-9]{0,15}$' or price->>'amountMicros' is distinct from a->>'amountMicroUsdc'
  or p_original->'sourceContext' is distinct from c or coalesce(p_original->>'sourceContextDigest','') !~ '^0x[0-9a-f]{64}$'
  or p_original->>'sourceContextDigest' is distinct from '0x'||encode(sha256(convert_to(public.browser_signing_source_canonical(jsonb_build_object('original',bare,'sourceContext',c)),'UTF8')),'hex')
  then raise exception 'browser source context refused'; end if;
 if (r->>'blockTimestamp')::numeric>floor(extract(epoch from (p_journal->>'admittedAt')::timestamptz))
  or (r->>'listPriceMicros')::numeric>9007199254740991 or (price->>'amountMicros')::numeric>9007199254740991 then raise exception 'browser source context refused'; end if;
 if price->>'mode'='list' then
  if (select count(*) from jsonb_object_keys(price))<>2 or price->>'amountMicros' is distinct from r->>'listPriceMicros' or p_input#>'{source,offerId}' is distinct from 'null'::jsonb or a->'offerId' is distinct from 'null'::jsonb then raise exception 'browser source list price refused'; end if;
 elsif price->>'mode'='creator-offer' then
  if (select count(*) from jsonb_object_keys(price))<>3 or (select count(*) from jsonb_object_keys(price->'offer'))<>10
   or price#>>'{offer,id}' is distinct from p_input#>>'{source,offerId}' or price#>>'{offer,id}' is distinct from a->>'offerId'
   or price#>>'{offer,sourceId}' is distinct from a->>'sourceId' or price#>>'{offer,itemId}' is distinct from c#>>'{item,itemId}'
   or price#>>'{offer,contentVersion}' is distinct from c#>>'{item,contentVersion}' or price#>>'{offer,priceUsdc6}' is distinct from price->>'amountMicros'
   or price#>>'{offer,signer}' is distinct from r->>'creator' or coalesce(price#>>'{offer,signature}','') !~ '^0x[0-9a-f]{130}$'
   or coalesce(price#>>'{offer,nonce}','') !~ '^0x[0-9a-f]{64}$' or coalesce(price#>>'{offer,id}','') !~ '^0x[0-9a-f]{64}$'
   or coalesce(price#>>'{offer,priceUsdc6}','') !~ '^[1-9][0-9]{0,15}$' or coalesce(price#>>'{offer,expiresAt}','') !~ '^[1-9][0-9]{0,15}$'
   or (price#>>'{offer,expiresAt}')::numeric<=floor(extract(epoch from (p_journal->>'admittedAt')::timestamptz))
   or (price#>>'{offer,expiresAt}')::numeric<=floor(extract(epoch from clock_timestamp()))
   or (price#>>'{offer,expiresAt}')::numeric>9007199254740991 or (price#>>'{offer,createdAt}')::timestamptz is null
   or (price->>'amountMicros')::numeric>(r->>'listPriceMicros')::numeric
   then raise exception 'browser source offer refused'; end if;
 else raise exception 'browser source price mode refused'; end if;
 path:='/api/source/'||(c#>>'{source,sourceId}')||'/item/'||public.browser_signing_source_urlencode(c#>>'{item,itemId}',true)||'?version='||public.browser_signing_source_urlencode(c#>>'{item,contentVersion}',false);
 if price->>'mode'='creator-offer' then path:=path||'&offer='||(price#>>'{offer,id}')||'&listPriceUsdc6='||(r->>'listPriceMicros'); end if;
 if c#>>'{endpoint,path}' is distinct from path then raise exception 'browser source endpoint refused'; end if;
 -- Additionally bound the prepared timestamp to five seconds. Recheck its
 -- age after database lock waits; the separate original-token deadline is authoritative.
 if (p_journal->>'admittedAt')::timestamptz>clock_timestamp()
  or clock_timestamp()-(p_journal->>'admittedAt')::timestamptz>=interval '5 seconds'
  then raise exception 'browser source observation expired'; end if;
end $$;
revoke all on function public.browser_signing_source_canonical(jsonb),public.browser_signing_source_urlencode(text,boolean),public.browser_signing_source_context_check(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.browser_signing_admit_source_original(p_input jsonb,p_journal jsonb,p_original jsonb,p_admission_deadline_ms bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare ns text:=p_input->>'queryNamespace'; qid text:=p_input->>'queryId'; a jsonb:=p_input->'journal';
 q public.browser_signing_queries%rowtype; n public.browser_signing_namespaces%rowtype; old public.browser_signing_originals%rowtype;
 p jsonb; g public.session_grants%rowtype; intent jsonb; amount bigint; seconds bigint; result text;
begin
 if public.browser_signing_original_floor_for_write()<>3 then return jsonb_build_object('status','inactive'); end if;
 perform pg_advisory_xact_lock(hashtextextended(ns,0));
 select * into old from public.browser_signing_originals where session_id=a->>'sessionId' and request_id=a->>'requestId';
 if found then
  if (old.input-'sourceContext') is distinct from (p_input-'sourceContext') or old.original->>'protocol' is distinct from 'durable-v3' then raise exception 'browser signing original conflict'; end if;
  select owner into n.owner from public.browser_signing_namespaces where namespace=old.namespace;
  return jsonb_build_object('status','admitted','snapshot',public.browser_signing_snapshot(n.owner,old.session_id,old.request_id));
 end if;
 if (select active from public.browser_signing_v2_control where id=1) is distinct from true
  or (select active from public.browser_journal_control where id=1) is distinct from true then return jsonb_build_object('status','inactive'); end if;
 perform public.browser_signing_source_context_check(p_input,p_journal,p_original);
 if p_admission_deadline_ms is null or p_admission_deadline_ms<1 or p_admission_deadline_ms>9007199254740991
  or extract(epoch from clock_timestamp())*1000>=p_admission_deadline_ms
  or p_admission_deadline_ms>extract(epoch from clock_timestamp())*1000+5000
  then raise exception 'browser source observation expired'; end if;
 select * into q from public.browser_signing_queries where namespace=ns and query_id=qid for update;
 if not found then return jsonb_build_object('status','refused'); end if;
 select * into n from public.browser_signing_namespaces where namespace=ns for update;
 select verified->'policy' into p from public.browser_signing_policies where namespace=ns and policy_id=q.policy_id;
 select * into g from public.session_grants where session_id=a->>'sessionId' for update;
 if not found then return jsonb_build_object('status','refused'); end if;
 perform public.browser_signing_source_context_check(p_input,p_journal,p_original);
 if p_admission_deadline_ms is null or p_admission_deadline_ms<1 or p_admission_deadline_ms>9007199254740991
  or extract(epoch from clock_timestamp())*1000>=p_admission_deadline_ms
  or p_admission_deadline_ms>extract(epoch from clock_timestamp())*1000+5000
  then raise exception 'browser source observation expired'; end if;
 if q.session_id is distinct from a->>'sessionId' or g.grant_epoch is distinct from p->>'grantEpoch'
  or a->>'grantEpoch' is distinct from p->>'grantEpoch' or lower(g.owner_addr) is distinct from n.owner or lower(g.sess_addr) is distinct from n.signer
  or g.expiry<=(extract(epoch from clock_timestamp())*1000)::bigint or (p->>'expiresAt')::bigint<=(extract(epoch from clock_timestamp())*1000)::bigint then return jsonb_build_object('status','refused'); end if;
 if a->>'queryId' is distinct from qid or p_journal->>'sessionId' is distinct from a->>'sessionId'
  or p_journal->>'requestId' is distinct from a->>'requestId' or p_journal->>'grantEpoch' is distinct from a->>'grantEpoch'
  or lower(a->>'signer') is distinct from n.signer or lower(p_journal->>'signer') is distinct from n.signer
  or p_journal->'requirements' is distinct from a->'requirements' or p_journal->>'phase' is distinct from 'prepared'
  or p_journal#>>'{payment,queryId}' is distinct from qid
  or ((p_journal->'payment')-array['id','createdAt','settled','settlementStatus','authorizationId','authorizationPhase']) is distinct from a->'payment'
  then raise exception 'browser signing journal differs'; end if;
 amount:=(a->>'amountMicroUsdc')::bigint; seconds:=floor(extract(epoch from (p_journal->>'admittedAt')::timestamptz))::bigint;
 if amount<1 or amount>9007199254740991 or seconds<600 then raise exception 'browser signing original refused'; end if;
 if q.spent_micro+amount>q.ceiling_micro then return jsonb_build_object('status','refused'); end if;
 if p_original is distinct from jsonb_build_object('protocol','durable-v3','sourceContext',p_input->'sourceContext','sourceContextDigest',p_original->>'sourceContextDigest','admittedAt',p_journal->>'admittedAt','namespace',ns,'queryId',qid,
  'requestId',a->>'requestId','grantEpoch',a->>'grantEpoch','domain',jsonb_build_object('name','GatewayWalletBatched','version','1','chainId',5042002,'verifyingContract','0x0077777d7eba4688bdef3e311b846f25870a19b9'),
  'authorization',jsonb_build_object('from',n.signer,'to',lower(a->>'payee'),'value',amount::text,'validAfter',(seconds-600)::text,
    'validBefore',(seconds+(a#>>'{requirements,maxTimeoutSeconds}')::bigint)::text,'nonce',p_journal->>'nonce')) then raise exception 'browser signing original differs'; end if;
 intent:=jsonb_build_object('nonce',p_journal->>'nonce','session_id',a->>'sessionId','request_id',a->>'requestId','query_id',qid,'grant_epoch',a->>'grantEpoch',
  'signer',n.signer,'network',a->>'network','token',a->>'token','gateway_contract',a->>'gatewayContract','source_id',a->>'sourceId','offer_id',a->'offerId','kind',a->>'kind','payee',a->>'payee','amount_micro_usdc',amount::text,'created_at',p_journal->>'admittedAt');
 insert into public.browser_signing_v3_writer values(txid_current());
 insert into public.browser_signing_v2_writer values(txid_current());
 result:=public.admit_browser_journal(intent,p_journal->'requirements',p_journal->'payment');
 delete from public.browser_signing_v2_writer where transaction_id=txid_current();
 if result<>'admitted' then delete from public.browser_signing_v3_writer where transaction_id=txid_current(); return jsonb_build_object('status','refused'); end if;
 -- Existing grant/signer capacity locks may have waited. Refuse an offer that
 -- expired while waiting and roll back the complete underlying admission.
 perform public.browser_signing_source_context_check(p_input,p_journal,p_original);
 if p_admission_deadline_ms is null or p_admission_deadline_ms<1 or p_admission_deadline_ms>9007199254740991
  or extract(epoch from clock_timestamp())*1000>=p_admission_deadline_ms
  or p_admission_deadline_ms>extract(epoch from clock_timestamp())*1000+5000
  then raise exception 'browser source observation expired'; end if;
 insert into public.browser_signing_originals values(p_journal->>'nonce',ns,qid,p_input,p_journal,p_original,a->>'sessionId',a->>'requestId');
 update public.browser_signing_queries set spent_micro=spent_micro+amount where namespace=ns and query_id=qid;
 delete from public.browser_signing_v3_writer where transaction_id=txid_current();
 return jsonb_build_object('status','admitted','snapshot',public.browser_signing_snapshot(n.owner,a->>'sessionId',a->>'requestId'));
end $$;

revoke all on function public.browser_signing_admit_source_original(jsonb,jsonb,jsonb,bigint) from public,anon,authenticated,service_role;
grant execute on function public.browser_signing_admit_source_original(jsonb,jsonb,jsonb,bigint) to service_role;

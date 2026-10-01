-- Additive dormant v2 bindings around the existing browser payment journal.
-- Privileged service composition verifies owner ECDSA in TypeScript; SQL does
-- not claim cryptographic recovery or resistance to a malicious service role.
create table public.browser_signing_v2_control(id integer primary key check(id=1),active boolean not null);
insert into public.browser_signing_v2_control values(1,false);
create table public.browser_signing_v2_writer(transaction_id bigint primary key);
create table public.browser_signing_v2_barrier(id integer primary key check(id=1));
create table public.browser_signing_namespaces(
 namespace text primary key check(namespace ~ '^0x[0-9a-f]{64}$'),owner text not null,signer text not null,
 service text not null check(service='https://keryx.cc'),network text not null check(network='eip155:5042002'),
 ceiling_micro bigint not null check(ceiling_micro between 1 and 9007199254740991),job_limit bigint not null check(job_limit between 1 and 9007199254740991),
 ceiling_proof jsonb not null,allocated_micro bigint not null default 0 check(allocated_micro>=0 and allocated_micro<=ceiling_micro),
 jobs bigint not null default 0 check(jobs>=0 and jobs<=job_limit),unique(service,network,owner,signer));
create table public.browser_signing_policies(namespace text not null references public.browser_signing_namespaces,
 policy_id text not null,verified jsonb not null,primary key(namespace,policy_id));
create table public.browser_signing_queries(namespace text not null references public.browser_signing_namespaces,
 query_id text not null,request_nonce text not null,policy_id text not null,session_id text not null,
 ceiling_micro bigint not null check(ceiling_micro between 1 and 9007199254740991),spent_micro bigint not null default 0 check(spent_micro>=0 and spent_micro<=ceiling_micro),
 primary key(namespace,query_id),unique(query_id),unique(namespace,request_nonce),foreign key(namespace,policy_id) references public.browser_signing_policies);
create table public.browser_signing_originals(nonce text primary key references public.browser_authorization_intents,
 namespace text not null,query_id text not null,input jsonb not null,journal jsonb not null,original jsonb not null,
 session_id text not null,request_id text not null,unique(session_id,request_id),foreign key(namespace,query_id) references public.browser_signing_queries);
do $$ declare t text; begin
 foreach t in array array['browser_signing_v2_control','browser_signing_v2_writer','browser_signing_v2_barrier','browser_signing_namespaces','browser_signing_policies','browser_signing_queries','browser_signing_originals'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
create function public.browser_signing_control_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='DELETE' or new.id<>1 or (old.active and not new.active) then raise exception 'browser signing activation is retained'; end if;
 if new.active then insert into public.browser_signing_v2_barrier values(1) on conflict do nothing; end if;
 return new;
end $$;
create trigger browser_signing_control_guard before update or delete on public.browser_signing_v2_control for each row execute function public.browser_signing_control_guard();
create function public.browser_signing_retention_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'browser signing history is retained'; end if;
 if tg_table_name='browser_signing_queries' then
  if (to_jsonb(new)-'spent_micro') is distinct from (to_jsonb(old)-'spent_micro') or new.spent_micro<old.spent_micro then raise exception 'browser query consumption is monotonic'; end if;
 elsif tg_table_name='browser_signing_namespaces' then
  if (new.namespace,new.owner,new.signer,new.service,new.network) is distinct from (old.namespace,old.owner,old.signer,old.service,old.network)
   or new.allocated_micro<old.allocated_micro or new.jobs<old.jobs then raise exception 'browser namespace history is monotonic'; end if;
 else raise exception 'browser signing original is immutable'; end if;
 return new;
end $$;
create trigger browser_signing_query_retention before update or delete on public.browser_signing_queries for each row execute function public.browser_signing_retention_guard();
create trigger browser_signing_namespace_retention before update or delete on public.browser_signing_namespaces for each row execute function public.browser_signing_retention_guard();
create trigger browser_signing_original_retention before update or delete on public.browser_signing_originals for each row execute function public.browser_signing_retention_guard();
create trigger browser_signing_policy_retention before update or delete on public.browser_signing_policies for each row execute function public.browser_signing_retention_guard();
create trigger browser_signing_barrier_retention before update or delete on public.browser_signing_v2_barrier for each row execute function public.browser_signing_retention_guard();

-- Inactive by default; only owner-controlled synthetic fixtures activate it.
-- A transaction-local private table, rather than a caller-settable GUC, permits
-- v2 to compose the existing admission. Legacy lifecycle callbacks remain valid.
create function public.browser_signing_fresh_gate() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if exists(select 1 from public.browser_signing_v2_barrier where id=1)
   and not exists(select 1 from public.browser_signing_v2_writer where transaction_id=txid_current()) then
  raise exception 'browser signing v2 original required';
 end if; return new;
end $$;
create trigger browser_signing_fresh_gate before insert on public.browser_authorization_intents for each row execute function public.browser_signing_fresh_gate();
create function public.browser_signing_validity_gate() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare o jsonb; begin
 select original into o from public.browser_signing_originals where nonce=new.nonce;
 if o is not null and new.header_hash is not null and not exists(select 1 from public.browser_signing_v2_writer where transaction_id=txid_current()) then
  raise exception 'browser signing canonical callback required';
 end if;
 if o is not null and ((new.valid_after is not null and new.valid_after is distinct from o#>>'{authorization,validAfter}')
   or (new.valid_before is not null and new.valid_before is distinct from o#>>'{authorization,validBefore}')) then raise exception 'browser signing original validity differs'; end if;
 return new;
end $$;
create trigger browser_signing_validity_gate before update on public.browser_journal_bindings for each row execute function public.browser_signing_validity_gate();
-- Fence metadata-only callers even on an already signed v2 replay. Keep the
-- original implementation private; v1 callbacks use the unchanged transition.
alter function public.sign_browser_journal(text,text,jsonb) rename to browser_signing_legacy_signature_internal;
revoke all on function public.browser_signing_legacy_signature_internal(text,text,jsonb) from public,anon,authenticated,service_role;
create function public.sign_browser_journal(p_session_id text,p_request_id text,p_metadata jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if exists(select 1 from public.browser_signing_originals where session_id=p_session_id and request_id=p_request_id)
  and not exists(select 1 from public.browser_signing_v2_writer where transaction_id=txid_current()) then raise exception 'browser signing canonical callback required'; end if;
 return public.browser_signing_legacy_signature_internal(p_session_id,p_request_id,p_metadata);
end $$;
revoke all on function public.sign_browser_journal(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.sign_browser_journal(text,text,jsonb) to service_role;

create function public.browser_signing_admit_query(p_verified jsonb,p_session_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p jsonb:=p_verified->'policy'; ns text:=p_verified->>'namespace'; n public.browser_signing_namespaces%rowtype;
 q public.browser_signing_queries%rowtype; saved jsonb; g public.session_grants%rowtype; ceiling bigint; lifetime bigint; jobs_limit bigint;
begin
 if (select active from public.browser_signing_v2_control where id=1) is distinct from true
  or (select active from public.browser_journal_control where id=1) is distinct from true then return jsonb_build_object('status','inactive'); end if;
 if p->>'protocol' is distinct from 'durable-v2' or p->>'service' is distinct from 'https://keryx.cc'
  or coalesce(ns,'') !~ '^0x[0-9a-f]{64}$' or coalesce(p_verified->>'proofDigest','') !~ '^0x[0-9a-f]{64}$'
  or coalesce(p_verified->>'signature','') !~ '^0x[0-9a-f]{130}$'
  or coalesce(p->>'owner','') !~ '^0x[0-9a-f]{40}$' or coalesce(p->>'signer','') !~ '^0x[0-9a-f]{40}$'
  or coalesce(p->>'policyId','') !~ '^0x[0-9a-f]{64}$' or coalesce(p->>'requestNonce','') !~ '^0x[0-9a-f]{64}$'
  or coalesce(p->>'questionDigest','') !~ '^0x[0-9a-f]{64}$'
  or coalesce(p->>'queryCeilingMicros','') !~ '^[1-9][0-9]{0,15}$' or coalesce(p->>'lifetimeCeilingMicros','') !~ '^[1-9][0-9]{0,15}$'
  or coalesce(p->>'jobLimit','') !~ '^[1-9][0-9]{0,15}$' or coalesce(p->>'expiresAt','') !~ '^[1-9][0-9]{0,15}$'
  or coalesce(p_session_id,'')='' then raise exception 'browser query policy refused'; end if;
 perform (p->>'queryId')::uuid; perform (p->>'grantEpoch')::uuid;
 ceiling:=(p->>'queryCeilingMicros')::bigint; lifetime:=(p->>'lifetimeCeilingMicros')::bigint; jobs_limit:=(p->>'jobLimit')::bigint;
 if ceiling>lifetime or lifetime>9007199254740991 or jobs_limit>9007199254740991 or (p->>'expiresAt')::numeric>9007199254740991 then raise exception 'browser query policy refused'; end if;
 perform pg_advisory_xact_lock(hashtextextended(ns,0));
 select verified into saved from public.browser_signing_policies where namespace=ns and policy_id=p->>'policyId';
 if found and saved is distinct from p_verified then raise exception 'browser query policy conflict'; end if;
 select * into q from public.browser_signing_queries where namespace=ns and (request_nonce=p->>'requestNonce' or query_id=p->>'queryId');
 if found then
  if q.policy_id=p->>'policyId' and q.query_id=p->>'queryId' and q.request_nonce=p->>'requestNonce' and q.session_id=p_session_id and saved=p_verified then
   return jsonb_build_object('status','admitted','namespace',ns,'queryId',q.query_id);
  end if; raise exception 'browser query original conflict';
 end if;
 select * into g from public.session_grants where session_id=p_session_id for update;
 if not found or lower(g.owner_addr) is distinct from p->>'owner' or lower(g.sess_addr) is distinct from p->>'signer'
  or g.grant_epoch is distinct from p->>'grantEpoch' or g.expiry<=(extract(epoch from clock_timestamp())*1000)::bigint
  or (p->>'expiresAt')::bigint<=(extract(epoch from clock_timestamp())*1000)::bigint or (p->>'expiresAt')::bigint>g.expiry
  or g.cap is null or g.cap='NaN'::numeric or g.cap<0 or g.cap*1000000<>trunc(g.cap*1000000)
  or g.cap*1000000>9007199254740991 or lifetime>g.cap*1000000 then return jsonb_build_object('status','refused'); end if;
 select * into n from public.browser_signing_namespaces where namespace=ns for update;
 if found and (n.owner is distinct from p->>'owner' or n.signer is distinct from p->>'signer' or n.service is distinct from p->>'service'
  or n.allocated_micro+ceiling>lifetime or n.jobs+1>jobs_limit) then return jsonb_build_object('status','refused'); end if;
 if not found then
  insert into public.browser_signing_namespaces(namespace,owner,signer,service,network,ceiling_micro,job_limit,ceiling_proof)
   values(ns,p->>'owner',p->>'signer',p->>'service','eip155:5042002',lifetime,jobs_limit,jsonb_build_object('policy',p,'signature',p_verified->>'signature'));
 end if;
 insert into public.browser_signing_policies values(ns,p->>'policyId',p_verified);
 insert into public.browser_signing_queries(namespace,query_id,request_nonce,policy_id,session_id,ceiling_micro)
  values(ns,p->>'queryId',p->>'requestNonce',p->>'policyId',p_session_id,ceiling);
 update public.browser_signing_namespaces set ceiling_micro=lifetime,job_limit=jobs_limit,ceiling_proof=jsonb_build_object('policy',p,'signature',p_verified->>'signature'),allocated_micro=allocated_micro+ceiling,jobs=jobs+1 where namespace=ns;
 return jsonb_build_object('status','admitted','namespace',ns,'queryId',p->>'queryId');
end $$;

-- One read-only statement returns payment lifecycle, immutable original, saved
-- owner proof, current grant and retained counters from one MVCC snapshot.
create function public.browser_signing_snapshot(p_owner text,p_session_id text,p_request_id text) returns jsonb
language sql security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object('original',o.original,'journal',o.journal||jsonb_strip_nulls(jsonb_build_object('phase',p.authorization_phase,
  'payment',o.journal->'payment'||jsonb_build_object('authorizationPhase',p.authorization_phase,'settled',p.settled,'settlementStatus',p.settlement_status,'txHash',p.tx_hash),
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
 where n.owner=lower(p_owner) and o.session_id=p_session_id and o.request_id=p_request_id;
$$;

create function public.browser_signing_admit_original(p_input jsonb,p_journal jsonb,p_original jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare ns text:=p_input->>'queryNamespace'; qid text:=p_input->>'queryId'; a jsonb:=p_input->'journal';
 q public.browser_signing_queries%rowtype; n public.browser_signing_namespaces%rowtype; old public.browser_signing_originals%rowtype;
 p jsonb; g public.session_grants%rowtype; intent jsonb; amount bigint; seconds bigint; result text;
begin
 if (select active from public.browser_signing_v2_control where id=1) is distinct from true
  or (select active from public.browser_journal_control where id=1) is distinct from true then return jsonb_build_object('status','inactive'); end if;
 perform pg_advisory_xact_lock(hashtextextended(ns,0));
 select * into old from public.browser_signing_originals where session_id=a->>'sessionId' and request_id=a->>'requestId';
 if found then
  if old.input is distinct from p_input then raise exception 'browser signing original conflict'; end if;
  select owner into n.owner from public.browser_signing_namespaces where namespace=old.namespace;
  return jsonb_build_object('status','admitted','snapshot',public.browser_signing_snapshot(n.owner,old.session_id,old.request_id));
 end if;
 select * into q from public.browser_signing_queries where namespace=ns and query_id=qid for update;
 if not found then return jsonb_build_object('status','refused'); end if;
 select * into n from public.browser_signing_namespaces where namespace=ns for update;
 select verified->'policy' into p from public.browser_signing_policies where namespace=ns and policy_id=q.policy_id;
 select * into g from public.session_grants where session_id=a->>'sessionId' for update;
 if not found or q.session_id is distinct from a->>'sessionId' or g.grant_epoch is distinct from p->>'grantEpoch'
  or a->>'grantEpoch' is distinct from p->>'grantEpoch' or lower(g.owner_addr) is distinct from n.owner or lower(g.sess_addr) is distinct from n.signer
  or g.expiry<=(extract(epoch from clock_timestamp())*1000)::bigint or (p->>'expiresAt')::bigint<=(extract(epoch from clock_timestamp())*1000)::bigint then return jsonb_build_object('status','refused'); end if;
 if a->>'queryId' is distinct from qid or p_journal->>'sessionId' is distinct from a->>'sessionId'
  or p_journal->>'requestId' is distinct from a->>'requestId' or p_journal->>'grantEpoch' is distinct from a->>'grantEpoch'
  or lower(a->>'signer') is distinct from n.signer or lower(p_journal->>'signer') is distinct from n.signer
  or p_journal->'requirements' is distinct from a->'requirements' or p_journal->>'phase' is distinct from 'prepared'
  or p_journal#>>'{payment,queryId}' is distinct from qid
  or (p_journal->'payment'-array['id','createdAt','settled','settlementStatus','authorizationId','authorizationPhase']) is distinct from a->'payment'
  then raise exception 'browser signing journal differs'; end if;
 amount:=(a->>'amountMicroUsdc')::bigint; seconds:=floor(extract(epoch from (p_journal->>'admittedAt')::timestamptz))::bigint;
 if amount<1 or amount>9007199254740991 or seconds<600 then raise exception 'browser signing original refused'; end if;
 if q.spent_micro+amount>q.ceiling_micro then return jsonb_build_object('status','refused'); end if;
 if p_original is distinct from jsonb_build_object('protocol','durable-v2','admittedAt',p_journal->>'admittedAt','namespace',ns,'queryId',qid,
  'requestId',a->>'requestId','grantEpoch',a->>'grantEpoch','domain',jsonb_build_object('name','GatewayWalletBatched','version','1','chainId',5042002,'verifyingContract','0x0077777d7eba4688bdef3e311b846f25870a19b9'),
  'authorization',jsonb_build_object('from',n.signer,'to',lower(a->>'payee'),'value',amount::text,'validAfter',(seconds-600)::text,
    'validBefore',(seconds+(a#>>'{requirements,maxTimeoutSeconds}')::bigint)::text,'nonce',p_journal->>'nonce')) then raise exception 'browser signing original differs'; end if;
 intent:=jsonb_build_object('nonce',p_journal->>'nonce','session_id',a->>'sessionId','request_id',a->>'requestId','query_id',qid,'grant_epoch',a->>'grantEpoch',
  'signer',n.signer,'network',a->>'network','token',a->>'token','gateway_contract',a->>'gatewayContract','source_id',a->>'sourceId','offer_id',a->'offerId','kind',a->>'kind','payee',a->>'payee','amount_micro_usdc',amount::text,'created_at',p_journal->>'admittedAt');
 insert into public.browser_signing_v2_writer values(txid_current());
 result:=public.admit_browser_journal(intent,p_journal->'requirements',p_journal->'payment');
 delete from public.browser_signing_v2_writer where transaction_id=txid_current();
 if result<>'admitted' then return jsonb_build_object('status','refused'); end if;
 insert into public.browser_signing_originals values(p_journal->>'nonce',ns,qid,p_input,p_journal,p_original,a->>'sessionId',a->>'requestId');
 update public.browser_signing_queries set spent_micro=spent_micro+amount where namespace=ns and query_id=qid;
 return jsonb_build_object('status','admitted','snapshot',public.browser_signing_snapshot(n.owner,a->>'sessionId',a->>'requestId'));
end $$;
create function public.browser_signing_header_original(p_session_id text,p_request_id text) returns jsonb
language sql security definer set search_path=pg_catalog,pg_temp as $$
 select original from public.browser_signing_originals where session_id=p_session_id and request_id=p_request_id;
$$;
-- The caller verifies canonical header bytes and actual signer recovery in the
-- TypeScript composition. This service-only bridge cannot make that SQL claim.
create function public.browser_signing_record_signature(p_session_id text,p_request_id text,p_metadata jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result boolean; begin
 if not exists(select 1 from public.browser_signing_originals where session_id=p_session_id and request_id=p_request_id) then return false; end if;
 insert into public.browser_signing_v2_writer values(txid_current());
 result:=public.sign_browser_journal(p_session_id,p_request_id,p_metadata);
 delete from public.browser_signing_v2_writer where transaction_id=txid_current(); return result;
end $$;
do $$ declare f record; begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace
  and proname in ('browser_signing_control_guard','browser_signing_retention_guard','browser_signing_fresh_gate','browser_signing_validity_gate','browser_signing_admit_query','browser_signing_admit_original','browser_signing_snapshot','browser_signing_header_original','browser_signing_record_signature') loop
  execute 'revoke all on function '||f.signature||' from public,anon,authenticated,service_role';
  if f.proname in ('browser_signing_admit_query','browser_signing_admit_original','browser_signing_snapshot','browser_signing_header_original','browser_signing_record_signature') then execute 'grant execute on function '||f.signature||' to service_role'; end if;
 end loop;
end $$;

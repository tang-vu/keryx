begin;
-- SOURCE ONLY: no production application/activation/backfill is authorized by #266.
-- Existing rows have no sidecar and resolve to UNLISTED; INSERTs capture the new default.
-- A pre-existing claim seal must be admitted BEFORE any catalog transition. This
-- is an explicit owner-run migration transition, never runtime schema adoption.
do $$ begin
  if to_regclass('public.anonymous_run_claims_catalog_seal') is null then raise exception 'privacy_unavailable'; end if;
  -- Reuse the existing admitted original/session schema; never bless an unknown
  -- ordinary domain merely because it has similarly named tables.
  perform public.anonymous_run_claims_guard_v1();
end; $$;
-- Legacy public REST / realtime reads must not bypass the application privacy port.
-- Service financial authority and every row remain unchanged. Safe public financial
-- projections remain available through Keryx APIs; raw rationale is retained privately.
revoke all on public.query_runs,public.query_memories,public.gap_intents,public.payment_events from public,anon,authenticated;
-- Column grants are independent of relation grants; remove those explicitly too.
do $$ declare relation text; columns text; begin
  foreach relation in array array['query_runs','query_memories','gap_intents','payment_events'] loop
    select string_agg(quote_ident(attname),',') into columns from pg_attribute where attrelid=('public.'||relation)::regclass
      and attnum>0 and not attisdropped;
    execute format('revoke select (%s),insert (%s),update (%s),references (%s) on public.%I from public,anon,authenticated',columns,columns,columns,columns,relation);
  end loop;
  if exists(select 1 from pg_publication where pubname='supabase_realtime' and puballtables) then raise exception 'privacy_unavailable'; end if;
  for relation in select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'
    and tablename in ('query_runs','payment_events','query_memories','gap_intents') loop
    execute format('alter publication supabase_realtime drop table public.%I',relation);
  end loop;
end; $$;
create table public.run_privacy (
  run_id text primary key, visibility text not null check(visibility in ('private','unlisted','public')),
  revision integer not null default 0 check(revision>=0), erased boolean not null default false,
  retained_owner text, retained_digest text, retained_binding jsonb, updated_at timestamptz not null
);
create table public.run_privacy_defaults (
  wallet text primary key check(wallet ~ '^0x[a-f0-9]{40}$'),
  visibility text not null check(visibility in ('private','unlisted','public'))
);
create table public.run_privacy_audit (
  request_id uuid primary key, wallet text not null, run_id text, action text not null,
  input jsonb not null, result jsonb not null, original_digest text, created_at timestamptz not null default clock_timestamp()
);
create table public.run_privacy_catalog_seal (singleton boolean primary key check(singleton),snapshot jsonb not null);

create function public.run_privacy_retained_v1() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if TG_TABLE_NAME in ('run_privacy_audit','run_privacy_catalog_seal') or TG_OP='DELETE' then raise exception 'privacy_retained'; end if;
  if old.erased then raise exception 'privacy_retained'; end if;
  return new;
end; $$;
create trigger run_privacy_retained before update or delete on public.run_privacy for each row execute function public.run_privacy_retained_v1();
create trigger run_privacy_audit_retained before update or delete on public.run_privacy_audit for each row execute function public.run_privacy_retained_v1();
create trigger run_privacy_seal_retained before update or delete on public.run_privacy_catalog_seal for each row execute function public.run_privacy_retained_v1();

create function public.run_privacy_capture_v1() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if TG_WHEN='BEFORE' then
    if exists(select 1 from public.run_privacy where run_id=coalesce(new.id,old.id) and erased) then raise exception 'privacy_erased'; end if;
    if exists(select 1 from public.query_runs where id=new.id) then
      insert into public.run_privacy(run_id,visibility,updated_at) values(new.id,'unlisted',new.created_at) on conflict(run_id) do nothing;
    end if;
    return new;
  end if;
  insert into public.run_privacy(run_id,visibility,updated_at) values(new.id,
    case when new.asker ~ '^0x[a-f0-9]{40}$' then coalesce((select visibility from public.run_privacy_defaults where wallet=new.asker),'private') else 'unlisted' end,
    new.created_at) on conflict(run_id) do nothing;
  return new;
end; $$;
create trigger run_privacy_new after insert on public.query_runs for each row execute function public.run_privacy_capture_v1();
create trigger run_privacy_no_resurrection before insert or update on public.query_runs for each row execute function public.run_privacy_capture_v1();
create function public.run_privacy_memory_guard_v1() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.run_privacy where run_id=new.id and erased) then raise exception 'privacy_erased'; end if;
  return new;
end; $$;
create trigger run_privacy_memory_guard before insert or update on public.query_memories for each row execute function public.run_privacy_memory_guard_v1();

alter table public.run_privacy enable row level security;
alter table public.run_privacy_defaults enable row level security;
alter table public.run_privacy_audit enable row level security;
alter table public.run_privacy_catalog_seal enable row level security;
revoke all on public.run_privacy,public.run_privacy_defaults,public.run_privacy_audit,public.run_privacy_catalog_seal from public,anon,authenticated;
grant select,insert,update on public.run_privacy,public.run_privacy_defaults to service_role;
grant select,insert on public.run_privacy_audit to service_role;
grant select on public.run_privacy_catalog_seal to service_role;
create policy run_privacy_service on public.run_privacy to service_role using(true) with check(true);
create policy run_privacy_defaults_service on public.run_privacy_defaults to service_role using(true) with check(true);
create policy run_privacy_audit_service_read on public.run_privacy_audit for select to service_role using(true);
create policy run_privacy_audit_service_insert on public.run_privacy_audit for insert to service_role with check(true);
create policy run_privacy_seal_service_read on public.run_privacy_catalog_seal for select to service_role using(true);

-- Source-created immutable catalog seal; neither runtime nor service_role may adopt unknown schema.
create function public.run_privacy_catalog_v1() returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
select jsonb_build_object(
  'relations',(select jsonb_agg(jsonb_build_object('oid',c.oid,'name',c.relname,'kind',c.relkind,'owner',c.relowner,'acl',c.relacl,
    'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'columns',(select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl,a.attgenerated,a.attidentity,
      pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
    'triggers',(select jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled,t.tgfoid) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
    'policies',(select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
    'rules',(select jsonb_agg(pg_get_ruledef(r.oid) order by r.rulename) from pg_rewrite r where r.ev_class=c.oid)) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      and (c.relname like 'run_privacy%' or c.relname in ('query_runs','web_sessions','a2a_orders','query_memories','gap_intents','payment_events'))),
  'functions',(select jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,pg_get_functiondef(p.oid)) order by p.oid)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'run_privacy%')
); $$;
create function public.run_privacy_guard_v1() returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if to_regclass('keryx_storage.identity') is not null or to_regclass('public.keryx_storage_identity') is not null then raise exception 'privacy_unavailable'; end if;
  lock table public.run_privacy,public.run_privacy_defaults,public.run_privacy_audit,public.run_privacy_catalog_seal,
    public.query_runs,public.web_sessions,public.a2a_orders,public.query_memories,public.gap_intents in access share mode;
  if (select snapshot from public.run_privacy_catalog_seal where singleton) is distinct from public.run_privacy_catalog_v1() then raise exception 'privacy_unavailable'; end if;
end; $$;

-- Financial counters/funding fields survive erasure exactly; no payment row is touched.
create function public.run_privacy_erased_v1(value jsonb) returns jsonb language sql immutable security invoker set search_path=pg_catalog,public as $$
select coalesce(jsonb_object_agg(key,val),'{}'::jsonb)||jsonb_build_object('question','','answer','','subClaims','[]'::jsonb,
  'decisions','[]'::jsonb,'citations','[]'::jsonb,'trace','[]'::jsonb)
from jsonb_each(value) as entry(key,val) where key=any(array['id','createdAt','budget','engine','totalSpent','totalToCreators','asker','askerFunded',
  'fundingOwner','origin','mcpClient','durationMs','paymentMode','paymentAttempts','settledPayments','pendingPayments','pendingSpendUsdc','operatingFee','usage','provenance']); $$;

create function public.run_privacy_v1(p_action text,p_id text,p_input jsonb,p_actor jsonb,p_claims boolean default false)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare q record; s record; prior record; result jsonb; who text; binding jsonb; owned boolean:=false;
  request_id uuid; requested text; stamp bigint; kept jsonb; original_digest text; take integer; claim jsonb;
begin
  perform public.run_privacy_guard_v1();
  if p_action not in ('read','list','memories','offers','settlement','owner','defaults','default','visibility','erase','export') or jsonb_typeof(p_input)<>'object'
    or p_id is not null and p_id !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception 'privacy_unavailable'; end if;
  if p_actor is not null then
    who:=p_actor->>'wallet'; binding:=p_actor->'binding';
    if who is null or who !~ '^0x[a-f0-9]{40}$' or binding->>'network' not in ('eip155:5042','eip155:5042002')
      or binding->>'origin' is null or octet_length(binding->>'origin')>2048 then raise exception 'unauthenticated'; end if;
  end if;
  if p_action in ('default','visibility','erase') then
    -- Existing session revocation uses DELETE (row-exclusive table lock). Share
    -- mode serializes that revoke against this mutation without granting UPDATE
    -- on immutable session rows or introducing a second session journal.
    lock table public.web_sessions in share mode;
    stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
    -- Same row used by SIWE; revocation removes it. Lock prevents revocation racing a committed mutation.
    perform 1 from public.web_sessions where hash=p_actor->>'sessionHash' and wallet=who and issued_at<=stamp and expires_at>stamp;
    if not found then raise exception 'unauthenticated'; end if;
  end if;
  if p_action in ('default','visibility','erase','export') then
    if who is null then raise exception 'unauthenticated'; end if;
    request_id:=(p_input->>'requestId')::uuid;
    if request_id is null then raise exception 'conflict'; end if;
    -- Serialize retries across different runs and defaults as well as per-run row locks.
    perform pg_advisory_xact_lock(hashtextextended(request_id::text,266));
    if p_action<>'export' then
      stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
      perform 1 from public.web_sessions where hash=p_actor->>'sessionHash' and wallet=who and issued_at<=stamp and expires_at>stamp;
      if not found then raise exception 'unauthenticated'; end if;
    end if;
  end if;
  if p_action='offers' then
    take:=(p_input->>'take')::integer;
    if take is null or take<1 or take>200 then raise exception 'privacy_unavailable'; end if;
    select coalesce(jsonb_agg(v.item order by v.created_at desc,v.id desc),'[]'::jsonb) into result from (
      select g.id,g.created_at,jsonb_strip_nulls(jsonb_build_object('id',g.id,'gapId',g.gap_id,'sourceId',g.source_id,'sourceItemLink',g.source_item_link,
        'itemId',g.item_id,'contentVersion',g.content_version,'articleOfferId',g.article_offer_id,'ownerWallet',g.owner_wallet,'status',g.status,'attempts',g.attempts,
        'retryRunId',g.retry_run_id,'coverage',g.coverage,'rewardUsdc',g.reward_usdc,'createdAt',g.created_at,'updatedAt',g.updated_at)) item
      from public.gap_intents g join public.run_privacy p on p.run_id=g.failed_query_id where p.visibility='public' and not p.erased
        and (g.retry_run_id is null or exists(select 1 from public.run_privacy r where r.run_id=g.retry_run_id and r.visibility='public' and not r.erased))
      order by g.created_at desc,g.id desc limit take) v;
  elsif p_action='memories' then
    take:=(p_input->>'take')::integer;
    if take is null or take<1 or take>2500 then raise exception 'privacy_unavailable'; end if;
    select coalesce(jsonb_agg(v.item order by v.created_at desc,v.id desc),'[]'::jsonb) into result from (
      select m.id,m.created_at,jsonb_build_object('id',m.id,'createdAt',to_char(m.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'sourceScores',m.source_scores,'topics',m.topics)||case when m.sources_read is not null then jsonb_build_object('sourcesRead',m.sources_read) else '{}'::jsonb end item
      from public.query_memories m join public.run_privacy p on p.run_id=m.id where p.visibility='public' and not p.erased
      order by m.created_at desc,m.id desc limit take) v;
  elsif p_action='list' then
    take:=(p_input->>'take')::integer;
    if take is null or take<1 or take>2500 or p_input ? 'ids' and (jsonb_typeof(p_input->'ids')<>'array' or jsonb_array_length(p_input->'ids')>10000) then raise exception 'privacy_unavailable'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('run',v.data,'state',jsonb_build_object('visibility','public','revision',v.revision,'erased',false))
      order by v.created_at desc,v.id desc),'[]'::jsonb) into result from (
      select r.id,r.created_at,r.data,p.revision from public.query_runs r join public.run_privacy p on p.run_id=r.id
      where p.visibility='public' and not p.erased
        and (not p_input ? 'parentId' or r.parent_id=p_input->>'parentId')
        and (not p_input ? 'ids' or r.id in (select jsonb_array_elements_text(p_input->'ids')))
        and (not p_input ? 'before' or (r.created_at,r.id)<((p_input->'before'->>'createdAt')::timestamptz,p_input->'before'->>'id'))
      order by r.created_at desc,r.id desc limit take
    ) v;
  elsif p_action in ('defaults','default') then
    if who is null then raise exception 'unauthenticated'; end if;
    if p_action='default' then
      select * into prior from public.run_privacy_audit a where a.request_id=run_privacy_v1.request_id;
      if found then
        if prior.wallet<>who or prior.run_id is not null or prior.action<>p_action or prior.input<>p_input then raise exception 'conflict'; end if;
        result:=prior.result;
      else
        requested:=p_input->>'visibility';
        if requested is null or requested not in ('private','unlisted','public') then raise exception 'conflict'; end if;
        insert into public.run_privacy_defaults values(who,requested) on conflict(wallet) do update set visibility=excluded.visibility;
        result:=to_jsonb(requested);
        insert into public.run_privacy_audit(request_id,wallet,action,input,result) values(request_id,who,p_action,p_input,result);
      end if;
    else select to_jsonb(coalesce((select visibility from public.run_privacy_defaults where wallet=who),'private')) into result; end if;
  elsif p_action='settlement' then
    -- Never reads question/answer/data: private existence and financial proof are deliberately public.
    select jsonb_build_object('id',id,'createdAt',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'budget',budget,'engine',engine,'totalSpent',total_spent,'totalToCreators',total_to_creators,
      'question','','answer','','subClaims','[]'::jsonb,'decisions','[]'::jsonb,'citations','[]'::jsonb,'trace','[]'::jsonb) into result
      from public.query_runs where id=p_id;
  else
    -- Only metadata is inspected until a listed/link or owner authorization has been established.
    select id,asker into q from public.query_runs where id=p_id for update;
    if p_action in ('visibility','erase') then
      -- Refresh after the original row lock too; waiting cannot extend expiry.
      stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
      perform 1 from public.web_sessions where hash=p_actor->>'sessionHash' and wallet=who and issued_at<=stamp and expires_at>stamp;
      if not found then raise exception 'unauthenticated'; end if;
    end if;
    if not found then
      if p_action='read' then result:=jsonb_build_object('exists',false,'item',null);
      elsif p_action='owner' then result:=null; else raise exception 'not_found'; end if;
    else
      select coalesce(p.visibility,'unlisted') visibility,coalesce(p.revision,0) revision,coalesce(p.erased,false) erased,
        p.retained_owner,p.retained_digest,p.retained_binding into s from (select p_id id) k left join public.run_privacy p on p.run_id=k.id;
      owned:=who is not null and q.asker=who;
      if not coalesce(owned,false) and who is not null and q.asker is null then
        if s.erased and s.retained_owner=who and s.retained_binding=binding then
          select s.retained_digest=encode(sha256(convert_to(data::text,'UTF8')),'hex') into owned from public.query_runs where id=p_id;
        elsif p_claims then
          -- Reuse unchanged admitted claim proof. Missing/wrong claim schema has no fallback.
          claim:=public.anonymous_run_claim_history_read_v1(who,binding->>'network',binding->>'origin',p_id);
          owned:=claim->'item' is not null and claim->'item'<>'null'::jsonb;
        end if;
      end if;
      owned:=coalesce(owned,false);
      if p_action='read' and (s.erased or s.visibility='private' and not owned) then result:=jsonb_build_object('exists',true,'item',null);
      elsif p_action<>'read' and not owned then
        if p_action='owner' then result:=null; else raise exception 'not_found'; end if;
      else
        select data into kept from public.query_runs where id=p_id;
        if jsonb_typeof(kept)<>'object' or kept->>'id'<>p_id or octet_length(kept::text)>4000000 then raise exception 'privacy_unavailable'; end if;
        original_digest:=encode(sha256(convert_to(kept::text,'UTF8')),'hex');
        result:=jsonb_build_object('run',kept,'state',jsonb_build_object('visibility',s.visibility,'revision',s.revision,'erased',s.erased));
        if p_action='read' then result:=jsonb_build_object('exists',true,'item',result);
        elsif p_action in ('visibility','erase','export') then
          select * into prior from public.run_privacy_audit a where a.request_id=run_privacy_v1.request_id;
          if found then
            if prior.wallet<>who or prior.run_id<>p_id or prior.action<>p_action or prior.input<>p_input then raise exception 'conflict'; end if;
            if p_action<>'export' then result:=prior.result; end if;
          else
            if p_action<>'export' then
              if s.erased then
                if p_action<>'erase' then raise exception 'conflict'; end if;
              else
                if (p_input->>'revision')::integer is distinct from s.revision then raise exception 'conflict'; end if;
                requested:=p_input->>'visibility';
                if p_action='erase' then
                  if kept ? 'originalFulfillment' or exists(select 1 from public.a2a_orders where query_id=p_id) or exists(select 1 from public.gap_intents where failed_query_id=p_id and status not in ('filled','missed','unpaid','failed','stale')) then raise exception 'retention_hold'; end if;
                  kept:=public.run_privacy_erased_v1(kept);
                  update public.query_runs set data=kept,question='',answer='' where id=p_id;
                  delete from public.query_memories where id=p_id;
                  update public.gap_intents set question='',claim='',last_error=null where failed_query_id=p_id;
                  requested:='private';
                end if;
                if requested is null or requested not in ('private','unlisted','public') then raise exception 'conflict'; end if;
                insert into public.run_privacy(run_id,visibility,revision,erased,retained_owner,retained_digest,retained_binding,updated_at)
                  values(p_id,requested,s.revision+1,p_action='erase',case when p_action='erase' then who end,
                    case when p_action='erase' then encode(sha256(convert_to(kept::text,'UTF8')),'hex') end,
                    case when p_action='erase' then binding end,clock_timestamp())
                  on conflict(run_id) do update set visibility=excluded.visibility,revision=excluded.revision,erased=excluded.erased,
                    retained_owner=excluded.retained_owner,retained_digest=excluded.retained_digest,retained_binding=excluded.retained_binding,updated_at=excluded.updated_at;
                s.visibility:=requested; s.revision:=s.revision+1; s.erased:=p_action='erase';
              end if;
              result:=jsonb_build_object('visibility',s.visibility,'revision',s.revision,'erased',s.erased);
            end if;
            -- An export audit stores state and original digest only, never another text copy.
            insert into public.run_privacy_audit(request_id,wallet,run_id,action,input,result,original_digest)
              values(request_id,who,p_id,p_action,p_input,case when p_action='export' then result->'state' else result end,original_digest);
          end if;
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('version',1,'action',p_action,'id',p_id,'result',result);
end; $$;
revoke all on function public.run_privacy_retained_v1(),public.run_privacy_capture_v1(),public.run_privacy_catalog_v1(),public.run_privacy_guard_v1(),
  public.run_privacy_memory_guard_v1(),public.run_privacy_erased_v1(jsonb),public.run_privacy_v1(text,text,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.run_privacy_capture_v1(),public.run_privacy_catalog_v1(),public.run_privacy_guard_v1(),
  public.run_privacy_memory_guard_v1(),public.run_privacy_erased_v1(jsonb),public.run_privacy_v1(text,text,jsonb,jsonb,boolean) to service_role;
-- Validate ordinary prerequisites before freezing the source-created seal. No guessed owner/backfill.
do $$ begin
  if to_regclass('keryx_storage.identity') is not null or to_regclass('public.keryx_storage_identity') is not null then raise exception 'privacy_unavailable'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    and c.relname in ('query_runs','web_sessions','a2a_orders','query_memories','gap_intents') and c.relkind='r' and c.relpersistence='p')<>5 then raise exception 'privacy_unavailable'; end if;
end; $$;
-- Rebind ONLY the already-validated existing claim catalog after the exact source
-- ACL transition. Keep its rows, original digests, functions and immutable trigger
-- identical. No flag is enabled and no new owner/claim is invented.
do $$ declare accepted_claim_snapshot jsonb; begin
  if to_regclass('public.anonymous_run_claims_catalog_seal') is not null then
    accepted_claim_snapshot:=public.anonymous_run_claims_catalog_v1();
    -- Disable only this exact trigger for the source-owned catalog update, then
    -- restore it before taking the final snapshot (which includes enabled state).
    alter table public.anonymous_run_claims_catalog_seal disable trigger anonymous_run_claims_seal_immutable;
    update public.anonymous_run_claims_catalog_seal set snapshot=accepted_claim_snapshot;
    alter table public.anonymous_run_claims_catalog_seal enable trigger anonymous_run_claims_seal_immutable;
    perform public.anonymous_run_claims_guard_v1();
  end if;
end; $$;
insert into public.run_privacy_catalog_seal values(true,public.run_privacy_catalog_v1());
select public.run_privacy_guard_v1();
commit;

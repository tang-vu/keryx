begin;
-- Source-only ordinary-storage transition. No flag, native enrollment, backfill,
-- existing preference, original, financial row or predecessor seal is changed.
do $$ begin
  perform public.anonymous_run_claims_guard_v1();
  perform public.run_privacy_guard_v1();
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and left(c.relname,20)='research_publication')
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and left(p.proname,20)='research_publication') then raise exception 'privacy_unavailable'; end if;
end; $$;

create table public.research_publication_catalog_seal (
  singleton boolean primary key check(singleton), snapshot jsonb not null
);
create function public.research_publication_retained_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin raise exception 'privacy_unavailable'; end; $$;
create trigger research_publication_seal_retained before update or delete
  on public.research_publication_catalog_seal for each row execute function public.research_publication_retained_v1();
alter table public.research_publication_catalog_seal enable row level security;
revoke all on public.research_publication_catalog_seal from public,anon,authenticated,service_role;
grant select on public.research_publication_catalog_seal to service_role;
create policy research_publication_seal_read on public.research_publication_catalog_seal for select to service_role using(true);

-- A separate namespace leaves the immutable 0088/0090 catalog domains unchanged.
create function public.research_publication_catalog_v1() returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
select jsonb_build_object(
  'relations',(select jsonb_agg(jsonb_build_object('oid',c.oid,'name',c.relname,'kind',c.relkind,'owner',c.relowner,'acl',c.relacl,
    'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'columns',(select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl,a.attgenerated,a.attidentity,
      pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
    'indexes',(select jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indislive,i.indimmediate)
      order by i.indexrelid) from pg_index i where i.indrelid=c.oid),
    'triggers',(select jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled,t.tgfoid) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
    'policies',(select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polroles,p.polpermissive,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
    'rules',(select jsonb_agg(pg_get_ruledef(r.oid) order by r.rulename) from pg_rewrite r where r.ev_class=c.oid)) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and left(c.relname,20)='research_publication'),
  'functions',(select jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,pg_get_functiondef(p.oid)) order by p.oid)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,20)='research_publication')
); $$;
create function public.research_publication_guard_v1() returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  perform public.anonymous_run_claims_guard_v1();
  perform public.run_privacy_guard_v1();
  lock table public.research_publication_catalog_seal in access share mode;
  if (select snapshot from public.research_publication_catalog_seal where singleton)
      is distinct from public.research_publication_catalog_v1() then raise exception 'privacy_unavailable'; end if;
end; $$;

create function public.research_publication_v1(p_action text,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.query_runs%rowtype; original jsonb; chosen text; had_sidecar boolean; inserted text;
  result jsonb; result_id text:=null; who text; relation text; privilege text; changed integer;
begin
  if current_user<>'service_role' then raise exception 'privacy_unavailable'; end if;
  perform public.research_publication_guard_v1();
  if p_action is null or p_action not in ('ready','defaults','save') or p_input is null
    or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>4194304 then raise exception 'privacy_unavailable'; end if;
  if p_action in ('ready','save') then
    if current_setting('transaction_read_only')<>'off' or pg_is_in_recovery() then raise exception 'privacy_unavailable'; end if;
    foreach relation in array array['query_runs','run_privacy'] loop
      foreach privilege in array array['SELECT','INSERT','UPDATE'] loop
        if not has_table_privilege(current_user,'public.'||relation,privilege) then raise exception 'privacy_unavailable'; end if;
      end loop;
    end loop;
    if not has_table_privilege(current_user,'public.run_privacy_defaults','SELECT') then raise exception 'privacy_unavailable'; end if;
    -- Genuine write-readiness, including transaction-level read-only refusal,
    -- without changing any original, preference, sidecar or audit row.
    update public.run_privacy_defaults set visibility=visibility where false;
  end if;
  if p_action='ready' then
    if p_input<>'{}'::jsonb then raise exception 'privacy_unavailable'; end if;
    result:=jsonb_build_object('ready',true);
  elsif p_action='defaults' then
    if (select array_agg(key order by key) from jsonb_object_keys(p_input) key) is distinct from array['binding','wallet']
      or jsonb_typeof(p_input->'binding')<>'object'
      or (select array_agg(key order by key) from jsonb_object_keys(p_input->'binding') key) is distinct from array['network','origin'] then raise exception 'privacy_unavailable'; end if;
    who:=p_input->>'wallet';
    if who is null or who !~ '^0x[a-f0-9]{40}$'
      or not coalesce(p_input->'binding'->>'network' in ('eip155:5042','eip155:5042002'),false)
      or not coalesce(public.anonymous_run_claim_origin_valid_v1(p_input->'binding'->>'origin'),false) then raise exception 'privacy_unavailable'; end if;
    select visibility into chosen from public.run_privacy_defaults where wallet=who;
    if not found then chosen:='public'; end if;
    if chosen is null or chosen not in ('private','unlisted','public') then raise exception 'privacy_unavailable'; end if;
    result:=to_jsonb(chosen);
  else
    if not p_input ? 'row' or (p_input - array['row','publication'])<>'{}'::jsonb
      or jsonb_typeof(p_input->'row')<>'object' then raise exception 'privacy_unavailable'; end if;
    if p_input ? 'publication' and (jsonb_typeof(p_input->'publication')<>'object'
      or (select array_agg(key order by key) from jsonb_object_keys(p_input->'publication') key) is distinct from array['visibility']
      or p_input->'publication'->>'visibility' is null or p_input->'publication'->>'visibility' not in ('private','unlisted','public')) then raise exception 'privacy_unavailable'; end if;
    if (select array_agg(key order by key) from jsonb_object_keys(p_input->'row') key) is distinct from
      (select array_agg(key order by key) from unnest(array['id','created_at','question','budget','engine','total_spent','total_to_creators','answer','data',
        'parent_id','asker','origin','mcp_client','duration_ms','payment_mode','payment_attempts','settled_payments','confidence_level',
        'evidence_claim_count','grounded_claim_count','rewarded_citation_count','economics_data']) key) then raise exception 'privacy_unavailable'; end if;
    select * into r from jsonb_populate_record(null::public.query_runs,p_input->'row');
    original:=r.data;
    if r.id is null or r.id !~ '^[A-Za-z0-9_-]{1,128}$' or left(r.id,4)='prv_'
      or r.parent_id is not null and (r.parent_id !~ '^[A-Za-z0-9_-]{1,128}$' or left(r.parent_id,4)='prv_')
      or r.created_at is null or r.question is null or r.answer is null or r.engine is null
      or r.budget is null or r.total_spent is null or r.total_to_creators is null
      or jsonb_typeof(original)<>'object' or not original ?& array['id','createdAt','question','answer','budget','engine','totalSpent','totalToCreators','subClaims','decisions','citations','trace']
      or jsonb_typeof(original->'id')<>'string' or original->>'id' is distinct from r.id
      or jsonb_typeof(original->'createdAt')<>'string' or (original->>'createdAt')::timestamptz is distinct from r.created_at
      or jsonb_typeof(original->'question')<>'string' or original->>'question' is distinct from r.question
      or jsonb_typeof(original->'answer')<>'string' or original->>'answer' is distinct from r.answer
      or jsonb_typeof(original->'engine')<>'string' or original->>'engine' is distinct from r.engine
      or jsonb_typeof(original->'budget')<>'number' or (original->>'budget')::numeric is distinct from r.budget
      or jsonb_typeof(original->'totalSpent')<>'number' or (original->>'totalSpent')::numeric is distinct from r.total_spent
      or jsonb_typeof(original->'totalToCreators')<>'number' or (original->>'totalToCreators')::numeric is distinct from r.total_to_creators
      or jsonb_typeof(original->'subClaims')<>'array' or jsonb_typeof(original->'decisions')<>'array'
      or jsonb_typeof(original->'citations')<>'array' or jsonb_typeof(original->'trace')<>'array'
      or r.asker is not null and r.asker !~ '^0x[a-f0-9]{40}$'
      or lower(original->>'asker') is distinct from r.asker
      or (original->>'parentId') is distinct from r.parent_id then raise exception 'privacy_unavailable'; end if;
    -- Serialize this namespace's first saves. INSERT's actual outcome below also
    -- handles a concurrent legacy writer that does not take this advisory lock.
    perform pg_advisory_xact_lock(hashtextextended(r.id,293));
    perform 1 from public.query_runs where id=r.id for update;
    select true into had_sidecar from public.run_privacy where run_id=r.id for update;
    had_sidecar:=coalesce(had_sidecar,false);
    insert into public.query_runs(id,created_at,question,budget,engine,total_spent,total_to_creators,answer,data,parent_id,asker,
      origin,mcp_client,duration_ms,payment_mode,payment_attempts,settled_payments,confidence_level,evidence_claim_count,grounded_claim_count,rewarded_citation_count,economics_data)
      values(r.id,r.created_at,r.question,r.budget,r.engine,r.total_spent,r.total_to_creators,r.answer,r.data,r.parent_id,r.asker,
        r.origin,r.mcp_client,r.duration_ms,r.payment_mode,r.payment_attempts,r.settled_payments,r.confidence_level,r.evidence_claim_count,r.grounded_claim_count,r.rewarded_citation_count,r.economics_data)
      on conflict(id) do nothing returning id into inserted;
    if inserted is null then
      update public.query_runs set created_at=r.created_at,question=r.question,budget=r.budget,engine=r.engine,total_spent=r.total_spent,
        total_to_creators=r.total_to_creators,answer=r.answer,data=r.data,parent_id=r.parent_id,asker=r.asker,origin=r.origin,mcp_client=r.mcp_client,
        duration_ms=r.duration_ms,payment_mode=r.payment_mode,payment_attempts=r.payment_attempts,settled_payments=r.settled_payments,
        confidence_level=r.confidence_level,evidence_claim_count=r.evidence_claim_count,grounded_claim_count=r.grounded_claim_count,
        rewarded_citation_count=r.rewarded_citation_count,economics_data=r.economics_data where id=r.id;
    elsif not had_sidecar then
      if p_input ? 'publication' then chosen:=p_input->'publication'->>'visibility';
      else
        select visibility into chosen from public.run_privacy_defaults where wallet=r.asker;
        if not found then chosen:='public'; end if;
      end if;
      if chosen is null or chosen not in ('private','unlisted','public') then raise exception 'privacy_unavailable'; end if;
      -- The original and its trigger-created sidecar remain in this transaction.
      update public.run_privacy set visibility=chosen where run_id=r.id and revision=0 and not erased;
      get diagnostics changed=row_count;
      if changed<>1 then raise exception 'privacy_unavailable'; end if;
    end if;
    result_id:=r.id; result:=jsonb_build_object('saved',true);
  end if;
  perform public.research_publication_guard_v1();
  return jsonb_build_object('version',1,'action',p_action,'id',result_id,'result',result);
exception when others then raise exception 'privacy_unavailable';
end; $$;

revoke all on function public.research_publication_retained_v1(),public.research_publication_catalog_v1(),
  public.research_publication_guard_v1(),public.research_publication_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.research_publication_retained_v1(),public.research_publication_catalog_v1(),
  public.research_publication_guard_v1(),public.research_publication_v1(text,jsonb) to service_role;
insert into public.research_publication_catalog_seal values(true,public.research_publication_catalog_v1());
-- A new namespace must not invalidate or reseal either predecessor catalog.
select public.anonymous_run_claims_guard_v1();
select public.run_privacy_guard_v1();
select public.research_publication_guard_v1();
commit;

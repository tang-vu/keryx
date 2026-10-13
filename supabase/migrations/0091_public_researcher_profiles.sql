begin;
-- SOURCE ONLY: ordinary capability. No production DDL, native enrollment, privacy activation or backfill.
select public.run_privacy_guard_v1();
select public.private_profiles_ordinary_v1('0x0000000000000000000000000000000000000000');
create table public.public_researcher_profiles (
  wallet text primary key references public.private_profiles(wallet) on delete cascade,
  handle text not null check(handle ~ '^[a-z][a-z0-9_]{2,31}$'), published boolean not null default false,
  fields jsonb not null check(jsonb_typeof(fields)='array' and jsonb_array_length(fields)<=5),
  run_ids jsonb not null check(jsonb_typeof(run_ids)='array' and jsonb_array_length(run_ids)<=50),
  binding jsonb not null, revision integer not null check(revision>=0), updated_at timestamptz not null
);
alter table public.public_researcher_profiles enable row level security;
revoke all on public.public_researcher_profiles from public,anon,authenticated;
grant select,insert,update,delete on public.public_researcher_profiles to service_role;
create policy public_researcher_profiles_service on public.public_researcher_profiles to service_role using(true) with check(true);

-- The existing source-created catalog-seal pattern; no runtime adoption or repair.
create table public.public_researcher_profiles_catalog_seal(singleton boolean primary key check(singleton),snapshot jsonb not null);
alter table public.public_researcher_profiles_catalog_seal enable row level security;
revoke all on public.public_researcher_profiles_catalog_seal from public,anon,authenticated,service_role;
grant select on public.public_researcher_profiles_catalog_seal to service_role;
create policy public_researcher_seal_read on public.public_researcher_profiles_catalog_seal for select to service_role using(true);
create function public.public_researcher_seal_immutable_v1() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin raise exception 'public_profile_unavailable';end; $$;
create trigger public_researcher_seal_immutable before update or delete or truncate on public.public_researcher_profiles_catalog_seal for each statement execute function public.public_researcher_seal_immutable_v1();
create function public.public_researcher_catalog_v1() returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
select jsonb_build_object('relations',(select jsonb_agg(jsonb_build_object('oid',c.oid,'name',c.relname,'kind',c.relkind,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
  'columns',(select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl,a.attgenerated,a.attidentity,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
  'triggers',(select jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled,t.tgfoid) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
  'policies',(select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
  'rules',(select jsonb_agg(pg_get_ruledef(r.oid) order by r.rulename) from pg_rewrite r where r.ev_class=c.oid)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'public_researcher%'),
  'functions',(select jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,pg_get_functiondef(p.oid)) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'public_researcher%'));
$$;
create function public.public_researcher_guard_v1() returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  perform public.run_privacy_guard_v1();
  lock table public.public_researcher_profiles,public.public_researcher_profiles_catalog_seal,public.private_profiles,public.profile_verified_identities in access share mode;
  if (select snapshot from public.public_researcher_profiles_catalog_seal where singleton) is distinct from public.public_researcher_catalog_v1() then raise exception 'public_profile_unavailable';end if;
end; $$;

create function public.public_researcher_settings_v1(who text) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
select jsonb_build_object('handle',coalesce(p.handle,''),'published',coalesce(s.published and s.handle=p.handle,false),
  'fields',coalesce(s.fields,'[]'::jsonb),'runIds',coalesce(s.run_ids,'[]'::jsonb),'revision',coalesce(s.revision,0),
  'updatedAt',case when s.updated_at is null then null else to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end)
from (select who wallet) w left join public.private_profiles p on p.wallet=w.wallet left join public.public_researcher_profiles s on s.wallet=w.wallet;
$$;

create function public.public_researcher_profile_v1(p_action text,p_handle text,p_actor jsonb,p_input jsonb,p_claims boolean default false)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,public as $$
declare who text; session_id text; stamp bigint; profile_row public.private_profiles%rowtype;
  selection public.public_researcher_profiles%rowtype; result jsonb; fields jsonb; ids jsonb; revision integer;
  row record; original jsonb; proof jsonb; owned boolean; claimed boolean; run_sources jsonb:='[]';
  base jsonb; verified jsonb; totals jsonb; target_network text; reader_amount numeric; earned_amount numeric; sponsored_amount numeric;
begin
  perform public.public_researcher_guard_v1();
  if p_action is null or p_action not in ('read','sitemap','settings','update','unpublish') or p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'public_profile_unavailable'; end if;
  if p_action in ('read','settings','unpublish') and p_input<>'{}'::jsonb then raise exception 'public_profile_unavailable'; end if;
  if p_action in ('settings','update','unpublish') then
    if p_handle is not null or p_actor is null or jsonb_typeof(p_actor)<>'object' or (select count(*) from jsonb_object_keys(p_actor))<>3 then raise exception 'unauthenticated'; end if;
    who:=p_actor->>'wallet'; session_id:=p_actor->>'sessionHash';
    if who is null or who !~ '^0x[0-9a-f]{40}$' or session_id is null or session_id !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(p_actor->'binding') is distinct from 'object' then raise exception 'unauthenticated'; end if;
    if (select count(*) from jsonb_object_keys(p_actor->'binding'))<>2
      or not coalesce(p_actor->'binding'->>'network' in ('eip155:5042','eip155:5042002'),false)
      or not coalesce(public.anonymous_run_claim_origin_valid_v1(p_actor->'binding'->>'origin'),false) then raise exception 'unauthenticated'; end if;
    -- Same order as run_privacy mutations: serialize session DELETE before
    -- acquiring owner/profile/original row locks. Never wait on those first.
    if p_action in ('update','unpublish') then lock table public.web_sessions in share mode; end if;
    perform public.private_profiles_ordinary_v1(who);
    select * into profile_row from public.private_profiles where wallet=who for update;
    -- Recheck expiry after waiting for the owner row lock; a revoked session never publishes.
    stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
    perform 1 from public.web_sessions where hash=session_id and wallet=who and issued_at<=stamp and expires_at>stamp;
    if not found then raise exception 'unauthenticated'; end if;
    if p_action='settings' then result:=public.public_researcher_settings_v1(who);
    elsif p_action='unpublish' then
      select * into selection from public.public_researcher_profiles where wallet=who for update;
      if selection.wallet is null and profile_row.handle is null then raise exception 'profile_required'; end if;
      stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
      perform 1 from public.web_sessions where hash=session_id and wallet=who and issued_at<=stamp and expires_at>stamp;
      if not found then raise exception 'unauthenticated'; end if;
      -- A first DELETE must fence a delayed revision0 PUT just like an existing
      -- publication. Never acknowledge an absent row without durable revocation.
      if selection.wallet is null then
        insert into public.public_researcher_profiles values(who,profile_row.handle,false,'[]','[]',p_actor->'binding',1,clock_timestamp());
      else
        update public.public_researcher_profiles s set published=false,revision=least(s.revision::bigint+1,2147483647)::integer,updated_at=clock_timestamp() where s.wallet=who;
      end if;
      result:=jsonb_build_object('unpublished',true);
    else
      if profile_row.handle is null then raise exception 'profile_required'; end if;
      if (select count(*) from jsonb_object_keys(p_input))<>4 or jsonb_typeof(p_input->'published') is distinct from 'boolean'
        or jsonb_typeof(p_input->'fields') is distinct from 'array' or jsonb_typeof(p_input->'runIds') is distinct from 'array'
        or jsonb_typeof(p_input->'revision') is distinct from 'number' then raise exception 'conflict'; end if;
      if jsonb_array_length(p_input->'fields')>5 or jsonb_array_length(p_input->'runIds')>50
        or not coalesce((p_input->>'revision') ~ '^(0|[1-9][0-9]{0,9})$',false)
        or (p_input->>'revision')::numeric>=2147483647 then raise exception 'conflict'; end if;
      fields:=p_input->'fields';ids:=p_input->'runIds';revision:=(p_input->>'revision')::integer;
      if revision>=2147483647 or exists(select 1 from jsonb_array_elements(fields) f where jsonb_typeof(f)<>'string' or f#>>'{}' not in ('displayName','about','purpose','verifiedLinks','ledgers'))
        or exists(select 1 from jsonb_array_elements(ids) i where jsonb_typeof(i)<>'string' or i#>>'{}' !~ '^[A-Za-z0-9_-]{1,128}$')
        or (select count(distinct value) from jsonb_array_elements(fields))<>jsonb_array_length(fields)
        or (select count(distinct value) from jsonb_array_elements(ids))<>jsonb_array_length(ids) then raise exception 'conflict'; end if;
      select * into selection from public.public_researcher_profiles where wallet=who for update;
      if coalesce(selection.revision,0)<>revision then raise exception 'conflict'; end if;
      if (p_input->>'published')::boolean then
        for row in select value#>>'{}' id from jsonb_array_elements(ids) loop
          proof:=public.run_privacy_v1('owner',row.id,'{}',p_actor,p_claims);
          if proof->'result' is null or proof->'result'='null'::jsonb or coalesce((proof->'result'->'state'->>'erased')::boolean,true) then raise exception 'not_owned'; end if;
        end loop;
      end if;
      -- All profile/publication/ownership row waits have finished. SHARE keeps
      -- revocation serialized; a clock_timestamp refresh still rejects expiry.
      stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
      perform 1 from public.web_sessions where hash=session_id and wallet=who and issued_at<=stamp and expires_at>stamp;
      if not found then raise exception 'unauthenticated'; end if;
      -- Nothing here changes query_runs, visibility defaults, claims, identities or payment journals.
      insert into public.public_researcher_profiles values(who,profile_row.handle,(p_input->>'published')::boolean,fields,ids,p_actor->'binding',revision+1,clock_timestamp())
        on conflict(wallet) do update set handle=excluded.handle,published=excluded.published,fields=excluded.fields,run_ids=excluded.run_ids,binding=excluded.binding,revision=excluded.revision,updated_at=excluded.updated_at;
      result:=public.public_researcher_settings_v1(who);
    end if;
  elsif p_action='sitemap' then
    if p_handle is not null or p_actor is not null or (select count(*) from jsonb_object_keys(p_input))<>1 or jsonb_typeof(p_input->'take') is distinct from 'number'
      or not coalesce((p_input->>'take') ~ '^[1-9][0-9]{0,3}$',false) then raise exception 'public_profile_unavailable'; end if;
    if (p_input->>'take')::integer>1000 then raise exception 'public_profile_unavailable'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('handle',s.handle,'updatedAt',to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by s.handle),'[]') into result
      from (select s.handle,s.updated_at from public.public_researcher_profiles s join public.private_profiles p on p.wallet=s.wallet and p.handle=s.handle where s.published order by s.handle limit (p_input->>'take')::integer) s;
  else
    if p_actor is not null or p_handle is null or p_handle !~ '^[a-z][a-z0-9_]{2,31}$' then raise exception 'public_profile_unavailable'; end if;
    select s.* into selection from public.public_researcher_profiles s join public.private_profiles p on p.wallet=s.wallet and p.handle=s.handle
      where s.handle=p_handle and s.published for share of s,p;
    if not found then result:=null;
    else
      who:=selection.wallet;select * into profile_row from public.private_profiles where wallet=who;
      fields:=selection.fields;base:=jsonb_build_object('version',1,'handle',selection.handle,
        'publishedAt',to_char(selection.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'ownershipBasis','signed-wallet-publication-existing-run-proof');
      if fields ? 'displayName' then base:=base||jsonb_build_object('displayName',profile_row.display_name);end if;
      if fields ? 'about' then base:=base||jsonb_build_object('about',profile_row.bio);end if;
      if fields ? 'purpose' then base:=base||jsonb_build_object('purpose',profile_row.purpose);end if;
      if fields ? 'verifiedLinks' then
        perform public.profile_identities_ordinary_v1(who,null);
        select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'label',label,'url',case when provider='github' then 'https://github.com/'||label else 'https://orcid.org/'||external_id end,
          'verifiedAt',to_char(verified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by provider),'[]') into verified from public.profile_verified_identities where wallet=who and external_id is not null;
        base:=base||jsonb_build_object('verifiedLinks',verified);
      end if;
      -- PUBLIC and selection predicates apply before any original text is materialized.
      for row in select q.id,q.asker,q.data from public.query_runs q join public.run_privacy p on p.run_id=q.id
        where p.visibility='public' and not p.erased and selection.run_ids ? q.id order by q.created_at desc,q.id desc limit 50 for share of q,p loop
        original:=row.data::jsonb;owned:=row.asker=who;claimed:=false;
        if row.asker is null and p_claims then
          proof:=public.anonymous_run_claim_history_read_v1(who,selection.binding->>'network',selection.binding->>'origin',row.id);
          claimed:=proof->'item'->'ownership'->>'method'='claimed' and proof->'item'->'run'=original;
          owned:=coalesce(claimed,false);
        end if;
        if not coalesce(owned,false) then continue;end if;
        if jsonb_typeof(original) is distinct from 'object' or original->>'id' is distinct from row.id
          or jsonb_typeof(original->'question') is distinct from 'string' or jsonb_typeof(original->'createdAt') is distinct from 'string'
          or jsonb_typeof(original->'citations') is distinct from 'array' or octet_length(original::text)>4000000 then raise exception 'public_profile_unavailable';end if;
        if row.asker=who and original ? 'asker' and original->>'asker'<>who then raise exception 'public_profile_unavailable';end if;
        -- Closed source packet only; no answer, trace, wallet, nonce, token or private recovery packet.
        original:=jsonb_strip_nulls(jsonb_build_object('id',original->'id','question',original->'question','createdAt',original->'createdAt',
          'provenance',original->'provenance','usage',original->'usage','paymentMode',original->'paymentMode','fundingOwner',original->'fundingOwner','askerFunded',original->'askerFunded',
          'citations',(select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('marker',c->'marker','sourceName',c->'sourceName','itemUrl',c->'itemUrl'))),'[]') from jsonb_array_elements(original->'citations') c)));
        run_sources:=run_sources||jsonb_build_array(jsonb_build_object('source',original,'claimed',claimed,'networks',
          (select coalesce(jsonb_agg(network),'[]') from (select distinct coalesce(network,'unknown') network from public.payment_events where query_id=row.id limit 3) networks)));
      end loop;
      if fields ? 'ledgers' then
        totals:='[]';foreach target_network in array array['eip155:5042','eip155:5042002'] loop
          select case when bool_and(amount_usdc::numeric*1000000=trunc(amount_usdc::numeric*1000000)) then trunc(sum(amount_usdc::numeric*1000000)) when count(*)=0 then 0 else null end into reader_amount
            from public.payment_events e left join public.query_runs q on q.id=e.query_id where e.network=target_network and e.kind in ('fetch','citation') and e.settled=true and e.settlement_status='settled'
              and e.amount_usdc>0 and length(trim(e.tx_hash))>0 and lower(e.payer)=who and coalesce(q.data->>'fundingOwner','') not in ('treasury','offline') and coalesce(q.data->>'paymentMode','')<>'offline';
          select case when bool_and(amount_usdc::numeric*1000000=trunc(amount_usdc::numeric*1000000)) then trunc(sum(amount_usdc::numeric*1000000)) when count(*)=0 then 0 else null end into earned_amount
            from public.payment_events e left join public.query_runs q on q.id=e.query_id where e.network=target_network and e.kind in ('fetch','citation') and e.settled=true and e.settlement_status='settled' and e.amount_usdc>0 and length(trim(e.tx_hash))>0 and lower(e.payee)=who
              and coalesce(q.data->>'fundingOwner','')<>'offline' and coalesce(q.data->>'paymentMode','')<>'offline';
          select case when bool_and(amount_usdc::numeric*1000000=trunc(amount_usdc::numeric*1000000)) then trunc(sum(amount_usdc::numeric*1000000)) when count(*)=0 then 0 else null end into sponsored_amount
            from public.payment_events e join public.query_runs q on q.id=e.query_id where e.network=target_network and e.kind in ('fetch','citation') and e.settled=true and e.settlement_status='settled'
              and e.amount_usdc>0 and length(trim(e.tx_hash))>0 and q.asker=who and q.data->>'fundingOwner'='treasury' and coalesce(q.data->>'paymentMode','')<>'offline';
          totals:=totals||jsonb_build_array(jsonb_build_object('network',target_network,'readerPaidMicros',reader_amount::text,'creatorEarnedMicros',earned_amount::text,'sponsoredCreatorPaymentsMicros',sponsored_amount::text));
        end loop;
        base:=base||jsonb_build_object('ledgers',totals,'ledgerBasis','wallet-wide-recorded-settled-creator-events');
      end if;
      result:=jsonb_build_object('profile',base,'runs',run_sources);
    end if;
  end if;
  return jsonb_build_object('version',1,'action',p_action,'handle',p_handle,'result',result);
end; $$;

revoke all on function public.public_researcher_settings_v1(text),public.public_researcher_profile_v1(text,text,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.public_researcher_settings_v1(text),public.public_researcher_profile_v1(text,text,jsonb,jsonb,boolean) to service_role;
revoke all on function public.public_researcher_seal_immutable_v1(),public.public_researcher_catalog_v1(),public.public_researcher_guard_v1() from public,anon,authenticated;
grant execute on function public.public_researcher_seal_immutable_v1(),public.public_researcher_catalog_v1(),public.public_researcher_guard_v1() to service_role;
insert into public.public_researcher_profiles_catalog_seal values(true,public.public_researcher_catalog_v1());
select public.public_researcher_guard_v1();
commit;

begin;
-- Additive ordinary SOURCE domain only. Never apply to enrolled storage.
do $$ begin
  if to_regclass('keryx_storage.identity') is not null or to_regclass('public.keryx_storage_identity') is not null then
    raise exception 'review_unavailable';
  end if;
end; $$;
create table public.decision_review_records (
  id uuid primary key default gen_random_uuid(), wallet text not null check(wallet ~ '^0x[0-9a-f]{40}$'),
  run_id uuid not null, network text not null check(network in ('eip155:5042','eip155:5042002')),
  created_at timestamptz not null, input_json jsonb not null check(octet_length(input_json::text)<=8192),
  state text not null check(state in ('observed','held','approved','declined','expired','consumed','cancelled')),
  expires_at timestamptz, code_action text not null check(code_action in ('BUY','SKIP','CACHE')),
  code_rule text not null check(code_rule in ('model-skip','selected','public-read','external-only','missing-proposal','discussion','preview','attention','portfolio','terms-changed','duplicate','rights','funding-unavailable','zero-budget','budget','sufficient','assessment-unavailable','not-admitted','cache-expired','cache-selected')), verdict_json jsonb
);
create index decision_review_owner_run on public.decision_review_records(wallet,run_id,created_at,id);
create index decision_review_period on public.decision_review_records(network,created_at);
create table public.decision_review_verdicts (
  wallet text not null check(wallet ~ '^0x[0-9a-f]{40}$'), key uuid not null,
  decision_id uuid not null references public.decision_review_records(id), input_json jsonb not null,
  primary key(wallet,key)
);
alter table public.decision_review_records enable row level security;
alter table public.decision_review_verdicts enable row level security;
-- Trusted ordinary server role only; no reliance on a global BYPASSRLS flag.
create policy decision_review_records_service_v1 on public.decision_review_records for all to service_role using (true) with check (true);
create policy decision_review_verdicts_service_v1 on public.decision_review_verdicts for all to service_role using (true) with check (true);
revoke all on public.decision_review_records,public.decision_review_verdicts from public,anon,authenticated;
grant select,insert,update on public.decision_review_records,public.decision_review_verdicts to service_role;

create function public.decision_review_ordinary_v1() returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if to_regclass('keryx_storage.identity') is not null or to_regclass('public.keryx_storage_identity') is not null then
    raise exception 'review_unavailable';
  end if;
end; $$;
-- Match shared Zod limits: a non-BMP scalar occupies two UTF-16 code units.
-- PostgreSQL UTF8 text/JSON already refuses unpaired surrogate input.
create function public.decision_review_text_units_v1(v text) returns integer
language sql immutable strict security invoker set search_path=pg_catalog,public as $$
  select coalesce(sum(case when ascii(substr(v,n,1))>65535 then 2 else 1 end),0)::integer from generate_series(1,char_length(v)) n;
$$;
create function public.decision_review_keys_v1(v jsonb,required text[],optional text[] default '{}') returns boolean
language sql immutable security invoker set search_path=pg_catalog,public as $$
  select coalesce(jsonb_typeof(v)='object' and v ?& required and not exists(select 1 from jsonb_object_keys(v) k where not(k=any(required || optional))),false);
$$;
create function public.decision_review_terms_v1(v jsonb) returns boolean
language plpgsql immutable security invoker set search_path=pg_catalog,public as $$
declare k text; begin
  if not public.decision_review_keys_v1(v,array['assetId','sourceId','owned','network','priceMicroUsdc','listPriceMicroUsdc','citationBudgetMicroUsdc'],array['payTo','itemId','contentVersion','offerId','claimDigest']) then return false; end if;
  if (jsonb_typeof(v->'owned')='boolean' and v->>'network' in ('eip155:5042','eip155:5042002')) is distinct from true then return false; end if;
  if (v ? 'payTo' or v->>'owned'='true') and (jsonb_typeof(v->'payTo')='string' and v->>'payTo' ~ '^0x[0-9a-f]{40}$') is distinct from true then return false; end if;
  foreach k in array array['priceMicroUsdc','listPriceMicroUsdc','citationBudgetMicroUsdc'] loop
    if (jsonb_typeof(v->k)='string' and v->>k ~ '^(0|[1-9][0-9]{0,15})$') is distinct from true then return false; end if;
    if (v->>k)::numeric>9007199254740991 then return false; end if;
  end loop;
  foreach k in array array['assetId','sourceId','itemId','contentVersion','offerId'] loop
    if (k in ('assetId','sourceId') or v ? k) and (jsonb_typeof(v->k)='string' and public.decision_review_text_units_v1(v->>k) between 1 and 256 and v->>k !~ '[\x01-\x1f\x7f]') is distinct from true then return false; end if;
  end loop;
  if v ? 'claimDigest' and (jsonb_typeof(v->'claimDigest')='string' and v->>'claimDigest' ~ '^[0-9a-f]{64}$') is distinct from true then return false; end if;
  return true;
end; $$;

create function public.decision_review_record_v1(p_id uuid,p_wallet text) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare r public.decision_review_records%rowtype; begin
  perform public.decision_review_ordinary_v1();
  select * into r from public.decision_review_records where id=p_id and wallet=p_wallet;
  if not found then return null; end if;
  return r.input_json || jsonb_build_object('id',r.id,'createdAt',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',case when r.expires_at is null then null else to_char(r.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'state',r.state,'initialCodeAction',r.input_json->'codeAction','initialCodeRule',r.input_json->'codeRule','codeAction',r.code_action,'codeRule',r.code_rule,'verdict',r.verdict_json);
end; $$;

create function public.decision_reviews_v1(p_operation text,p_wallet text,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.decision_review_records%rowtype; prior public.decision_review_verdicts%rowtype;
  now_at timestamptz; v_id uuid; terms jsonb; result jsonb; since_at timestamptz; until_at timestamptz;
  rules constant text[]:=array['model-skip','selected','public-read','external-only','missing-proposal','discussion','preview','attention','portfolio','terms-changed','duplicate','rights','funding-unavailable','zero-budget','budget','sufficient','assessment-unavailable','not-admitted','cache-expired','cache-selected'];
begin
  perform public.decision_review_ordinary_v1();
  if p_operation is null or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>8192 or
    (p_operation not in ('metrics','ready') and (p_wallet is null or p_wallet !~ '^0x[0-9a-f]{40}$')) then raise exception 'review_unavailable'; end if;
  if p_operation='ready' then
    if p_wallet is not null or p_input<>'{}'::jsonb then raise exception 'review_unavailable'; end if;
    perform 1 from public.decision_review_records limit 0; perform 1 from public.decision_review_verdicts limit 0;
    return '{"ready":true}'::jsonb;
  elsif p_operation in ('list','cancel') then
    if not public.decision_review_keys_v1(p_input,array['runId']) or (jsonb_typeof(p_input->'runId')='string' and p_input->>'runId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') is distinct from true then raise exception 'review_unavailable'; end if;
  elsif p_operation in ('read','begin','expire') then
    if not public.decision_review_keys_v1(p_input,array['id']) then raise exception 'review_unavailable'; end if;
  elsif p_operation='consume' then
    if not public.decision_review_keys_v1(p_input,array['id','terms']) or not public.decision_review_terms_v1(p_input->'terms') then raise exception 'review_unavailable'; end if;
  elsif p_operation='observe' then
    if not public.decision_review_keys_v1(p_input,array['id','action','rule']) or (p_input->>'action' in ('BUY','SKIP','CACHE') and p_input->>'rule'=any(rules)) is distinct from true then raise exception 'review_unavailable'; end if;
  elsif p_operation='verdict' then
    if not public.decision_review_keys_v1(p_input,array['id','key','context','value'],array['reason','expectedCode']) or
      (jsonb_typeof(p_input->'key')='string' and p_input->>'key' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and p_input->>'context' in ('gate','opinion') and p_input->>'value' in ('agree','disagree')) is distinct from true or
      (p_input ? 'reason' and (jsonb_typeof(p_input->'reason')='string' and public.decision_review_text_units_v1(p_input->>'reason')<=1000 and p_input->>'reason' !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' and p_input->>'reason'=btrim(p_input->>'reason',U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')) is distinct from true) then raise exception 'review_unavailable'; end if;
    if p_input->>'context'='opinion' then
      if not public.decision_review_keys_v1(p_input->'expectedCode',array['action','rule']) or
        (p_input->'expectedCode'->>'action' in ('BUY','SKIP','CACHE') and p_input->'expectedCode'->>'rule'=any(rules)) is distinct from true then raise exception 'review_unavailable'; end if;
    elsif p_input ? 'expectedCode' then raise exception 'review_unavailable'; end if;
  elsif p_operation not in ('capture','metrics') then raise exception 'review_unavailable'; end if;
  if p_operation in ('read','begin','expire','consume','observe','verdict') and (jsonb_typeof(p_input->'id')='string' and p_input->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') is distinct from true then raise exception 'review_unavailable'; end if;
  if p_operation='capture' then
    if not public.decision_review_keys_v1(p_input,array['policyVersion','engine','requestedModel','runId','round','ordinal','sourceName','modelAction','codeAction','codeRule','terms','reviewFirst','cohort','cohortEvidence']) or
      (jsonb_typeof(p_input->'round')='number' and (p_input->>'round') ~ '^[0-8]$' and jsonb_typeof(p_input->'ordinal')='number' and (p_input->>'ordinal') ~ '^[0-9]{1,3}$' and
      jsonb_typeof(p_input->'sourceName')='string' and public.decision_review_text_units_v1(p_input->>'sourceName') between 1 and 256 and
      (p_input->'modelAction'='null'::jsonb or p_input->>'modelAction' in ('BUY','SKIP','CACHE')) and p_input->>'codeAction' in ('BUY','SKIP','CACHE') and p_input->>'codeRule'=any(rules) and
      jsonb_typeof(p_input->'reviewFirst')='boolean' and p_input->>'cohort' in ('outside','team','scripted','unknown') and
      p_input->>'policyVersion'='captured-owner-decisions-v1' and jsonb_typeof(p_input->'engine')='string' and public.decision_review_text_units_v1(p_input->>'engine') between 1 and 256 and p_input->>'engine' !~ '[\x01-\x1f\x7f]' and
      (p_input->'requestedModel'='null'::jsonb or (jsonb_typeof(p_input->'requestedModel')='string' and public.decision_review_text_units_v1(p_input->>'requestedModel') between 1 and 256 and p_input->>'requestedModel' !~ '[\x01-\x1f\x7f]')) and
      ((p_input->>'cohort'='unknown' and p_input->'cohortEvidence'='null'::jsonb) or
       (p_input->>'cohort'<>'unknown' and jsonb_typeof(p_input->'cohortEvidence')='string' and public.decision_review_text_units_v1(p_input->>'cohortEvidence') between 1 and 256 and p_input->>'cohortEvidence' !~ '[\x01-\x1f\x7f]'))) is distinct from true then raise exception 'review_unavailable'; end if;
    if (jsonb_typeof(p_input->'runId')='string' and p_input->>'runId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') is distinct from true then raise exception 'review_unavailable'; end if;
    terms:=p_input->'terms'; if not public.decision_review_terms_v1(terms) then raise exception 'review_unavailable'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_wallet || ':' || (p_input->>'runId'),0));
    if (select count(*) from public.decision_review_records where wallet=p_wallet and run_id=(p_input->>'runId')::uuid)>=300 then raise exception 'review_unavailable'; end if;
    now_at:=date_trunc('milliseconds',clock_timestamp());
    insert into public.decision_review_records(wallet,run_id,network,created_at,input_json,state,expires_at,code_action,code_rule)
      values(p_wallet,(p_input->>'runId')::uuid,terms->>'network',now_at,p_input,'observed',null,p_input->>'codeAction',p_input->>'codeRule') returning id into v_id;
    return public.decision_review_record_v1(v_id,p_wallet);
  elsif p_operation='list' then
    if (select count(*) from public.decision_review_records where wallet=p_wallet and run_id=(p_input->>'runId')::uuid)>300 then raise exception 'review_unavailable'; end if;
    return coalesce((select jsonb_agg(public.decision_review_record_v1(id,p_wallet) order by created_at,id) from public.decision_review_records where wallet=p_wallet and run_id=(p_input->>'runId')::uuid),'[]'::jsonb);
  elsif p_operation='cancel' then
    update public.decision_review_records set state='cancelled' where wallet=p_wallet and run_id=(p_input->>'runId')::uuid and (state in ('held','approved') or (state='observed' and input_json->>'reviewFirst'='true' and input_json->'terms'->>'owned'='true' and code_action<>'SKIP')); return '{"cancelled":true}'::jsonb;
  elsif p_operation='metrics' then
    if p_wallet is not null or not public.decision_review_keys_v1(p_input,array['network','since','until']) or
      (p_input->>'network' in ('eip155:5042','eip155:5042002') and jsonb_typeof(p_input->'since')='string' and jsonb_typeof(p_input->'until')='string' and
        p_input->>'since' ~ '^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$' and p_input->>'until' ~ '^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$') is distinct from true then raise exception 'review_unavailable'; end if;
    since_at:=(p_input->>'since')::timestamptz; until_at:=(p_input->>'until')::timestamptz;
    if not isfinite(since_at) or not isfinite(until_at) or since_at>=until_at or until_at-since_at>interval '366 days' or
      to_char(since_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>p_input->>'since' or to_char(until_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>p_input->>'until' then raise exception 'review_unavailable'; end if;
    select jsonb_build_object('network',p_input->>'network','since',p_input->>'since','until',p_input->>'until','rule','captured-owner-decisions-v1','cohorts',jsonb_agg(packet order by position)) into result
    from (select position,jsonb_build_object('cohort',cohort,'decisions',count(metric.id),'agrees',count(metric.id) filter(where metric.verdict_json->>'value'='agree'),
      'disagrees',count(metric.id) filter(where metric.verdict_json->>'value'='disagree'),
      'agreementRate',case when count(metric.id) filter(where metric.verdict_json->>'value' in ('agree','disagree'))=0 then null else
        (count(metric.id) filter(where metric.verdict_json->>'value'='agree'))::numeric/(count(metric.id) filter(where metric.verdict_json->>'value' in ('agree','disagree'))) end,
      'modelCodeDifferences',count(metric.id) filter(where metric.input_json->>'modelAction' is not null and metric.input_json->>'modelAction'<>metric.code_action),
      'codeRefusals',count(metric.id) filter(where metric.code_action='SKIP' and metric.code_rule<>'model-skip'),
      'refusalReasons',coalesce((select jsonb_object_agg(code_rule,n) from (select code_rule,count(*) n from public.decision_review_records rr where rr.network=p_input->>'network' and rr.created_at>=since_at and rr.created_at<until_at and rr.input_json->>'cohort'=cohort and rr.code_action='SKIP' and rr.code_rule<>'model-skip' group by code_rule) reasons),'{}'::jsonb)) packet
      from (values(0,'outside'),(1,'team'),(2,'scripted'),(3,'unknown')) categories(position,cohort)
      left join public.decision_review_records metric on metric.input_json->>'cohort'=cohort and metric.network=p_input->>'network' and metric.created_at>=since_at and metric.created_at<until_at group by position,cohort) columns;
    return result;
  end if;
  if p_operation='verdict' then
    perform pg_advisory_xact_lock(hashtextextended(p_wallet || ':' || (p_input->>'key'),0));
    select * into prior from public.decision_review_verdicts where wallet=p_wallet and key=(p_input->>'key')::uuid;
    if found then if prior.input_json<>p_input then raise exception 'review_conflict'; end if; return public.decision_review_record_v1(prior.decision_id,p_wallet); end if;
  end if;
  v_id:=(p_input->>'id')::uuid;
  select * into r from public.decision_review_records where wallet=p_wallet and id=v_id for update;
  if not found then if p_operation='read' then return null; end if; raise exception 'review_not_found'; end if;
  now_at:=date_trunc('milliseconds',clock_timestamp());
  if p_operation='begin' then
    if r.state<>'observed' or r.expires_at is not null or r.verdict_json is not null or r.input_json->>'reviewFirst'<>'true' or r.input_json->'terms'->>'owned'<>'true' or r.code_action='SKIP' then raise exception 'review_conflict'; end if;
    update public.decision_review_records set state='held',expires_at=now_at+interval '60 seconds' where id=v_id;
  elsif p_operation='verdict' then
    if p_input->>'context'='gate' then
      if r.state<>'held' then raise exception 'review_conflict'; end if;
      if r.expires_at is null or r.expires_at<=now_at then raise exception 'review_expired'; end if;
      update public.decision_review_records set state=case when p_input->>'value'='agree' then 'approved' else 'declined' end where id=v_id;
    elsif r.state in ('held','approved') or p_input->'expectedCode'->>'action' is distinct from r.code_action or p_input->'expectedCode'->>'rule' is distinct from r.code_rule then raise exception 'review_conflict'; end if;
    update public.decision_review_records set verdict_json=jsonb_build_object('value',p_input->>'value','context',p_input->>'context',
      'codeAction',case when p_input->>'context'='gate' then r.input_json->>'codeAction' else r.code_action end,
      'codeRule',case when p_input->>'context'='gate' then r.input_json->>'codeRule' else r.code_rule end,
      'createdAt',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || case when p_input ? 'reason' then jsonb_build_object('reason',p_input->>'reason') else '{}'::jsonb end where id=v_id;
    insert into public.decision_review_verdicts values(p_wallet,(p_input->>'key')::uuid,v_id,p_input);
  elsif p_operation='consume' then
    if r.state<>'approved' or r.input_json->'terms' is distinct from p_input->'terms' then raise exception 'review_conflict'; end if;
    if r.expires_at is null or r.expires_at<=now_at then raise exception 'review_expired'; end if;
    update public.decision_review_records set state='consumed' where id=v_id;
  elsif p_operation='expire' then
    update public.decision_review_records set state='expired' where id=v_id and state in ('held','approved') and expires_at<=now_at;
  elsif p_operation='observe' then
    if p_input->>'action' not in ('BUY','SKIP','CACHE') then raise exception 'review_unavailable'; end if;
    update public.decision_review_records set code_action=p_input->>'action',code_rule=p_input->>'rule',
      state=case when p_input->>'action'='SKIP' and state in ('observed','held','approved') and input_json->>'reviewFirst'='true' and input_json->'terms'->>'owned'='true' then 'cancelled' else state end where id=v_id;
  elsif p_operation<>'read' then raise exception 'review_unavailable'; end if;
  return public.decision_review_record_v1(v_id,p_wallet);
end; $$;
revoke all on function public.decision_review_record_v1(uuid,text),public.decision_reviews_v1(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.decision_review_record_v1(uuid,text),public.decision_reviews_v1(text,text,jsonb) to service_role;
revoke all on function public.decision_review_ordinary_v1(),public.decision_review_text_units_v1(text),public.decision_review_keys_v1(jsonb,text[],text[]),public.decision_review_terms_v1(jsonb) from public,anon,authenticated;
grant execute on function public.decision_review_ordinary_v1(),public.decision_review_text_units_v1(text),public.decision_review_keys_v1(jsonb,text[],text[]),public.decision_review_terms_v1(jsonb) to service_role;
commit;

begin;
-- SOURCE ONLY. Explicit ordinary migration; no target DDL, activation or native enrollment.
create function public.anonymous_run_claims_ordinary_v1() returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if to_regclass('keryx_storage.identity') is not null or to_regclass('public.keryx_storage_identity') is not null then
    raise exception 'claims_unavailable';
  end if;
end; $$;
select public.anonymous_run_claims_ordinary_v1();
create table public.anonymous_run_claims (
  run_id text primary key check(run_id ~ '^[A-Za-z0-9_-]{1,128}$' and run_id not like 'prv\_%' escape '\' and run_id not like 'a2a\_%' escape '\'),
  network text not null check(network in ('eip155:5042','eip155:5042002')),
  origin text not null check(length(origin) between 1 and 2048),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  original_sha256 text not null check(original_sha256 ~ '^[a-f0-9]{64}$'),
  completed_at text not null,
  issued_at bigint not null check(issued_at between 0 and 8639999913600000),
  expires_at bigint not null check(expires_at=issued_at+86400000),
  claimed_wallet text check(claimed_wallet is null or claimed_wallet ~ '^0x[a-f0-9]{40}$'),
  claimed_at bigint check(claimed_at is null or (claimed_at>=issued_at and claimed_at<expires_at)),
  check((claimed_wallet is null)=(claimed_at is null))
);
create index anonymous_run_claims_owner on public.anonymous_run_claims(claimed_wallet,run_id);
create function public.anonymous_run_claims_immutable_v1() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if TG_OP='INSERT' then
    if new.claimed_wallet is not null or new.claimed_at is not null then raise exception 'claim_unavailable'; end if;
    return new;
  elsif TG_OP='DELETE' then raise exception 'claim_unavailable';
  elsif old.claimed_wallet is not null or new.claimed_wallet is null or new.claimed_at is null
    or to_jsonb(new)-'claimed_wallet'-'claimed_at'<>to_jsonb(old)-'claimed_wallet'-'claimed_at' then
    raise exception 'claim_unavailable';
  end if;
  return new;
end; $$;
create trigger anonymous_run_claims_immutable before insert or update or delete on public.anonymous_run_claims
  for each row execute function public.anonymous_run_claims_immutable_v1();
alter table public.anonymous_run_claims enable row level security;
revoke all on public.anonymous_run_claims from public,anon,authenticated;
grant select,insert on public.anonymous_run_claims to service_role;
grant update(claimed_wallet,claimed_at) on public.anonymous_run_claims to service_role;
create policy anonymous_run_claims_service_read on public.anonymous_run_claims for select to service_role using(true);
create policy anonymous_run_claims_service_insert on public.anonymous_run_claims for insert to service_role with check(claimed_wallet is null and claimed_at is null);
create policy anonymous_run_claims_service_consume on public.anonymous_run_claims for update to service_role
  using(claimed_wallet is null) with check(claimed_wallet is not null and claimed_at is not null);

create function public.anonymous_run_claims_ready_v1() returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  perform public.anonymous_run_claims_ordinary_v1();
  perform run_id,token_hash,original_sha256,completed_at,issued_at,expires_at,claimed_wallet,claimed_at
    from public.anonymous_run_claims limit 0;
  return '{"version":1,"ready":true}'::jsonb;
end; $$;
create function public.anonymous_run_claim_original_v1(p_run_id text,p_completed_at text) returns text
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare q public.query_runs%rowtype;
begin
  perform public.anonymous_run_claims_ordinary_v1();
  select * into q from public.query_runs where id=p_run_id for share;
  if not found or q.asker is not null or jsonb_typeof(q.data) is distinct from 'object'
    or q.data->>'id' is distinct from p_run_id or q.data->>'createdAt' is distinct from p_completed_at
    or q.data ? 'asker' or q.data ? 'originalFulfillment' or q.data->'askerFunded'='true'::jsonb
    or q.data->>'fundingOwner'='browser' or q.created_at is distinct from p_completed_at::timestamptz
    or octet_length(q.data::text)>4000000
    or exists(select 1 from public.a2a_orders where query_id=p_run_id) then raise exception 'claim_unavailable'; end if;
  return encode(sha256(convert_to(q.data::text,'UTF8')),'hex');
end; $$;
create function public.anonymous_run_claim_issue_v1(p_run_id text,p_token_hash text,p_completed_at text,p_network text,p_origin text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare stamp bigint; fingerprint text;
begin
  perform public.anonymous_run_claims_ordinary_v1();
  if p_run_id is null or p_run_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_run_id like 'prv\_%' escape '\' or p_run_id like 'a2a\_%' escape '\'
    or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_network is null or p_network not in ('eip155:5042','eip155:5042002')
    or p_origin is null or octet_length(p_origin)>2048 or p_origin !~ '^https?://[^/@?#[:space:]]+$'
    or p_completed_at is null or p_completed_at !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    then raise exception 'claim_unavailable'; end if;
  fingerprint:=public.anonymous_run_claim_original_v1(p_run_id,p_completed_at);
  stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if stamp<0 or stamp>8639999913600000 or p_completed_at::timestamptz>clock_timestamp()
    or exists(select 1 from public.anonymous_run_claims where run_id=p_run_id or token_hash=p_token_hash)
    then raise exception 'claim_unavailable'; end if;
  begin
    insert into public.anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at)
      values(p_run_id,p_network,p_origin,p_token_hash,fingerprint,p_completed_at,stamp,stamp+86400000);
  exception when unique_violation then raise exception 'claim_unavailable'; end;
  return jsonb_build_object('version',1,'runId',p_run_id,'binding',jsonb_build_object('network',p_network,'origin',p_origin),
    'issuedAt',to_char(to_timestamp(stamp/1000.0) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(to_timestamp((stamp+86400000)/1000.0) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end; $$;
create function public.anonymous_run_claim_consume_v1(p_token_hash text,p_wallet text,p_session_hash text,p_network text,p_origin text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare session_issued bigint; session_expires bigint; stamp bigint; c public.anonymous_run_claims%rowtype; fingerprint text;
begin
  perform public.anonymous_run_claims_ordinary_v1();
  if p_wallet is null or p_wallet !~ '^0x[a-f0-9]{40}$' or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$'
    then raise exception 'claim_unauthenticated'; end if;
  -- Share lock prevents revocation/owner replacement until this transaction commits.
  select issued_at,expires_at into session_issued,session_expires from public.web_sessions
    where hash=p_session_hash and wallet=p_wallet for share;
  if not found then raise exception 'claim_unauthenticated'; end if;
  stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if session_issued>stamp or session_expires<=stamp then raise exception 'claim_unauthenticated'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_network is null or p_network not in ('eip155:5042','eip155:5042002')
    or p_origin is null or octet_length(p_origin)>2048 or p_origin !~ '^https?://[^/@?#[:space:]]+$' then raise exception 'claim_unavailable'; end if;
  select * into c from public.anonymous_run_claims where token_hash=p_token_hash and network=p_network and origin=p_origin for update;
  if not found or c.claimed_wallet is not null then raise exception 'claim_unavailable'; end if;
  fingerprint:=public.anonymous_run_claim_original_v1(c.run_id,c.completed_at);
  -- Refresh time after either claim/original lock wait, rather than accepting an old clock.
  stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if session_issued>stamp or session_expires<=stamp then raise exception 'claim_unauthenticated'; end if;
  if c.issued_at>stamp or c.expires_at<=stamp or c.original_sha256 is distinct from fingerprint then raise exception 'claim_unavailable'; end if;
  update public.anonymous_run_claims set claimed_wallet=p_wallet,claimed_at=stamp where run_id=c.run_id and claimed_wallet is null;
  if not found then raise exception 'claim_unavailable'; end if;
  return jsonb_build_object('version',1,'runId',c.run_id,'wallet',p_wallet,'binding',jsonb_build_object('network',p_network,'origin',p_origin),
    'claimedAt',to_char(to_timestamp(stamp/1000.0) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end; $$;
revoke all on function public.anonymous_run_claims_ordinary_v1(),public.anonymous_run_claims_immutable_v1(),public.anonymous_run_claims_ready_v1(),
  public.anonymous_run_claim_original_v1(text,text),public.anonymous_run_claim_issue_v1(text,text,text,text,text),
  public.anonymous_run_claim_consume_v1(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.anonymous_run_claims_ordinary_v1(),public.anonymous_run_claims_ready_v1(),public.anonymous_run_claim_original_v1(text,text),
  public.anonymous_run_claim_issue_v1(text,text,text,text,text),public.anonymous_run_claim_consume_v1(text,text,text,text,text) to service_role;
commit;

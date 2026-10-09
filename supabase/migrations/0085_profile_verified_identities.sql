begin;
-- Additive ordinary SOURCE domain only. No sealed schema/enrollment refresh or production DDL.
do $$ begin
  perform public.private_profiles_ordinary_v1('0x0000000000000000000000000000000000000000');
end; $$;

create table public.profile_verified_identities (
  wallet text not null references public.private_profiles(wallet) on delete cascade,
  provider text not null check(provider in ('orcid','github')),
  external_id text, label text, verified_at timestamptz,
  current_state_hash text check(current_state_hash is null or current_state_hash ~ '^[0-9a-f]{64}$'),
  primary key(wallet,provider), unique(provider,external_id),
  check((external_id is null and label is null and verified_at is null) or
    (external_id is not null and char_length(external_id) between 1 and 32 and label is not null and char_length(label)<=160 and verified_at is not null))
);
create table public.profile_identity_challenges (
  state_hash text primary key check(state_hash ~ '^[0-9a-f]{64}$'),
  wallet text not null, provider text not null,
  session_hash text not null check(session_hash ~ '^[0-9a-f]{64}$'),
  expires_at bigint not null check(expires_at>=0),
  status text not null check(status in ('pending','consumed')),
  unique(wallet,provider),
  foreign key(wallet,provider) references public.profile_verified_identities(wallet,provider) on delete cascade
);
alter table public.profile_verified_identities enable row level security;
alter table public.profile_identity_challenges enable row level security;
revoke all on public.profile_verified_identities,public.profile_identity_challenges from public,anon,authenticated;
grant select,insert,update,delete on public.profile_verified_identities,public.profile_identity_challenges to service_role;

create function public.profile_identities_ordinary_v1(p_wallet text,p_provider text default null) returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  perform public.private_profiles_ordinary_v1(p_wallet);
  if p_provider is not null and p_provider not in ('orcid','github') then raise exception 'identity_unavailable'; end if;
end; $$;

-- Row locks serialize starts/completions/unlinks/profile deletion and durable session revocation.
-- Read wall-clock time AFTER acquiring locks; a blocked request cannot reuse an earlier deadline.
create function public.profile_identity_active_v1(p_wallet text,p_provider text,p_state_hash text,p_session_hash text,p_expires_at timestamptz) returns bigint
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare session_row public.web_sessions%rowtype; now_ms bigint; deadline bigint;
begin
  perform public.profile_identities_ordinary_v1(p_wallet,p_provider);
  if p_provider is null or p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' or
    p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' or p_expires_at is null or not isfinite(p_expires_at) then
    raise exception 'identity_expired';
  end if;
  perform 1 from public.private_profiles where wallet=p_wallet for update;
  if not found then raise exception 'profile_required'; end if;
  select * into session_row from public.web_sessions where hash=p_session_hash and wallet=p_wallet for update;
  now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  deadline:=floor(extract(epoch from p_expires_at)*1000)::bigint;
  if not found or session_row.issued_at>now_ms or session_row.expires_at<=now_ms or
    deadline<=now_ms or deadline>session_row.expires_at then raise exception 'identity_expired'; end if;
  return now_ms;
end; $$;

create function public.profile_identities_list_v1(p_wallet text) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
  perform public.profile_identities_ordinary_v1(p_wallet);
  return jsonb_build_object('wallet',p_wallet,'identities',coalesce((select jsonb_agg(jsonb_build_object(
    'wallet',wallet,'provider',provider,'externalId',external_id,'label',label,
    'verifiedAt',to_char(verified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by provider)
    from public.profile_verified_identities where wallet=p_wallet and external_id is not null),'[]'::jsonb));
end; $$;

create function public.profile_identity_begin_v1(p_wallet text,p_provider text,p_state_hash text,p_session_hash text,p_expires_at timestamptz) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  perform public.profile_identity_active_v1(p_wallet,p_provider,p_state_hash,p_session_hash,p_expires_at);
  if exists(select 1 from public.profile_identity_challenges where state_hash=p_state_hash) then raise exception 'identity_expired'; end if;
  -- Caller generates fresh cryptographic state; older lineages are invalidated, not retained indefinitely.
  delete from public.profile_identity_challenges where wallet=p_wallet and provider=p_provider;
  insert into public.profile_verified_identities(wallet,provider,current_state_hash) values(p_wallet,p_provider,p_state_hash)
    on conflict(wallet,provider) do update set current_state_hash=excluded.current_state_hash;
  insert into public.profile_identity_challenges(state_hash,wallet,provider,session_hash,expires_at,status)
    values(p_state_hash,p_wallet,p_provider,p_session_hash,floor(extract(epoch from p_expires_at)*1000)::bigint,'pending');
  return '{"begun":true}'::jsonb;
end; $$;

create function public.profile_identity_consume_v1(p_wallet text,p_provider text,p_state_hash text,p_session_hash text,p_expires_at timestamptz) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  perform public.profile_identity_active_v1(p_wallet,p_provider,p_state_hash,p_session_hash,p_expires_at);
  perform 1 from public.profile_identity_challenges c join public.profile_verified_identities l
    on l.wallet=c.wallet and l.provider=c.provider and l.current_state_hash=c.state_hash
    where c.state_hash=p_state_hash and c.wallet=p_wallet and c.provider=p_provider and c.session_hash=p_session_hash
      and c.expires_at=floor(extract(epoch from p_expires_at)*1000)::bigint and c.status='pending' for update of c,l;
  if not found then raise exception 'identity_expired'; end if;
  update public.profile_identity_challenges set status='consumed' where state_hash=p_state_hash;
  return '{"consumed":true}'::jsonb;
end; $$;

create function public.profile_identity_complete_v1(p_wallet text,p_provider text,p_state_hash text,p_session_hash text,p_expires_at timestamptz,p_identity jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare external_id text; label text; verified_at timestamptz; digits text; total integer:=0; checksum integer; i integer;
begin
  perform public.profile_identity_active_v1(p_wallet,p_provider,p_state_hash,p_session_hash,p_expires_at);
  perform 1 from public.profile_identity_challenges c join public.profile_verified_identities l
    on l.wallet=c.wallet and l.provider=c.provider and l.current_state_hash=c.state_hash
    where c.state_hash=p_state_hash and c.wallet=p_wallet and c.provider=p_provider and c.session_hash=p_session_hash
      and c.expires_at=floor(extract(epoch from p_expires_at)*1000)::bigint and c.status='consumed' for update of c,l;
  if not found then raise exception 'identity_expired'; end if;
  if p_identity is null or jsonb_typeof(p_identity)<>'object' or
    (select count(*) from jsonb_object_keys(p_identity))<>3 or p_identity->>'provider' is distinct from p_provider or
    jsonb_typeof(p_identity->'provider') is distinct from 'string' or jsonb_typeof(p_identity->'externalId') is distinct from 'string' or
    jsonb_typeof(p_identity->'label') is distinct from 'string' then raise exception 'identity_unavailable'; end if;
  external_id:=p_identity->>'externalId'; label:=p_identity->>'label';
  if char_length(label)+(select count(*) from regexp_matches(label,U&'[\+010000-\+10FFFF]','g'))>160 or
    label ~ '[[:cntrl:]]' or label ~ U&'[\0080-\009F\00AD\0600-\0605\061C\06DD\070F\0890-\0891\08E2\180E\200B-\200F\2028-\202E\2060-\2064\2066-\206F\FEFF\FFF9-\FFFB\+0110BD\+0110CD\+013430-\+01343F\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0001\+0E0020-\+0E007F]' then
    raise exception 'identity_unavailable'; end if;
  if p_provider='github' then
    if external_id !~ '^[1-9][0-9]{0,19}$' or label !~ '^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$' then raise exception 'identity_unavailable'; end if;
  else
    if external_id !~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$' then raise exception 'identity_unavailable'; end if;
    digits:=replace(external_id,'-','');
    for i in 1..15 loop total:=(total+substring(digits from i for 1)::integer)*2; end loop;
    checksum:=(12-total%11)%11;
    if substring(digits from 16 for 1)<>(case when checksum=10 then 'X' else checksum::text end) then raise exception 'identity_unavailable'; end if;
  end if;
  verified_at:=date_trunc('milliseconds',clock_timestamp());
  -- UPDATE only: an unlinked/deleted lineage must never be recreated by a callback.
  update public.profile_verified_identities l set external_id=profile_identity_complete_v1.external_id,label=profile_identity_complete_v1.label,
    verified_at=profile_identity_complete_v1.verified_at,current_state_hash=null
    where wallet=p_wallet and provider=p_provider and current_state_hash=p_state_hash;
  if not found then raise exception 'identity_expired'; end if;
  -- A different wallet's UNIQUE-index transaction may have blocked the update.
  -- Recheck after that wait; failure rolls the provisional write and lineage clear back.
  verified_at:=timestamptz 'epoch'+public.profile_identity_active_v1(p_wallet,p_provider,p_state_hash,p_session_hash,p_expires_at)*interval '1 millisecond';
  update public.profile_verified_identities l set verified_at=profile_identity_complete_v1.verified_at where wallet=p_wallet and provider=p_provider;
  return jsonb_build_object('wallet',p_wallet,'provider',p_provider,'externalId',external_id,'label',label,
    'verifiedAt',to_char(verified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end; $$;

create function public.profile_identity_unlink_v1(p_wallet text,p_provider text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  perform public.profile_identities_ordinary_v1(p_wallet,p_provider);
  if p_provider is null then raise exception 'identity_unavailable'; end if;
  perform 1 from public.private_profiles where wallet=p_wallet for update;
  delete from public.profile_verified_identities where wallet=p_wallet and provider=p_provider;
  return '{"unlinked":true}'::jsonb;
end; $$;

revoke all on function public.profile_identities_ordinary_v1(text,text),public.profile_identity_active_v1(text,text,text,text,timestamptz),
  public.profile_identities_list_v1(text),public.profile_identity_begin_v1(text,text,text,text,timestamptz),
  public.profile_identity_consume_v1(text,text,text,text,timestamptz),public.profile_identity_complete_v1(text,text,text,text,timestamptz,jsonb),
  public.profile_identity_unlink_v1(text,text) from public,anon,authenticated;
grant execute on function public.profile_identities_ordinary_v1(text,text),public.profile_identity_active_v1(text,text,text,text,timestamptz),
  public.profile_identities_list_v1(text),public.profile_identity_begin_v1(text,text,text,text,timestamptz),
  public.profile_identity_consume_v1(text,text,text,text,timestamptz),public.profile_identity_complete_v1(text,text,text,text,timestamptz,jsonb),
  public.profile_identity_unlink_v1(text,text) to service_role;
commit;

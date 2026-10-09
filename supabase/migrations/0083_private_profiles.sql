begin;
-- Additive SOURCE migration only. Never enroll/refresh a sealed generation.
do $$ declare enrolled boolean; begin
  if to_regclass('keryx_storage.identity') is not null then
    execute 'select exists(select 1 from keryx_storage.identity)' into enrolled;
    if enrolled then raise exception 'Private profiles unavailable in enrolled storage'; end if;
  end if;
end; $$;
create table public.private_profiles (
  wallet text primary key check(wallet ~ '^0x[0-9a-f]{40}$'),
  handle text unique check(handle is null or (handle ~ '^[a-z][a-z0-9_]{2,31}$' and handle not in
    ('keryx','admin','administrator','api','auth','circle','arc','creator','creators','developer','dev','dispatch','gateway','help','integrations','login','mainnet','me','moderator','official','operator','owner','profile','research','root','signup','sources','status','support','system','testnet','treasury','wallet'))),
  display_name text not null check(char_length(display_name)<=80 and display_name !~ '[[:cntrl:]]'),
  bio text not null check(char_length(bio)<=160 and bio !~ '[[:cntrl:]]'),
  purpose text not null check(char_length(purpose)<=160 and purpose !~ '[[:cntrl:]]'),
  links jsonb not null check(jsonb_typeof(links)='array' and jsonb_array_length(links)<=6),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.private_profiles enable row level security;
revoke all on public.private_profiles from public,anon,authenticated;
grant select,insert,update,delete on public.private_profiles to service_role;

create function public.private_profiles_ordinary_v1(p_wallet text) returns void
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare enrolled boolean;
begin
  if p_wallet is null or p_wallet !~ '^0x[0-9a-f]{40}$' then raise exception 'Invalid profile owner'; end if;
  if to_regclass('keryx_storage.identity') is not null then
    execute 'select exists(select 1 from keryx_storage.identity)' into enrolled;
    if enrolled then raise exception 'Private profiles unavailable in enrolled storage'; end if;
  end if;
end; $$;
create function public.private_profile_record_v1(p_wallet text) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  perform public.private_profiles_ordinary_v1(p_wallet);
  select jsonb_build_object('wallet',wallet,'displayName',display_name,'handle',coalesce(handle,''),'bio',bio,'purpose',purpose,'links',links,
    'createdAt',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt',to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) into result from public.private_profiles where wallet=p_wallet;
  return result;
end;
$$;
create function public.private_profile_get_v1(p_wallet text,p_network text) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  perform public.private_profiles_ordinary_v1(p_wallet);
  if p_network is null or p_network not in ('eip155:5042','eip155:5042002') then raise exception 'Invalid profile network'; end if;
  select jsonb_build_object('profile',public.private_profile_record_v1(p_wallet),'activity',jsonb_build_object(
    'firstSeenAt',(select to_char(first_seen_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from public.users where wallet_address=p_wallet),
    'questions',(select count(*) from public.query_runs where lower(asker)=p_wallet),
    'surfacesUsed',coalesce((select jsonb_agg(origin order by origin) from
      (select distinct origin from public.query_runs where lower(asker)=p_wallet and origin is not null limit 17) s),'[]'::jsonb),
    'topics',coalesce((select jsonb_agg(topic order by n desc,topic) from
      (select t.value #>> '{}' topic,count(*) n from public.query_memories m join public.query_runs r on r.id=m.id,
        lateral jsonb_array_elements(case when jsonb_typeof(m.topics)='array' then m.topics else '[]'::jsonb end) t
        where lower(r.asker)=p_wallet and jsonb_typeof(t.value)='string' and char_length(t.value #>> '{}') between 1 and 80
        group by t.value #>> '{}' order by n desc,topic limit 12) top_topics),'[]'::jsonb),
    'creatorsPaid',(select count(distinct lower(p.payee)) from public.payment_events p join public.query_runs r on r.id=p.query_id
      where lower(r.asker)=p_wallet and p.network=p_network and p.kind in ('fetch','citation') and p.settled and p.settlement_status='settled'
      and p.amount_usdc>0 and p.tx_hash is not null and length(btrim(p.tx_hash))>0 and lower(p.payee) ~ '^0x[0-9a-f]{40}$'),
    'scope','attributed-current-store','network',p_network)) into result;
  return result;
end; $$;
create function public.private_profile_update_v1(p_wallet text,p_profile jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare link jsonb; kind text; href text; host text; max_units integer;
begin
  perform public.private_profiles_ordinary_v1(p_wallet);
  if jsonb_typeof(p_profile) is distinct from 'object' or
    (select array_agg(key order by key) from jsonb_object_keys(p_profile) key) is distinct from array['bio','displayName','handle','links','purpose']::text[]
    or jsonb_typeof(p_profile->'links') is distinct from 'array' or jsonb_array_length(p_profile->'links')>6 then raise exception 'Invalid profile'; end if;
  foreach kind in array array['displayName','handle','bio','purpose'] loop
    if jsonb_typeof(p_profile->kind) is distinct from 'string' or (p_profile->>kind) ~ '[[:cntrl:]]' then raise exception 'Invalid profile'; end if;
    max_units:=case kind when 'displayName' then 80 when 'handle' then 32 else 160 end;
    if char_length(p_profile->>kind)>max_units or
      (select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0) from regexp_split_to_table(p_profile->>kind,'') c)>max_units or
      (p_profile->>kind) ~ U&'[\0085\2028\2029\200B-\200F\202A-\202E\2060-\206F\FEFF]' then raise exception 'Invalid profile text bounds'; end if;
  end loop;
  if (select count(distinct l->>'kind') from jsonb_array_elements(p_profile->'links') l)<>jsonb_array_length(p_profile->'links') then raise exception 'Duplicate profile link'; end if;
  for link in select value from jsonb_array_elements(p_profile->'links') loop
    if jsonb_typeof(link) is distinct from 'object' or
      (select array_agg(key order by key) from jsonb_object_keys(link) key) is distinct from array['kind','url']::text[] or
      jsonb_typeof(link->'kind') is distinct from 'string' or jsonb_typeof(link->'url') is distinct from 'string' then raise exception 'Invalid profile link'; end if;
    kind:=link->>'kind'; href:=link->>'url';
    if kind not in ('orcid','github','linkedin','x','website','telegram') or char_length(href)>512 or
      href !~ '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}/[^?#[:space:][:cntrl:]]*$' then raise exception 'Invalid profile link'; end if;
    host:=split_part(substring(href from 9),'/',1);
    if host ~ '\.(local|localhost|internal|test|invalid|example)$' or
      (kind='orcid' and host<>'orcid.org') or (kind='github' and host<>'github.com') or
      (kind='linkedin' and host not in ('linkedin.com','www.linkedin.com')) or
      (kind='x' and host not in ('x.com','twitter.com')) or (kind='telegram' and host<>'t.me') or
      (kind<>'website' and (length(split_part(substring(href from 9),'/',2))=0 or length(substring(href from length(host)+9))>240)) then raise exception 'Invalid profile link host'; end if;
  end loop;
  insert into public.private_profiles(wallet,handle,display_name,bio,purpose,links) values
    (p_wallet,nullif(p_profile->>'handle',''),p_profile->>'displayName',p_profile->>'bio',p_profile->>'purpose',p_profile->'links')
    on conflict(wallet) do update set handle=excluded.handle,display_name=excluded.display_name,bio=excluded.bio,purpose=excluded.purpose,links=excluded.links,updated_at=now();
  return public.private_profile_record_v1(p_wallet);
end; $$;
create function public.private_profile_delete_v1(p_wallet text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin perform public.private_profiles_ordinary_v1(p_wallet); delete from public.private_profiles where wallet=p_wallet; return '{"deleted":true}'::jsonb; end; $$;
revoke all on function public.private_profiles_ordinary_v1(text),public.private_profile_record_v1(text),public.private_profile_get_v1(text,text),public.private_profile_update_v1(text,jsonb),public.private_profile_delete_v1(text) from public,anon,authenticated;
grant execute on function public.private_profiles_ordinary_v1(text),public.private_profile_record_v1(text),public.private_profile_get_v1(text,text),public.private_profile_update_v1(text,jsonb),public.private_profile_delete_v1(text) to service_role;
commit;

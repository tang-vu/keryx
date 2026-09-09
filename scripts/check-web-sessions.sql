-- Disposable PostgreSQL database only, after migration 0043.
\set ON_ERROR_STOP on
begin;
do $$
declare
  first_hash text := repeat('a',64);
  second_hash text := repeat('b',64);
  owner_wallet text := '0x'||repeat('c',40);
begin
  perform public.create_web_session(first_hash,owner_wallet,1000,2000);
  perform public.create_web_session(second_hash,owner_wallet,1000,3000);
  begin
    perform public.create_web_session(first_hash,owner_wallet,1000,3000);
    raise exception 'duplicate session accepted';
  exception when unique_violation then null;
  end;
  delete from public.web_sessions where hash=first_hash and web_sessions.wallet='0x'||repeat('d',40);
  if not exists(select 1 from public.web_sessions where hash=first_hash) then raise exception 'wrong-wallet revocation'; end if;
  delete from public.web_sessions where hash=first_hash and web_sessions.wallet=owner_wallet;
  if exists(select 1 from public.web_sessions where hash=first_hash) then raise exception 'revocation failed'; end if;
  if not exists(select 1 from public.web_sessions where hash=second_hash) then raise exception 'other device removed'; end if;
  if has_table_privilege('anon','public.web_sessions','SELECT') or has_table_privilege('authenticated','public.web_sessions','DELETE')
    or has_function_privilege('anon','public.create_web_session(text,text,bigint,bigint)','EXECUTE') then raise exception 'client privilege exposed'; end if;
end;
$$;
rollback;
select 'PASS: PostgreSQL web-session creation, owner-scoped revocation, device isolation and client privilege denial' as result;

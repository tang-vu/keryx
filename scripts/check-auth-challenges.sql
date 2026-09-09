-- Run against a disposable Postgres database after 0042_auth_challenges.sql.
-- Never run this fixture against a production database.
\set ON_ERROR_STOP on
begin;
do $$
declare
  active_hash text := repeat('a',64);
  expired_hash text := repeat('b',64);
  unknown_hash text := repeat('c',64);
begin
  perform public.create_auth_challenge(active_hash, 1000, 2000);
  begin
    perform public.create_auth_challenge(active_hash, 1001, 3000);
    raise exception 'duplicate active challenge was accepted';
  exception when unique_violation then null;
  end;
  if public.consume_auth_challenge(active_hash, 999) then raise exception 'future challenge accepted'; end if;
  if not public.consume_auth_challenge(active_hash, 1999) then raise exception 'issued challenge rejected'; end if;
  if public.consume_auth_challenge(active_hash, 1999) then raise exception 'replay accepted'; end if;
  if public.consume_auth_challenge(unknown_hash, 1999) then raise exception 'unissued challenge accepted'; end if;
  perform public.create_auth_challenge(expired_hash, 1000, 2000);
  if public.consume_auth_challenge(expired_hash, 2000) then raise exception 'expired challenge accepted'; end if;
  perform public.create_auth_challenge(active_hash, 2000, 3000);
  if exists(select 1 from public.auth_challenges where hash=expired_hash) then raise exception 'expired hash not pruned'; end if;
  if has_table_privilege('anon','public.auth_challenges','SELECT')
    or has_table_privilege('authenticated','public.auth_challenges','INSERT')
    or has_function_privilege('anon','public.consume_auth_challenge(text,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.create_auth_challenge(text,bigint,bigint)','EXECUTE')
    then raise exception 'client access exposed'; end if;
  if not has_function_privilege('service_role','public.consume_auth_challenge(text,bigint)','EXECUTE')
    then raise exception 'service execution denied'; end if;
end;
$$;
rollback;
select 'PASS: Postgres challenge lifecycle, expiry, replay, cleanup and privileges' as result;

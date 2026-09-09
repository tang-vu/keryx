-- Disposable PostgreSQL only, after migrations 0038 and 0045.
\set ON_ERROR_STOP on
begin;
insert into public.a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,created_at,updated_at)
select 'a2a_'||lpad(to_hex(n),64,'0'),'a2a_'||lpad(to_hex(n),64,'0'),'synthetic-nonce','synthetic-request',
  case when n=99 then '0x'||repeat('b',40) when n%2=0 then '0X'||repeat('A',40) else '0x'||repeat('a',40) end,
  '0x'||repeat('c',40),0.05,0.03,0.02,'deep','running','synthetic-transaction','2026-09-09T00:00:00Z','2026-09-09T00:00:00Z'
from (select generate_series(1,27) as n union all select 99) inputs;
do $$
declare wallet text := '0x'||repeat('a',40);
begin
  if (select count(*) from public.list_a2a_orders_for_payer(wallet)) <> 26 then raise exception 'incorrect bound'; end if;
  if exists(select 1 from public.list_a2a_orders_for_payer(wallet) where lower(payer)<>wallet) then raise exception 'foreign row'; end if;
  if (select count(*) from public.list_a2a_orders_for_payer(wallet,'2026-09-09T00:00:00Z','a2a_'||lpad(to_hex(3),64,'0'))) <> 2 then raise exception 'cursor tie break failed'; end if;
  if exists(select 1 from public.list_a2a_orders_for_payer(wallet,null,'a2a_'||repeat('0',64))) then raise exception 'partial cursor accepted'; end if;
  if has_function_privilege('anon','public.list_a2a_orders_for_payer(text,timestamptz,text)','EXECUTE')
    or has_function_privilege('authenticated','public.list_a2a_orders_for_payer(text,timestamptz,text)','EXECUTE') then raise exception 'public inventory RPC'; end if;
end;
$$;
rollback;
select 'PASS: bounded payer history, case normalization, timestamp ties and private RPC privileges' as result;

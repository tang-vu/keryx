-- Synthetic, unfunded PostgreSQL fixture. No real identities or payment evidence.
insert into public.private_research_intents(id,payer,data)
select 'prv_'||repeat(d,64),'0x'||repeat('1',40),'{"submission":{"request":{"budget":0.03}}}'::jsonb
from unnest(array['a','b','c','d','e']) d;
insert into public.private_research_payment_attempts(id)
select id from public.private_research_intents;
insert into public.private_research_executions(id,worker_id)
select id,'11111111-1111-4111-8111-111111111111' from public.private_research_intents;
set role service_role;
do $$ begin
  if not public.reserve_private_treasury('prv_'||repeat('a',64),'0x'||repeat('1',40),'0x'||repeat('2',40),50000) then raise exception 'initial reservation denied'; end if;
  if public.release_private_treasury('prv_'||repeat('a',64),'0x'||repeat('1',40),'0x'||repeat('2',40)) then raise exception 'unsealed release'; end if;
  if not public.admit_private_creator_submission('prv_'||repeat('a',64),'0x'||repeat('1',40),'11111111-1111-4111-8111-111111111111',repeat('1',64),'0x'||repeat('1',64),17000,
    jsonb_build_object('submission',jsonb_build_object('authorizationId','0x'||repeat('1',64),'amountMicros','17000','payer','0x'||repeat('2',40)))) then raise exception 'creator admission denied'; end if;
  perform public.save_private_research_result('prv_'||repeat('a',64),'0x'||repeat('1',40),'11111111-1111-4111-8111-111111111111','{}');
  if public.release_private_treasury('prv_'||repeat('a',64),'0x'||repeat('3',40),'0x'||repeat('2',40)) then raise exception 'foreign payer release'; end if;
  if public.release_private_treasury('prv_'||repeat('a',64),'0x'||repeat('1',40),'0x'||repeat('3',40)) then raise exception 'foreign signer release'; end if;
  if public.reserve_private_treasury('prv_'||repeat('b',64),'0x'||repeat('1',40),'0x'||repeat('2',40),50000) then raise exception 'early reuse'; end if;
  begin update public.private_treasury_releases set amount_micros=0; raise exception 'service release write allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare role_name text; begin
  foreach role_name in array array['anon','authenticated'] loop
    if has_table_privilege(role_name,'public.private_treasury_releases','select') or
      has_table_privilege(role_name,'public.private_treasury_releases','insert') or
      has_function_privilege(role_name,'public.release_private_treasury(text,text,text)','execute') then raise exception 'public release authority'; end if;
  end loop;
end $$;

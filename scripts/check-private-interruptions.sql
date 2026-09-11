-- Synthetic PostgreSQL operator fixture. No signatures, secrets or real funds.
set role service_role;
select public.reserve_private_treasury('prv_'||repeat('e',64),'0x'||repeat('1',40),'0x'||repeat('5',40),50000);
select public.interrupt_private_research('prv_'||repeat('e',64),'0x'||repeat('9',40),'11111111-1111-4111-8111-111111111111');
select public.interrupt_private_research('prv_'||repeat('e',64),'0x'||repeat('1',40),'99999999-9999-4999-8999-999999999999');
do $$ begin
  if exists(select 1 from public.private_research_interruptions) then raise exception 'foreign interruption accepted'; end if;
  begin update public.private_research_interruptions set reason='worker-interrupted'; raise exception 'direct service write allowed'; exception when insufficient_privilege then null; end;
  begin delete from public.private_research_interruptions; raise exception 'direct service delete allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare role_name text; begin
  foreach role_name in array array['anon','authenticated'] loop
    if has_table_privilege(role_name,'public.private_research_interruptions','select') or
      has_function_privilege(role_name,'public.interrupt_private_research(text,text,uuid)','execute') then raise exception 'public interruption authority'; end if;
  end loop;
end $$;

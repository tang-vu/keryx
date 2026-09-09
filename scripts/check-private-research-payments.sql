-- Disposable PostgreSQL after 0046 through 0049. Synthetic fixtures, no payment evidence.
\set ON_ERROR_STOP on
begin;
set local role service_role;
insert into public.private_research_intents(id,payer,data) values (
  'prv_'||repeat('a',64),'0x'||repeat('a',40),
  jsonb_build_object('requirement',jsonb_build_object('network','eip155:5042002'),
    'submission',jsonb_build_object('payment',jsonb_build_object('authorization',jsonb_build_object(
      'from','0x'||repeat('a',40),'to','0x'||repeat('b',40),'value','50000','nonce','0x'||repeat('c',64)))))
);
do $$
declare id text := 'prv_'||repeat('a',64); owner text := '0x'||repeat('a',40); other text := '0x'||repeat('b',40);
  proof jsonb := jsonb_build_object('source','circle-facilitator-success','transaction','synthetic-original',
    'network','eip155:5042002','payer',owner,'payee',other,'amountMicros','50000','authorizationId','0x'||repeat('c',64));
begin
  if public.claim_private_research_execution(id,owner,'00000000-0000-4000-8000-000000000001') then raise exception 'unpaid execution'; end if;
  perform public.confirm_private_research_payment(id,owner,proof);
  if exists(select 1 from public.private_research_payment_attempts) then raise exception 'confirmation created an unclaimed attempt'; end if;
  if public.claim_private_research_payment(id,other) then raise exception 'foreign claim'; end if;
  if not public.claim_private_research_payment(id,owner) then raise exception 'first claim denied'; end if;
  if public.claim_private_research_payment(id,owner) then raise exception 'duplicate claim'; end if;
  if public.claim_private_research_execution(id,owner,'00000000-0000-4000-8000-000000000001') then raise exception 'pending execution'; end if;
  perform public.confirm_private_research_payment(id,other,proof);
  if exists(select 1 from public.private_research_payment_attempts where confirmation is not null) then raise exception 'foreign confirmation'; end if;
  begin
    perform public.confirm_private_research_payment(id,owner,proof||'{"amountMicros":"60000"}'::jsonb);
    raise exception 'mismatched confirmation accepted';
  exception when raise_exception then
    if sqlerrm <> 'confirmation mismatch' then raise; end if;
  end;
  perform public.confirm_private_research_payment(id,owner,proof);
  perform public.confirm_private_research_payment(id,owner,proof||'{"transaction":"synthetic-replacement"}'::jsonb);
  if not exists(select 1 from public.private_research_payment_attempts where confirmation->>'transaction'='synthetic-original' and settled_at is not null) then raise exception 'confirmed reference replaced'; end if;
  if public.claim_private_research_payment(id,owner) then raise exception 'settled attempt reclaimed'; end if;
  if public.claim_private_research_execution(id,other,'00000000-0000-4000-8000-000000000001') then raise exception 'foreign execution'; end if;
  if not public.claim_private_research_execution(id,owner,'00000000-0000-4000-8000-000000000001') then raise exception 'execution denied'; end if;
  if public.claim_private_research_execution(id,owner,'00000000-0000-4000-8000-000000000002') then raise exception 'duplicate execution'; end if;
  if not exists(select 1 from public.private_research_executions where worker_id='00000000-0000-4000-8000-000000000001') then raise exception 'original worker replaced'; end if;
  perform public.save_private_research_result(id,other,'00000000-0000-4000-8000-000000000001','{"synthetic":1}');
  perform public.save_private_research_result(id,owner,'00000000-0000-4000-8000-000000000002','{"synthetic":1}');
  if exists(select 1 from public.private_research_results) then raise exception 'foreign result save'; end if;
  perform public.save_private_research_result(id,owner,'00000000-0000-4000-8000-000000000001','{"synthetic":1}');
  perform public.save_private_research_result(id,owner,'00000000-0000-4000-8000-000000000001','{"synthetic":2}');
  if not exists(select 1 from public.private_research_results where serialized_run='{"synthetic":1}') then raise exception 'original result replaced'; end if;
  begin delete from public.private_research_results;
    raise exception 'result delete allowed'; exception when insufficient_privilege then null; end;
  begin update public.private_research_results set serialized_run='{}';
    raise exception 'result update allowed'; exception when insufficient_privilege then null; end;
  begin delete from public.private_research_executions;
    raise exception 'execution delete allowed'; exception when insufficient_privilege then null; end;
  begin update public.private_research_executions set worker_id='00000000-0000-4000-8000-000000000002';
    raise exception 'execution update allowed'; exception when insufficient_privilege then null; end;
  begin update public.private_research_payment_attempts set confirmation=null,settled_at=null;
    raise exception 'direct update allowed'; exception when insufficient_privilege then null; end;
end;
$$;
set local role anon;
do $$ begin
  begin perform public.save_private_research_result('x','x','00000000-0000-4000-8000-000000000001','{}'); raise exception 'client result write allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_research_results; raise exception 'client result read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.claim_private_research_execution('x','x','00000000-0000-4000-8000-000000000001'); raise exception 'public execution allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_research_executions; raise exception 'public execution read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.claim_private_research_payment('x','x'); raise exception 'public claim allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_research_payment_attempts; raise exception 'public read allowed'; exception when insufficient_privilege then null; end;
end; $$;
set local role authenticated;
do $$ begin
  begin perform public.save_private_research_result('x','x','00000000-0000-4000-8000-000000000001','{}'); raise exception 'client result write allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_research_results; raise exception 'client result read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.claim_private_research_execution('x','x','00000000-0000-4000-8000-000000000001'); raise exception 'authenticated execution allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_research_executions; raise exception 'authenticated execution read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.confirm_private_research_payment('x','x','{}'); raise exception 'public confirmation allowed'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
rollback;
select 'PASS: one submission claim, owner-scoped immutable confirmation, one settled-only execution, immutable private result, restricted RPCs' as result;

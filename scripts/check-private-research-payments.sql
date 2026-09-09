-- Disposable PostgreSQL after 0046 through 0052. Synthetic fixtures, no payment evidence.
\set ON_ERROR_STOP on
begin;
set local role service_role;
insert into public.private_research_intents(id,payer,data) values (
  'prv_'||repeat('a',64),'0x'||repeat('a',40),
  jsonb_build_object('requirement',jsonb_build_object('network','eip155:5042002'),
    'submission',jsonb_build_object('request',jsonb_build_object('budget',0.03),'payment',jsonb_build_object('authorization',jsonb_build_object(
      'from','0x'||repeat('a',40),'to','0x'||repeat('b',40),'value','50000','nonce','0x'||repeat('c',64)))))
);
do $$
declare id text := 'prv_'||repeat('a',64); owner text := '0x'||repeat('a',40); other text := '0x'||repeat('b',40);
  proof jsonb := jsonb_build_object('source','circle-facilitator-success','transaction','synthetic-original',
    'network','eip155:5042002','payer',owner,'payee',other,'amountMicros','50000','authorizationId','0x'||repeat('c',64));
  creator_proof jsonb;
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
  if public.admit_private_creator_submission(id,other,'00000000-0000-4000-8000-000000000001',repeat('1',64),'0x'||repeat('1',64),20000,
    jsonb_build_object('submission',jsonb_build_object('authorizationId','0x'||repeat('1',64),'amountMicros','20000'))) then raise exception 'foreign creator admission'; end if;
  if not public.admit_private_creator_submission(id,owner,'00000000-0000-4000-8000-000000000001',repeat('1',64),'0x'||repeat('1',64),20000,
    jsonb_build_object('submission',jsonb_build_object('authorizationId','0x'||repeat('1',64),'amountMicros','20000'))) then raise exception 'first creator denied'; end if;
  if public.admit_private_creator_submission(id,owner,'00000000-0000-4000-8000-000000000001',repeat('1',64),'0x'||repeat('2',64),1000,
    jsonb_build_object('submission',jsonb_build_object('authorizationId','0x'||repeat('2',64),'amountMicros','1000'))) then raise exception 'duplicate creator leg'; end if;
  if public.admit_private_creator_submission(id,owner,'00000000-0000-4000-8000-000000000001',repeat('2',64),'0x'||repeat('2',64),10001,
    jsonb_build_object('submission',jsonb_build_object('authorizationId','0x'||repeat('2',64),'amountMicros','10001'))) then raise exception 'creator budget exceeded'; end if;
  if not public.admit_private_creator_submission(id,owner,'00000000-0000-4000-8000-000000000001',repeat('2',64),'0x'||repeat('2',64),9999,
    jsonb_build_object('submission',jsonb_build_object('authorizationId','0x'||repeat('2',64),'amountMicros','9999'))) then raise exception 'remaining creator budget denied'; end if;
  begin delete from public.private_creator_submissions;
    raise exception 'creator delete allowed'; exception when insufficient_privilege then null; end;
  begin update public.private_creator_submissions set amount_micros=1;
    raise exception 'creator update allowed'; exception when insufficient_privilege then null; end;
  perform public.save_private_research_result(id,other,'00000000-0000-4000-8000-000000000001','{"synthetic":1}');
  perform public.save_private_research_result(id,owner,'00000000-0000-4000-8000-000000000002','{"synthetic":1}');
  if exists(select 1 from public.private_research_results) then raise exception 'foreign result save'; end if;
  perform public.save_private_research_result(id,owner,'00000000-0000-4000-8000-000000000001','{"synthetic":1}');
  perform public.save_private_research_result(id,owner,'00000000-0000-4000-8000-000000000001','{"synthetic":2}');
  if not exists(select 1 from public.private_research_results where serialized_run='{"synthetic":1}') then raise exception 'original result replaced'; end if;
  if public.admit_private_creator_submission(id,owner,'00000000-0000-4000-8000-000000000001',repeat('3',64),'0x'||repeat('3',64),1,
    jsonb_build_object('submission',jsonb_build_object('authorizationId','0x'||repeat('3',64),'amountMicros','1'))) then raise exception 'creator admitted after result'; end if;
  select jsonb_build_object('source','circle-facilitator-success','transaction','synthetic-creator-original','submission',data->'submission')
    into creator_proof from public.private_creator_submissions where authorization_id='0x'||repeat('1',64);
  perform public.confirm_private_creator_submission(id,other,'00000000-0000-4000-8000-000000000001',creator_proof);
  perform public.confirm_private_creator_submission(id,owner,'00000000-0000-4000-8000-000000000002',creator_proof);
  if exists(select 1 from public.private_creator_confirmations) then raise exception 'foreign creator confirmation'; end if;
  begin
    perform public.confirm_private_creator_submission(id,owner,'00000000-0000-4000-8000-000000000001',jsonb_set(creator_proof,'{submission,amountMicros}','"20001"'));
    raise exception 'mismatched creator confirmation accepted';
  exception when raise_exception then if sqlerrm <> 'creator confirmation mismatch' then raise; end if; end;
  perform public.confirm_private_creator_submission(id,owner,'00000000-0000-4000-8000-000000000001',creator_proof);
  perform public.confirm_private_creator_submission(id,owner,'00000000-0000-4000-8000-000000000001',creator_proof||'{"transaction":"replacement"}'::jsonb);
  if not exists(select 1 from public.private_creator_confirmations where data->>'transaction'='synthetic-creator-original') then raise exception 'creator receipt replaced'; end if;
  select jsonb_build_object('source','circle-transfer-search','transaction','synthetic-search-original','transferStatus','batched','submission',data->'submission')
    into creator_proof from public.private_creator_submissions where authorization_id='0x'||repeat('2',64);
  begin
    perform public.confirm_private_creator_submission(id,owner,'00000000-0000-4000-8000-000000000001',creator_proof||'{"transferStatus":"failed"}'::jsonb);
    raise exception 'failed transfer promoted';
  exception when raise_exception then if sqlerrm <> 'creator confirmation mismatch' then raise; end if; end;
  begin
    perform public.confirm_private_creator_submission(id,owner,'00000000-0000-4000-8000-000000000001',creator_proof-'transferStatus');
    raise exception 'missing transfer stage promoted';
  exception when raise_exception then if sqlerrm <> 'creator confirmation mismatch' then raise; end if; end;
  perform public.confirm_private_creator_submission(id,owner,'00000000-0000-4000-8000-000000000001',creator_proof);
  if not exists(select 1 from public.private_creator_confirmations where data->>'source'='circle-transfer-search' and data->>'transferStatus'='batched') then raise exception 'search provenance missing'; end if;
  if (select sum(amount_micros) from public.private_creator_submissions) <> 29999 then raise exception 'confirmation released budget'; end if;
  begin delete from public.private_creator_confirmations;
    raise exception 'creator confirmation delete allowed'; exception when insufficient_privilege then null; end;
  begin update public.private_creator_confirmations set data='{}';
    raise exception 'creator confirmation update allowed'; exception when insufficient_privilege then null; end;
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
  begin perform public.confirm_private_creator_submission('x','x','00000000-0000-4000-8000-000000000001','{}'); raise exception 'client creator confirmation allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_creator_confirmations; raise exception 'client creator confirmation read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.admit_private_creator_submission('x','x','00000000-0000-4000-8000-000000000001','x','x',1,'{}'); raise exception 'client creator admission allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_creator_submissions; raise exception 'client creator read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.save_private_research_result('x','x','00000000-0000-4000-8000-000000000001','{}'); raise exception 'client result write allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_research_results; raise exception 'client result read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.claim_private_research_execution('x','x','00000000-0000-4000-8000-000000000001'); raise exception 'public execution allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_research_executions; raise exception 'public execution read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.claim_private_research_payment('x','x'); raise exception 'public claim allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_research_payment_attempts; raise exception 'public read allowed'; exception when insufficient_privilege then null; end;
end; $$;
set local role authenticated;
do $$ begin
  begin perform public.confirm_private_creator_submission('x','x','00000000-0000-4000-8000-000000000001','{}'); raise exception 'client creator confirmation allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_creator_confirmations; raise exception 'client creator confirmation read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.admit_private_creator_submission('x','x','00000000-0000-4000-8000-000000000001','x','x',1,'{}'); raise exception 'client creator admission allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_creator_submissions; raise exception 'client creator read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.save_private_research_result('x','x','00000000-0000-4000-8000-000000000001','{}'); raise exception 'client result write allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_research_results; raise exception 'client result read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.claim_private_research_execution('x','x','00000000-0000-4000-8000-000000000001'); raise exception 'authenticated execution allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.private_research_executions; raise exception 'authenticated execution read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.confirm_private_research_payment('x','x','{}'); raise exception 'public confirmation allowed'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
rollback;
select 'PASS: one submission claim, owner-scoped immutable confirmation, one settled-only execution, immutable private result, capped creator admission, immutable creator confirmation with search provenance, restricted RPCs' as result;

-- Disposable PostgreSQL only, after migration 0046. No secrets or real signed requests.
\set ON_ERROR_STOP on
begin;
set local role service_role;
insert into public.private_research_intents(id,payer,data)
values ('prv_'||repeat('a',64),'0x'||repeat('a',40),'{"synthetic":"original"}');
insert into public.private_research_intents(id,payer,data)
values ('prv_'||repeat('a',64),'0x'||repeat('b',40),'{"synthetic":"replacement"}')
on conflict(id) do nothing;
do $$
begin
  if (select count(*) from public.private_research_intents) <> 1 then raise exception 'duplicate reservation'; end if;
  if not exists (select 1 from public.private_research_intents where payer='0x'||repeat('a',40) and data->>'synthetic'='original') then raise exception 'original was replaced'; end if;
  if exists (select 1 from public.private_research_intents where id='prv_'||repeat('a',64) and payer='0x'||repeat('b',40)) then raise exception 'foreign lookup'; end if;
  begin
    update public.private_research_intents set payer='0x'||repeat('b',40);
    raise exception 'service role could update intent';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.private_research_intents;
    raise exception 'service role could delete intent';
  exception when insufficient_privilege then null;
  end;
end;
$$;
set local role anon;
do $$ begin
  begin perform * from public.private_research_intents; raise exception 'anonymous read permitted'; exception when insufficient_privilege then null; end;
end; $$;
set local role authenticated;
do $$ begin
  begin perform * from public.private_research_intents; raise exception 'authenticated direct read permitted'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
rollback;
select 'PASS: private reservations preserve the first writer; public reads and application mutation denied' as result;

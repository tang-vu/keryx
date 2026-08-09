-- Terminal Circle x402 failures and generation-bound browser cap recovery.
--
-- A grant epoch changes on every create/recover. A delayed failure may release a reservation only
-- when the currently active grant is the same generation that reserved it; otherwise it could
-- subtract from fresh spending after a recovery and silently reopen excess capacity.

alter table public.session_grants add column if not exists grant_epoch text;
update public.session_grants
set grant_epoch = md5(random()::text || clock_timestamp()::text || session_id)
where grant_epoch is null;
alter table public.session_grants alter column grant_epoch set not null;

alter table public.payment_events add column if not exists grant_epoch text;

alter table public.payment_events
  drop constraint if exists payment_events_settlement_status_check;
alter table public.payment_events
  add constraint payment_events_settlement_status_check
  check (
    (settled and settlement_status = 'settled')
    or (not settled and settlement_status in ('simulated', 'pending', 'failed'))
  );

create or replace function public.fail_pending_payment(
  p_id text,
  p_authorization_id text,
  p_circle_transfer_id text
)
returns table(resolved boolean, reservation_released boolean)
language plpgsql
security invoker
as $$
declare
  v_payer text;
  v_amount numeric;
  v_grant_epoch text;
  v_released integer := 0;
begin
  select payer, amount_usdc, grant_epoch
    into v_payer, v_amount, v_grant_epoch
    from public.payment_events
   where id = p_id
     and authorization_id = p_authorization_id
     and settled = false
     and settlement_status = 'pending'
   for update;

  if not found then
    return query select false, false;
    return;
  end if;

  update public.payment_events
     set settlement_status = 'failed', tx_hash = p_circle_transfer_id
   where id = p_id
     and authorization_id = p_authorization_id
     and settled = false
     and settlement_status = 'pending';

  if v_grant_epoch is not null then
    update public.session_grants
       set spent = greatest(0, round(spent - v_amount, 6))
     where grant_epoch = v_grant_epoch
       and lower(sess_addr) = lower(v_payer);
    get diagnostics v_released = row_count;
  end if;

  return query select true, v_released = 1;
end;
$$;

revoke all on function public.fail_pending_payment(text, text, text)
  from public, anon, authenticated;
grant execute on function public.fail_pending_payment(text, text, text)
  to service_role;

-- Preserve the difference between offline simulation and an ambiguous browser co-sign attempt.
-- Pending means an EIP-3009 authorization crossed the submission boundary but no definitive
-- Circle settlement response returned. It must remain settled=false and outside traction totals.

alter table public.payment_events
  add column if not exists settlement_status text;
alter table public.payment_events
  add column if not exists authorization_id text;

update public.payment_events
set settlement_status = case when settled then 'settled' else 'simulated' end
where settlement_status is null;

alter table public.payment_events
  alter column settlement_status set default 'simulated';
alter table public.payment_events
  alter column settlement_status set not null;

alter table public.payment_events
  drop constraint if exists payment_events_settlement_status_check;
alter table public.payment_events
  add constraint payment_events_settlement_status_check
  check (
    (settled and settlement_status = 'settled')
    or (not settled and settlement_status in ('simulated', 'pending'))
  );

create index if not exists payment_events_pending
  on public.payment_events (created_at desc)
  where settlement_status = 'pending';

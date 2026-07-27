-- Persist completed-dispatch provenance and operational telemetry.
--
-- payment_events already carries origin, but that cannot classify a zero-spend query. Putting the
-- channel on query_runs makes the external conversion denominator honest. Telemetry columns are
-- nullable so historical rows remain explicitly unsampled instead of receiving invented values.

alter table public.query_runs add column if not exists origin text;
alter table public.query_runs add column if not exists duration_ms bigint;
alter table public.query_runs add column if not exists payment_mode text;
alter table public.query_runs add column if not exists payment_attempts integer;
alter table public.query_runs add column if not exists settled_payments integer;
alter table public.query_runs add column if not exists confidence_level text;

-- Backfill only what the payment ledger can prove. Legacy zero-payment rows have no channel
-- evidence and conservatively remain engine traffic.
update public.query_runs q
set origin = case
  when exists (
    select 1 from public.payment_events p
    where p.query_id = q.id and p.origin = 'a2a'
  ) then 'a2a'
  when exists (
    select 1 from public.payment_events p
    where p.query_id = q.id and p.origin = 'web'
  ) then 'web'
  else 'engine'
end
where q.origin is null;

alter table public.query_runs
  drop constraint if exists query_runs_origin_check;
alter table public.query_runs
  add constraint query_runs_origin_check
  check (origin in ('engine', 'web', 'a2a'));

alter table public.query_runs
  drop constraint if exists query_runs_payment_mode_check;
alter table public.query_runs
  add constraint query_runs_payment_mode_check
  check (payment_mode is null or payment_mode in ('real', 'offline'));

alter table public.query_runs
  drop constraint if exists query_runs_telemetry_nonnegative_check;
alter table public.query_runs
  add constraint query_runs_telemetry_nonnegative_check
  check (
    (duration_ms is null or duration_ms >= 0)
    and (payment_attempts is null or payment_attempts >= 0)
    and (settled_payments is null or settled_payments >= 0)
    and (
      payment_attempts is null
      or settled_payments is null
      or settled_payments <= payment_attempts
    )
  );

create index if not exists query_runs_origin
  on public.query_runs (origin, created_at desc);

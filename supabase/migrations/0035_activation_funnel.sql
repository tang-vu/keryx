-- Privacy-preserving product activation telemetry.
--
-- This deliberately stores no actor, wallet, IP, cookie, user-agent, referrer, question, source,
-- or payment identity: only one UTC day bucket, one allowlisted event name, and an integer count.

create table if not exists public.activation_events (
  day date not null,
  event text not null check (event in (
    'reader_landing',
    'reader_ask_started',
    'reader_answer_completed',
    'reader_wallet_connected',
    'reader_session_funded',
    'reader_returning_dispatch',
    'creator_registration_started',
    'creator_verification_completed',
    'creator_citation_settled',
    'creator_withdrawal_completed'
  )),
  count bigint not null default 0 check (count >= 0),
  primary key (day, event)
);
create index if not exists activation_events_day on public.activation_events(day);

alter table public.activation_events enable row level security;
revoke all on table public.activation_events from anon, authenticated;
grant all on table public.activation_events to service_role;

create or replace function public.increment_activation_event(p_day date, p_event text)
returns void
language plpgsql
as $$
begin
  insert into public.activation_events(day, event, count)
  values (p_day, p_event, 1)
  on conflict (day, event) do update
    set count = public.activation_events.count + 1;
end;
$$;

revoke all on function public.increment_activation_event(date, text)
  from public, anon, authenticated;
grant execute on function public.increment_activation_event(date, text)
  to service_role;

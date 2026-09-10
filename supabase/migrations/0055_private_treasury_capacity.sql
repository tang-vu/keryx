-- Dedicated, operator-backed lifetime allocation. Never recycle on job completion or expiry.
create table if not exists public.private_treasury_pools (
  signer text primary key check(signer ~ '^0x[a-f0-9]{40}$'),
  capacity_micros bigint not null check(capacity_micros > 0 and capacity_micros <= 999999999999)
);
create table if not exists public.private_treasury_reservations (
  job_id text primary key references public.private_research_intents(id),
  signer text not null references public.private_treasury_pools(signer),
  amount_micros bigint not null check(amount_micros > 0 and amount_micros <= 500000)
);
create index if not exists private_treasury_reservations_signer on public.private_treasury_reservations(signer);
alter table public.private_treasury_pools enable row level security;
alter table public.private_treasury_reservations enable row level security;
revoke all on public.private_treasury_pools,public.private_treasury_reservations from public,anon,authenticated,service_role;
grant select on public.private_treasury_pools,public.private_treasury_reservations to service_role;

create or replace function public.reserve_private_treasury(p_id text,p_payer text,p_signer text,p_capacity bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare amount bigint; ceiling bigint; used bigint; original record;
begin
  if p_signer is null or p_signer !~ '^0x[a-f0-9]{40}$' or p_signer = '0x0000000000000000000000000000000000000000'
    or p_capacity is null or p_capacity < 1 or p_capacity > 999999999999 then raise exception 'invalid capacity policy'; end if;
  select round((data->'submission'->'request'->>'budget')::numeric * 1000000)::bigint into amount
    from public.private_research_intents where id=p_id and payer=lower(p_payer);
  if not found then raise exception 'private intent unavailable'; end if;
  insert into public.private_treasury_pools values(p_signer,p_capacity) on conflict(signer) do nothing;
  select capacity_micros into ceiling from public.private_treasury_pools where signer=p_signer for update;
  if ceiling <> p_capacity then raise exception 'capacity policy conflict'; end if;
  select * into original from public.private_treasury_reservations where job_id=p_id;
  if found then
    if original.signer <> p_signer or original.amount_micros <> amount then raise exception 'reservation conflict'; end if;
    return true;
  end if;
  select coalesce(sum(amount_micros),0) into used from public.private_treasury_reservations where signer=p_signer;
  if amount > ceiling-used then return false; end if;
  insert into public.private_treasury_reservations values(p_id,p_signer,amount) on conflict(job_id) do nothing;
  select * into original from public.private_treasury_reservations where job_id=p_id;
  if original.signer <> p_signer or original.amount_micros <> amount then raise exception 'reservation conflict'; end if;
  return true;
end $$;
revoke all on function public.reserve_private_treasury(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.reserve_private_treasury(text,text,text,bigint) to service_role;

-- Additive, unused journal substrate. payment_events remains the only payment/recovery ledger.
create table public.browser_authorization_intents (
  nonce text primary key check (nonce ~ '^0x[0-9a-f]{64}$'),
  session_id text not null check (length(session_id) > 0),
  request_id text not null check (length(request_id) > 0),
  query_id text not null check (length(query_id) > 0),
  grant_epoch text not null,
  signer text not null check (signer ~* '^0x[0-9a-f]{40}$'),
  network text not null check (network = 'eip155:5042002'),
  token text not null check (lower(token) = '0x3600000000000000000000000000000000000000'),
  gateway_contract text not null check (lower(gateway_contract) = '0x0077777d7eba4688bdef3e311b846f25870a19b9'),
  source_id text not null check (length(source_id) > 0),
  offer_id text,
  kind text not null check (kind in ('fetch', 'citation')),
  payee text not null check (payee ~* '^0x[0-9a-f]{40}$'),
  amount_micro_usdc bigint not null check (amount_micro_usdc between 1 and 9007199254740991),
  phase text not null default 'prepared' check (phase = 'prepared'),
  created_at timestamptz not null,
  unique (session_id, request_id)
);
create index browser_authorization_intents_created_idx
  on public.browser_authorization_intents (created_at);
alter table public.browser_authorization_intents enable row level security;
revoke all on table public.browser_authorization_intents from public, anon, authenticated;
grant select, insert on table public.browser_authorization_intents to service_role;

create function public.reject_browser_authorization_intent_change()
returns trigger language plpgsql security invoker as $$
begin
  raise exception 'browser authorization intent is immutable';
end;
$$;
create trigger browser_intents_immutable_update
  before update or delete on public.browser_authorization_intents
  for each row execute function public.reject_browser_authorization_intent_change();
revoke all on function public.reject_browser_authorization_intent_change()
  from public, anon, authenticated;

create function public.admit_browser_authorization(p_intent jsonb)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_amount numeric;
  v_updated integer;
begin
  -- The adapter supplies a positive safe integer. Recheck at the database boundary.
  if p_intent->>'nonce' !~ '^0x[0-9a-f]{64}$'
     or p_intent->>'network' <> 'eip155:5042002'
     or lower(p_intent->>'token') <> '0x3600000000000000000000000000000000000000'
     or lower(p_intent->>'gateway_contract') <> '0x0077777d7eba4688bdef3e311b846f25870a19b9'
     or p_intent->>'kind' not in ('fetch', 'citation')
     or p_intent->>'amount_micro_usdc' !~ '^[0-9]+$' then
    raise exception 'Invalid browser authorization intent';
  end if;
  v_amount := (p_intent->>'amount_micro_usdc')::numeric;
  if v_amount < 1 or v_amount > 9007199254740991 then
    raise exception 'Invalid browser authorization amount';
  end if;
  update public.session_grants
     set spent = (spent * 1000000 + v_amount) / 1000000
   where session_id = p_intent->>'session_id'
     and grant_epoch = p_intent->>'grant_epoch'
     and lower(sess_addr) = lower(p_intent->>'signer')
     and expiry > (extract(epoch from clock_timestamp()) * 1000)::bigint
     and cap * 1000000 = trunc(cap * 1000000)
     and spent * 1000000 = trunc(spent * 1000000)
     and spent * 1000000 + v_amount <= cap * 1000000;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return 'grant_or_cap_refused';
  end if;
  insert into public.browser_authorization_intents
    (nonce,session_id,request_id,query_id,grant_epoch,signer,network,token,gateway_contract,
     source_id,offer_id,kind,payee,amount_micro_usdc,created_at)
  values
    (p_intent->>'nonce',p_intent->>'session_id',p_intent->>'request_id',
     p_intent->>'query_id',p_intent->>'grant_epoch',p_intent->>'signer',
     p_intent->>'network',p_intent->>'token',p_intent->>'gateway_contract',
     p_intent->>'source_id',p_intent->>'offer_id',p_intent->>'kind',
     p_intent->>'payee',v_amount,p_intent->>'created_at');
  return 'admitted';
end;
$$;
revoke all on function public.admit_browser_authorization(jsonb) from public, anon, authenticated;
grant execute on function public.admit_browser_authorization(jsonb) to service_role;

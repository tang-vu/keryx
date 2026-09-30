-- Correct the JSON text timestamp conversion in the additive D-268 admission RPC.
-- Preserve invoker authority, grant fences and atomic reservation/insert rollback.
create or replace function public.admit_browser_authorization(p_intent jsonb)
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
     p_intent->>'payee',v_amount,(p_intent->>'created_at')::timestamptz);
  return 'admitted';
end;
$$;
revoke all on function public.admit_browser_authorization(jsonb) from public, anon, authenticated;
grant execute on function public.admit_browser_authorization(jsonb) to service_role;

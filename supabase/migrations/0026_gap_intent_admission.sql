-- A gap intent is an authorization for one bounded treasury-funded retry. Item-level uniqueness
-- allowed one creator to submit many posts for the same gap and collect a fetch toll on every miss.
-- Serialize admission by semantic gap + verified owner wallet and return the first durable offer.

create or replace function public.create_gap_intent(
  p_id text,
  p_gap_id text,
  p_claim text,
  p_question text,
  p_failed_query_id text,
  p_source_id text,
  p_source_item_link text,
  p_owner_wallet text
)
returns setof public.gap_intents
language plpgsql
security invoker
as $$
declare
  v_existing public.gap_intents%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_gap_id), hashtext(lower(p_owner_wallet)));

  select * into v_existing
    from public.gap_intents
   where gap_id = p_gap_id
     and lower(owner_wallet) = lower(p_owner_wallet)
   order by created_at asc
   limit 1;

  if found then
    return next v_existing;
    return;
  end if;

  return query
  insert into public.gap_intents (
    id, gap_id, claim, question, failed_query_id, source_id, source_item_link,
    owner_wallet, status, attempts, created_at, updated_at
  ) values (
    p_id, p_gap_id, p_claim, p_question, p_failed_query_id, p_source_id,
    p_source_item_link, lower(p_owner_wallet), 'pending', 0, now(), now()
  )
  returning *;
end;
$$;

revoke all on function public.create_gap_intent(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_gap_intent(
  text, text, text, text, text, text, text, text
) to service_role;

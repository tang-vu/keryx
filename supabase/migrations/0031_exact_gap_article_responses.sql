-- Bind new wanted-claim responses to one immutable paid article revision.
-- These columns are coordination only: SourceRegistry still owns creator, payee, active state,
-- list-price ceiling, and author splits. Existing NULL rows keep their historical generic retry.

alter table public.gap_intents add column if not exists item_id text;
alter table public.gap_intents add column if not exists content_version text;
alter table public.gap_intents add column if not exists article_offer_id text;

drop function if exists public.create_gap_intent(text, text, text, text, text, text, text, text);

create or replace function public.create_gap_intent(
  p_id text,
  p_gap_id text,
  p_claim text,
  p_question text,
  p_failed_query_id text,
  p_source_id text,
  p_source_item_link text,
  p_item_id text,
  p_content_version text,
  p_article_offer_id text,
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
    item_id, content_version, article_offer_id, owner_wallet,
    status, attempts, created_at, updated_at
  ) values (
    p_id, p_gap_id, p_claim, p_question, p_failed_query_id, p_source_id,
    p_source_item_link, p_item_id, p_content_version, p_article_offer_id,
    lower(p_owner_wallet), 'pending', 0, now(), now()
  )
  returning *;
end;
$$;

revoke all on function public.create_gap_intent(
  text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_gap_intent(
  text, text, text, text, text, text, text, text, text, text, text
) to service_role;

-- DB rows cannot prove the live registry creator. Claim only establishes a bounded lease over an
-- active/verified source; the worker refreshes SourceRegistry creator and exact article/offer
-- identity before it spends. Removing the old payout-wallet equality also avoids confusing payee
-- with creator authority on sources where those addresses intentionally differ.
create or replace function public.claim_gap_intent(
  p_now bigint,
  p_lease_ms bigint
)
returns setof public.gap_intents
language plpgsql
security invoker
as $$
declare
  v_id text;
begin
  update public.gap_intents
     set status = 'failed',
         last_error = coalesce(last_error, 'retry lease expired'),
         lease_expires_at = null,
         updated_at = now()
   where status = 'running'
     and lease_expires_at <= p_now
     and attempts >= 3;

  select gi.id into v_id
    from public.gap_intents gi
    join public.sources s on s.id = gi.source_id
   where (
     gi.status = 'pending'
     or (gi.status = 'running' and gi.lease_expires_at <= p_now)
   )
     and gi.attempts < 3
     and s.active = true
     and s.verified = true
   order by gi.created_at asc
   for update of gi skip locked
   limit 1;

  if v_id is null then return; end if;

  return query
  update public.gap_intents
     set status = 'running',
         attempts = attempts + 1,
         lease_expires_at = p_now + greatest(1000, p_lease_ms),
         last_error = null,
         updated_at = now()
   where id = v_id
   returning *;
end;
$$;

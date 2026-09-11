-- Different signed fee/expiry terms do not create a new underlying transfer.
-- JSONB equality ignores key ordering; the app persists a strictly validated,
-- lowercase spec. Existing duplicate specs cause migration failure, not replay.
create unique index if not exists creator_withdrawal_spec_once
  on public.creator_withdrawal_requests ((data #> '{request,burnIntent,spec}'));

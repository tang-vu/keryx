-- Migration 0010: notify-on-citation webhooks.
--
-- A creator can register a webhook URL per source. When the agent cites that source and settles a
-- citation reward, Keryx POSTs a signed payload to the URL so the creator's own agent/system is
-- pinged the moment it earns — closing the creator value loop without polling the dashboard.
--
-- Kept off-chain and in its own table (not on sources) because the URL + secret are private to the
-- owner: they must never appear in public source listings, and the on-chain registry path writes no
-- source row at register time (the indexer does), so notify config is keyed by source id separately.
-- `secret` is the per-source HMAC key used to sign the X-Keryx-Signature header on each delivery.

create table if not exists public.source_notify (
  source_id  text primary key,            -- the source whose citations trigger the webhook
  notify_url text not null,               -- creator-controlled endpoint Keryx POSTs to
  secret     text not null,               -- per-source HMAC key for X-Keryx-Signature
  updated_at timestamptz not null default now()
);

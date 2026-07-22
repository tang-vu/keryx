-- Migration 0016: citation email alerts.
--
-- The webhook path (0010) closes the creator loop for creators who run software; most writers
-- don't. This table holds the human channel: an owner-set email address per source that gets a
-- short "you were cited and paid" message when a citation reward settles on-chain.
--
-- Kept in its own table (not a column on source_notify) so a creator can run either channel —
-- or both — independently, and existing webhook code paths stay untouched.
-- `unsub_token` is a per-row random secret embedded in every mail's unsubscribe link, so the
-- recipient can always stop delivery without signing in. `last_sent_at` rate-caps delivery
-- (the volume engine can cite the same source many times an hour; the inbox gets one).

create table if not exists public.source_notify_email (
  source_id    text primary key,          -- the source whose settled citations trigger a mail
  email        text not null,             -- owner-set recipient address
  unsub_token  text not null,             -- random secret for the unauthenticated unsubscribe link
  last_sent_at timestamptz,               -- last delivery — used to rate-cap sends per source
  updated_at   timestamptz not null default now()
);

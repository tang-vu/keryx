-- Migration 0007: payment origin tag.
--
-- origin: where a payment came from — 'engine' (Keryx's autonomous volume engine),
--   'web' (a human asking on the site), or 'a2a' (an external agent calling the paid
--   A2A endpoint). web + a2a = genuine external usage, reported separately from engine
--   volume so traction is honest. Pre-existing rows are all engine-generated, so they
--   backfill to 'engine' and the column never overstates external usage.

do $$ begin
  alter table public.payment_events add column origin text;
exception when duplicate_column then null;
end $$;

update public.payment_events set origin = 'engine' where origin is null;

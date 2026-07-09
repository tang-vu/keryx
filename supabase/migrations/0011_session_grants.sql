-- Migration 0011: browser co-sign session grants.
--
-- A grant records that a user funded a session EOA and authorised Keryx to request signatures
-- from it up to a USDC cap. It holds NO private key — the key never leaves the browser tab that
-- derived it; the server only ever learns the public address.
--
-- Previously these lived in a process-local Map. A restart therefore dropped every active grant
-- (funded tabs went "expired" mid-run) and, worse, reset `spent` to zero — so the cap accounting
-- restarted with the process. The Gateway balance was still the true ceiling, but the server's own
-- limit was not. Persisting the row fixes both.

create table if not exists public.session_grants (
  session_id text primary key,          -- lowercased SIWE address; one active grant per wallet
  sess_addr  text        not null,      -- session EOA (public address only)
  owner_addr text        not null,
  cap        numeric     not null,      -- USDC ceiling, clamped to the real Gateway balance
  spent      numeric     not null default 0,
  expiry     bigint      not null,      -- unix ms
  tx_hash    text        not null
);

create index if not exists session_grants_expiry on public.session_grants (expiry);

-- Atomic increment. A read-modify-write from the application would lose a spend whenever two
-- sources settle concurrently within one agent run, which is the normal case.
create or replace function public.add_session_grant_spend(p_session_id text, p_amount numeric)
returns boolean
language plpgsql
as $$
declare
  updated int;
begin
  update public.session_grants
     set spent = round(spent + p_amount, 6)
   where session_id = p_session_id;
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

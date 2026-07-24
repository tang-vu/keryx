-- Migration 0017: attribute a dispatch to the wallet that ran it.
--
-- Written only from the server-verified SIWE session, lowercased — never from a client-supplied
-- field, so one wallet can never write dispatches into another wallet's ledger.
--
-- NULL on every existing row and on every anonymous, volume-engine, or A2A run: none of those has
-- a signed-in wallet to attribute to, and a receipts page must show nothing rather than a guess.

alter table public.query_runs add column if not exists asker text;

-- (asker, created_at) so a wallet's newest-first ledger is an index scan, not a full log scan.
create index if not exists query_runs_asker on public.query_runs (asker, created_at desc);

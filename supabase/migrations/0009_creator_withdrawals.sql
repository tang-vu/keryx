-- Migration 0009: creator cash-outs (on-chain Gateway withdraws).
--
-- Each row is a creator pulling accrued Gateway earnings on-chain via Gateway withdraw, which
-- mints real USDC on Arc. Unlike the per-payment Circle settlement UUIDs in payment_events (which
-- do NOT open at /tx/), tx_hash here is a real EVM mint hash that resolves on the block explorer,
-- so the dashboard can link it as verifiable proof the rewards are real, withdrawable USDC.
--
-- Kept in its own table (not payment_events) so cash-outs never inflate payment/volume/creator
-- metrics — they move already-counted earnings out, they are not new payments.

create table if not exists public.withdrawals (
  tx_hash     text primary key,           -- EVM mint tx hash — resolves at explorer /tx/
  created_at  timestamptz not null default now(),
  label       text,                        -- keystore label of the creator wallet
  source_name text,                        -- human-readable source name when resolvable
  wallet      text not null,               -- creator EOA the balance was drawn from
  recipient   text not null,               -- address the minted USDC landed in
  amount_usdc numeric not null,
  network     text not null
);

create index if not exists withdrawals_created_at on public.withdrawals (created_at desc);

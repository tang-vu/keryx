#!/usr/bin/env bash
# Daily traction driver. Grows BOTH dashboard provenance buckets with real Arc-testnet
# settlement, in MODEST daily amounts so the day-bucketed earnings chart rises a few %/day:
#   - autonomous engine   (origin=engine)  via the volume engine
#   - external A2A usage   (origin=a2a)     via the paid agent-to-agent endpoint
#   - external web usage   (origin=web)     via the headless session-grant browser simulator
#
# Phases run SEQUENTIALLY: the engine and the server-side A2A collectRun share one spend
# wallet (data/spend-wallet.json); overlapping deposits would race on nonces. The web client
# uses its own faucet-funded wallet, but is still run last for clean, readable logs.
#
# Counts carry light per-run jitter so the daily bars vary instead of being flat.
# Designed to be invoked once per day from cron; safe to run by hand too.
set -uo pipefail
cd /root/keryx

# Per-run jitter: engine 6-10 queries, A2A 2-3 calls. ($RANDOM is 0-32767.)
ENGINE_COUNT=$(( 6 + RANDOM % 5 ))
A2A_COUNT=$(( 2 + RANDOM % 2 ))

echo "=== keryx traction run START ==="
date -u
echo "plan: engine=${ENGINE_COUNT}q · a2a=${A2A_COUNT} calls · web=1 ask"

echo
echo "--- [1/3] autonomous engine — ${ENGINE_COUNT} queries (origin=engine) ---"
npm run seed -- --count "${ENGINE_COUNT}" --budget 0.04 --delay 800 || echo "engine batch exited rc=$?"

echo
echo "--- [2/3] external A2A — ${A2A_COUNT} paid calls (origin=a2a) ---"
QUESTIONS=(
  "How do x402 and stablecoins enable autonomous AI agent commerce?"
  "What are the tradeoffs between batched and per-request nanopayments for AI agents?"
  "How does Circle's Gateway settle sub-cent USDC payments?"
  "What makes an AI agent's spending decisions rational under a hard budget?"
  "How do micropayments change the economics of content for AI readers?"
  "What role do stablecoins play in machine-to-machine payments?"
  "How can creators get paid when AI agents cite their work?"
  "What are the security tradeoffs of non-custodial browser session keys?"
  "How does CCTP enable cross-chain USDC transfers between domains?"
  "Why is per-citation settlement fairer than a flat per-fetch toll?"
  "How do autonomous agents discover and evaluate paid data sources?"
  "What is the role of EIP-712 signatures in x402 payment authorization?"
)
N=${#QUESTIONS[@]}
OFFSET=$(( RANDOM % N ))   # rotate the starting question so runs aren't identical
for ((j=0; j<A2A_COUNT; j++)); do
  q="${QUESTIONS[$(( (OFFSET + j) % N ))]}"
  echo ">>> a2a $((j+1))/${A2A_COUNT}: $q"
  npm run a2a -- "$q" 0.03 || echo "a2a $((j+1)) exited rc=$?"
  sleep 2
done

echo
echo "--- [3/3] external web — 1 session-grant ask (origin=web) ---"
WEB_Q="${QUESTIONS[$(( (OFFSET + A2A_COUNT) % N ))]}"
echo ">>> web: $WEB_Q"
# Best-effort: a Circle Gateway credit lag must not fail the whole daily run — engine + a2a
# already grew traction above. The web client recovers its session on the next run.
npm run web -- "$WEB_Q" 0.05 || echo "web client exited rc=$? (engine+a2a traction already recorded)"

echo
echo "=== keryx traction run DONE ==="
date -u

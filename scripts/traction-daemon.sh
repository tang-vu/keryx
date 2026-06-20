#!/usr/bin/env bash
# Continuous (24/7) traction daemon — runs under pm2 as "keryx-traction".
# Emits a gentle, RANDOMIZED trickle of real Arc-testnet settlement around the clock so both
# dashboard provenance buckets grow smoothly all day (not in one daily burst):
#   - engine (origin=engine): 1 query every tick
#   - a2a    (origin=a2a):     1 paid call every A2A_EVERY ticks
#   - web    (origin=web):     1 session-grant ask every WEB_EVERY ticks
#
# Ticks run SEQUENTIALLY with a randomized sleep between them. The engine and the server-side
# a2a collectRun share one spend wallet (data/spend-wallet.json); doing one thing at a time
# (and waiting for each npm run to return) avoids nonce races. Failures never stop the loop.
#
# Tunable via env (set in the pm2 ecosystem env or shell). Defaults aim for a modest daily total
# (~20 engine / ~5 a2a / ~2 web) spread across 24h — a few %/day on the current base.
set -uo pipefail
cd /root/keryx

MIN_SLEEP="${KERYX_TICK_MIN_SLEEP:-2700}"   # 45 min — lower bound between ticks
MAX_SLEEP="${KERYX_TICK_MAX_SLEEP:-5400}"   # 90 min — upper bound between ticks
A2A_EVERY="${KERYX_A2A_EVERY:-4}"           # an a2a call every Nth tick
WEB_EVERY="${KERYX_WEB_EVERY:-9}"           # a web ask every Nth tick

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
SPAN=$(( MAX_SLEEP - MIN_SLEEP + 1 ))
tick=0

echo "keryx-traction daemon up $(date -u) — sleep ${MIN_SLEEP}-${MAX_SLEEP}s · a2a every ${A2A_EVERY} · web every ${WEB_EVERY}"
while true; do
  tick=$((tick+1))
  q="${QUESTIONS[$(( RANDOM % N ))]}"

  echo "[$(date -u +%H:%M:%S)] tick #$tick — engine 1q"
  npm run seed -- --count 1 --budget 0.04 --delay 200 || echo "engine tick rc=$?"

  if (( tick % A2A_EVERY == 0 )); then
    echo "[$(date -u +%H:%M:%S)] tick #$tick — a2a"
    npm run a2a -- "$q" 0.03 || echo "a2a tick rc=$?"
  fi

  if (( tick % WEB_EVERY == 0 )); then
    echo "[$(date -u +%H:%M:%S)] tick #$tick — web"
    npm run web -- "$q" 0.05 || echo "web tick rc=$?"
  fi

  SLEEP=$(( MIN_SLEEP + RANDOM % SPAN ))
  echo "[$(date -u +%H:%M:%S)] sleeping ${SLEEP}s"
  sleep "$SLEEP"
done

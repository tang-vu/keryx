# Arc Network & CLI Research Report

**Date:** 2026-06-15  
**Scope:** ARC-cli repository analysis + official Arc documentation  
**Focus:** Hackathon integration for pay-per-request stablecoin settlement

---

## Part A: ARC-cli Repository Analysis

### What ARC-cli Does

**ARC-cli** is a Python CLI tool (`arc-canteen`) that bundles three distinct workflows:

1. **Project Tracking** — local event queue for hackathon progress (traction/product updates)
2. **JSON-RPC Access** — authenticated HTTP proxy to Arc testnet
3. **Agent Context Bundler** — syncs Arc + Circle docs + 5 sample codebases for LLM agents

### Exposed Commands

**Core:**
- `arc-canteen login` — GitHub OAuth → gets RPC token (valid 90 days)
- `arc-canteen logout` — invalidate server-side token
- `arc-canteen status` — show dashboard (profile, RPC URL, recent updates)

**JSON-RPC:**
- `arc-canteen rpc <method> [params_json]` — proxy call to Arc chain (e.g., `eth_blockNumber`)
- `arc-canteen rpc-url [--export]` — print RPC URL with token embedded
- `arc-canteen rotate-rpc-key` — mint fresh 90-day token, update `~/.arc-canteen/env`
- `arc-canteen shell-init` — print shell rc snippet to auto-load `$RPC`

**Agent Context:**
- `arc-canteen context` — dump AGENTS.md + flat path manifest for piping to agents
- `arc-canteen context sync` — clone/pull `the-canteen-dev/context-arc` (docs + submodules)
- `arc-canteen context --full` — inline all .md / .yaml files

**Progress Tracking (Hackathon):**
- `arc-canteen update-traction` / `arc-canteen update-product` — submit milestones
- `arc-canteen ls [traction|product|all]` — list all updates
- `arc-canteen push` — sync queued events to server

### RPC Configuration & Endpoint

**Testnet RPC URL Format:**
```
https://rpc.testnet.arc-node.thecanteenapp.com/v1/<token>
```

**How to get it:**
1. `arc-canteen login` (GitHub) → stores token at `~/.arc-canteen/config.yaml`
2. `arc-canteen rpc-url` prints it
3. Token persisted to `~/.arc-canteen/env` for shell auto-load

**Authentication:** Bearer token in `Authorization: Bearer <token>` header OR embedded in URL path.

**Chain Details:**
- Chain ID: `5042002`
- Native gas token: USDC
- Block Explorer: `https://testnet.arcscan.app`
- EVM-compatible: yes

**Method Allowlist:** The proxy enforces an allowlist; disallowed methods return `403 method '<x>' not allowed by the proxy`.

### Context Bundling

`arc-canteen context sync` clones:
- **Repo:** `github.com/the-canteen-dev/context-arc`
- **Contents:** AGENTS.md entry point + developer docs for Arc + Circle + 5 sample codebases (as git submodules)
- **Local path:** `~/.arc-canteen/context/`

Pipe-friendly output: `arc-canteen context | your-agent`

### Wallet / Faucet Commands

**None in ARC-cli itself.** Faucet is external (see Part B).

### Exact Usage Examples

```bash
# Login & get RPC URL
arc-canteen login
arc-canteen rpc-url
# → https://rpc.testnet.arc-node.thecanteenapp.com/v1/swrm_abc123...

# Make RPC calls
arc-canteen rpc eth_blockNumber
arc-canteen rpc eth_chainId
arc-canteen rpc eth_getBalance '["0xabc...", "latest"]'

# Auto-load in shell
arc-canteen shell-init >> ~/.zshrc
source ~/.arc-canteen/env
# $RPC now set, use with cast / viem / ethers / web3.py

# Rotate token (90-day expiry policy)
arc-canteen rotate-rpc-key

# Sync context for agents
arc-canteen context sync
arc-canteen context | claude --file /dev/stdin
```

---

## Part B: Official Arc Documentation

### 1. Arc Chain Basics

| Property | Value |
|----------|-------|
| **Chain ID** | `5042002` |
| **Native Gas Token** | USDC (with EURC, USYC natively supported) |
| **Block Explorer** | `https://testnet.arcscan.app` |
| **EVM Compatible** | Yes (Osaka fork); deploy Solidity with Hardhat, Foundry, Viem |
| **Consensus** | Malachite BFT |
| **Finality** | Deterministic, sub-second; no chain reorg risk |
| **Block Time** | ~0.48s (testnet) |
| **Testnet Name** | Arc Testnet (implicit; no separate name) |
| **Mainnet Status** | UNPROVISIONED (RPC not yet available) |

**URLs:**
- **Testnet RPC (Circle):** `https://rpc.testnet.arc.network`
- **Testnet WebSocket:** `wss://rpc.testnet.arc.network`
- **Testnet RPC (Canteen-hosted):** `https://rpc.testnet.arc-node.thecanteenapp.com/v1/<token>`
- **Alt Providers:** Blockdaemon, dRPC, QuickNode

### 2. Testnet RPC Endpoint

**Primary endpoint (unauthenticated):**
```
https://rpc.testnet.arc.network
```

**Canteen-hosted (token-authenticated):**
```
https://rpc.testnet.arc-node.thecanteenapp.com/v1/<token>
```

**Connection Methods:**
- Direct HTTP POST with chain ID `5042002`
- All standard Ethereum JSON-RPC methods supported
- WebSocket available for subscriptions
- Viem: `http(process.env.RPC)`
- Ethers v6: `new JsonRpcProvider(process.env.RPC)`
- Foundry: `cast block-number --rpc-url $RPC`

### 3. Faucet Access

**URL:** `https://faucet.circle.com`

**Tokens Available:**
- USDC (20 testnet USDC per address every 2 hours)
- EURC
- cirBTC

**Supported Networks:** 30+ testnets (Ethereum Sepolia, Arbitrum Sepolia, Polygon Amoy, Solana Devnet, Avalanche Fuji, Base Sepolia, etc.)

**Steps:**
1. Visit faucet.circle.com
2. Select token (USDC)
3. Select network (Arc Testnet)
4. Enter wallet address
5. Submit request (rate limit: 1 req per asset/network pairing per 2 hours)
6. Receive tokens in ~seconds

**For Larger Amounts:** Request via Circle Discord community

### 4. USDC on Arc Testnet

**Documentation states:** USDC testnet addresses documented in Circle's developer docs (specific address NOT provided in fetched docs).

**Verified Source:** Circle Dev Docs reference "USDC testnet addresses" by chain; for Arc specifically, address is available in Circle documentation (not extracted in this fetch).

**Workaround:** Use faucet.circle.com directly (it abstracts contract addresses); or check Circle's USDC testnet contract list in their full reference.

### 5. App Kit Overview & Use Case Fit

**What It Is:** Multichain SDK for payments + liquidity, wrapping Circle's protocols (Gateway, CCTP).

**Core Capabilities (one-liner each):**
- **Send** — Move tokens between wallets on same chain
- **Bridge** — Transfer USDC between blockchains (Circle Gateway / CCTP)
- **Swap** — Exchange tokens on same chain
- **Unified Balance** — Chain-abstracted balance for spending across networks

**Installation:**
```bash
npm install @circle-fin/app-kit @circle-fin/adapter-viem-v2 viem
```
(or: Ethers, Solana, Circle Wallets adapters)

**Requirements:**
- Free kit key from console.circle.com (for swap)
- Chosen wallet adapter (Viem, Ethers, Solana, or Circle Wallets)

**Use Case Fit for Pay-Per-Request:**
- **Optional, not mandatory** — App Kit is for **multi-wallet, multichain orchestration**
- **Better for:** Merchants accepting USDC from any chain, wanting unified balance
- **Not needed for:** Simple pay-per-request on single chain; basic JSON-RPC + direct contract calls suffice
- **Recommendation:** Use bare RPC + contract ABIs if only Arc testnet; adopt App Kit if expanding to multichain or supporting customer wallets

### 6. Sample Applications

| App | Purpose | Tech |
|-----|---------|------|
| **Arc Commerce** | USDC credit purchases, webhook-driven settlement | Next.js, developer-controlled wallets |
| **Arc P2P Payments** | Gasless P2P USDC via passkey-protected modular wallets | Modular Wallets, Passkeys |
| **Arc Escrow** | AI-validated freelance escrow, Refund Protocol settlement | Refund Protocol, AI validators |
| **Arc Multichain Wallet** | Unified USDC balance + crosschain transfers | Circle Gateway, Wagmi |
| **Arc Fintech** | Multichain treasury console, capital movement | Bridge Kit, Gateway |

All are open-source, cloneable, and available in the `context-arc` bundle (via `arc-canteen context sync`).

---

## Verification Trail

| Claim | Source | Verified |
|-------|--------|----------|
| ARC-cli RPC endpoint | `arc_canteen/rpc.py` line 20 | ✅ |
| Testnet RPC Canteen URL | arc-node.thecanteenapp.com fetch | ✅ |
| Chain ID `5042002` | docs.arc.io + rpc.py | ✅ |
| App Kit install cmd | docs.arc.io/app-kit/tutorials | ✅ |
| Faucet URL & rate limits | faucet.circle.com fetch | ✅ |
| Sample apps | docs.arc.io/references/sample-applications | ✅ |

---

## Key Findings for Hackathon Implementation

### RPC Access
- **ARC-cli provides immediate authenticated RPC access** via `arc-canteen login` → `arc-canteen rpc`
- **Direct RPC also works** at `https://rpc.testnet.arc.network` (unauthenticated) or via Blockdaemon/dRPC/QuickNode
- **Token rotation every 90 days** is a policy; tokens auto-expire after 90 days of disuse

### Wallet Funding
- **Faucet only for testnet USDC** (via faucet.circle.com)
- **No built-in wallet commands** in ARC-cli; bring your own wallet (MetaMask, WalletConnect, ethers.js, etc.)
- **No native gas token** — USDC is the gas token; faucet provides it

### App Kit Assessment
- **Optional for basic pay-per-request** — use raw RPC + contract interactions
- **Valuable if:** customer wallets, multichain, unified balance abstraction
- **Adds complexity** — new dependency, kit key requirement, adapter selection

### Agent Context
- **`arc-canteen context sync`** is powerful for **rapid onboarding** — bundles docs + 5 real projects
- **Ideal for:** agent-driven development, hackathon pivots, exploring patterns

---

## Unresolved Questions

1. **USDC contract address on Arc testnet** — fetched docs reference it but don't inline it; available in Circle's USDC contract list but not extracted
2. **Exact method allowlist** for ARC-cli RPC proxy — docs state it enforces one, but don't enumerate disallowed methods
3. **Mainnet availability** — RPC not yet provisioned; no ETA
4. **Token storage security** — tokens live plaintext in `~/.arc-canteen/config.yaml` (0600 perms); no encryption mechanism documented

---

## Friction & Recommendations

### Friction Points
1. **Testnet-only RPC** — mainnet not available; integration requires migration plan
2. **Method allowlist opacity** — may block some protocol interactions; test early
3. **90-day token rotation** — policy enforced client-side; set reminders or automate `rotate-rpc-key`
4. **USDC as gas token** — unusual; impacts gas estimation (no separate gas token)
5. **Faucet rate limits** — 20 USDC per 2h per address; test locally, request bulk for integration tests

### Recommendations
1. **Use ARC-cli for RPC in hackathon** — GitHubOAuth + token management handled
2. **Defer App Kit unless multichain** — save complexity; use viem + ethers directly for single-chain
3. **Script faucet requests** — batch fund test accounts before CI/CD runs
4. **Store token rotation date** — remind devs 75 days after login to refresh
5. **Lock down `~/.arc-canteen/config.yaml`** — enforces 0600 perms; audit before production


# Research: Circle Developer Docs for Arc Hackathon (Nanopayments, x402, CLI, Wallets, USDC)

**Date:** 2026-06-15  
**Status:** COMPLETED  
**Scope:** Official Circle documentation research on nanopayments, x402, CLI, wallets, and USDC on Arc

---

## 1. NANOPAYMENTS / GATEWAY

### Definition & Mechanism
- **What:** Circle Gateway's system enabling "gas-free USDC nanopayments by batching thousands of payments into a single onchain transaction" via x402 protocol and EIP-3009 payment authorizations
- **Minimum unit:** $0.000001 USDC per payment (sub-cent)
- **Batching mechanism:** 
  - Buyers fund a Gateway balance with USDC
  - Agents authorize payments offchain using signed EIP-3009 messages (zero gas)
  - Merchants submit authorizations to Nanopayments for instant verification
  - System validates signatures + checks available balance in real-time
  - Thousands of transactions batch into single onchain commitment
  - Settlement occurs periodically (throughout the day) in consolidated batches
  - Eliminates per-transaction gas costs; maintains sub-second UX

### Use Cases
- Agent-to-agent high-frequency transactions
- Usage-based billing (pay-per-use AI services)
- Machine-to-machine commerce
- Micropayment monetization

### API / SDK
- **Reference:** Documentation mentions `/api-reference/gateway/all/settle-x402payment` endpoint exists
- **Status:** UNVERIFIED — specific endpoint URLs and SDK method names not detailed in fetched docs
- **Direction:** See "Complete API Reference" section for full endpoint discovery

**Source:** https://developers.circle.com/gateway/nanopayments, https://www.circle.com/nanopayments

---

## 2. X402 PROTOCOL

### Definition & Flow
- **What:** "HTTP-native payment protocol" enabling "pay-per-request without subscriptions or API keys"
- **Discovery model:** Agents search services via `circle services search "<keyword>" --output json` (CLI command)
- **Payment flow:**
  1. Service endpoint returns 402 (Payment Required) response if payment needed
  2. Response includes x402 payment request details
  3. Agent calls `circle services pay "<service-url>"` with agent address, chain, and data
  4. Nanopayment processed; request retried with payment proof
  5. Service returns 200 with response

### SDK/Packages
- **Batching implementation:** `@circle-fin/x402-batching` (npm package)
- **CLI tool:** `@circle-fin/cli` — primary interface (see section 3)
- **Fetch convenience library:** UNVERIFIED reference to `x402-fetch` pattern; exact package name not confirmed in fetched docs

**Sources:** https://www.circle.com/nanopayments, https://agents.circle.com

---

## 3. CIRCLE CLI

### Installation & Requirements
- **Install command:** `npm install -g @circle-fin/cli`
- **Node version:** Node.js v20.18.2 or later
- **Verification:** `which circle` or `command -v circle`

### Key Commands

#### Wallet Management
```bash
circle wallet status                                    # Check login status
circle wallet login <email> --init                      # Request OTP
circle wallet login --request <request-id> --otp <code> # Verify OTP
circle wallet create                                    # Create agent-controlled wallet
circle wallet list --chain BASE --type agent            # List wallets
circle wallet balance --address <addr> --chain BASE     # Check USDC balance
```

#### Service Discovery & Payment
```bash
circle services search "<keyword>" --output json        # Find x402 services
circle services pay "<service-url>" \
  --address <addr> \
  --chain BASE \
  --data '{"key":"value"}'                              # Pay for service & execute
```

#### Installation & Skills
```bash
circle skill install --tool <tool>                      # Install individual skill
npx skills add circlefin/skills -g                      # Install full skill pack
```

### Critical Notes
- **Full-access mode required:** Network + read/write home directory
- **Terms gate:** First run requires explicit user consent to Terms of Service (Appendix A)
- **No hardcoding:** Never store secrets, OTP codes, or private keys
- **Chain requirement:** `--chain` flag mandatory for all wallet operations (BASE is primary EVM)
- **OTP validity:** Codes expire after 10 minutes; request IDs are single-use

### Claude Code Integration
- UNVERIFIED — documentation references "major AI platforms including Claude Code, Cursor, OpenAI Codex" but specific skill hooks not documented in fetched materials

**Source:** https://developers.circle.com/agent-stack/circle-cli, https://agents.circle.com/skills/setup.md, https://agents.circle.com/skills/wallet-login.md

---

## 4. CIRCLE WALLETS

### Custody Models

| Model | Definition | Suitable for Agents? |
|-------|-----------|----------------------|
| **Developer-controlled** | You create & operate wallets for users; you move funds / run actions on their behalf | ✅ YES — recommended for autonomous agents |
| **User-controlled** | Users control own wallets via sign-in (social, email, PIN); users approve each transaction | ❌ Not ideal for agents (requires per-txn approval) |
| **Modular** | Smart contract wallets with passkeys & gasless transactions | Possible, not explicitly confirmed for agents |

### Programmatic Creation

#### SDK Packages (UNVERIFIED — not explicitly named in fetched docs)
Documentation mentions:
- "REST APIs and Web and Mobile SDKs (Android and iOS)" available
- One integration surface for REST APIs + Web/Mobile SDKs
- **Actual package names:** NOT detailed in accessible docs

#### Setup Method (Verified via CLI)
Agents operate wallets through **Circle CLI without writing integration code:**
```bash
circle wallet create  # Creates agent-controlled wallet on EVM (BASE)
```

#### Funding & Balance
```bash
circle wallet balance --address <addr> --chain BASE --output json
# Route funding via wallet-fund skill (separate documentation)
```

### Supported Chains
- Primary: BASE (Ethereum L2)
- Full list of supported chains documented but not enumerated in this research

**Source:** https://developers.circle.com/wallets, https://agents.circle.com/skills/setup.md

---

## 5. USDC ON ARC

### Contract Addresses
- **Arc Mainnet:** `0x3600000000000000000000000000000000000000`
- **Arc Testnet:** `0x3600000000000000000000000000000000000000` (same as mainnet)
- **Related (Arbitrum One):** `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`

### Supported Networks (Complete List)
Circle supports USDC on 30+ blockchains including:
Algorand, Aptos, Arbitrum, **Arc**, Avalanche C-Chain, Base, Codex, Celo, EDGE, Ethereum, Hedera, HyperEVM, Injective, Ink, Linea, Monad, Morph, NEAR, Noble, OP Mainnet, Pharos, Plume, Polkadot Asset Hub, Polygon PoS, Sei, Solana, Sonic, Starknet, Stellar, Sui, Unichain, World Chain, XDC, XRPL, ZKsync Era (mainnet + testnet versions)

### Integration Approaches
1. Direct smart contract integration for customizable fund flows
2. Circle Developer Services (for blockchain newcomers)
3. Cross-Chain Transfer Protocol (CCTP) for multi-chain apps

**Source:** https://developers.circle.com/stablecoins/what-is-usdc, implied from https://developers.circle.com/llms.txt

---

## 6. API KEYS & CREDENTIALS

### Required Credentials (Identified, Path UNVERIFIED)
- **API Key types:** Referenced as "API key types and authentication methods" in documentation index
- **Auth method:** Bearer token in Authorization header (documented)
- **Console location:** UNVERIFIED — direct link to developer console/dashboard not accessible in fetched docs

### Authentication Protocol
- **Email + OTP:** Primary method (verified via CLI)
  - Email sent OTP code
  - OTP valid 10 minutes
  - Request ID generated on init; valid 10 minutes
  - Single-use only
  
- **API Key auth:** UNVERIFIED exact flow (referenced as available but not detailed)

### Setup Path (Implied)
1. Create developer account at Circle dashboard (URL: UNVERIFIED)
2. Generate API keys in account settings
3. Store as Bearer token for API calls
4. Use email/OTP for CLI authentication

**Source:** https://developers.circle.com/llms.txt (index reference only), https://agents.circle.com/skills/wallet-login.md (CLI auth verified)

---

## UNRESOLVED QUESTIONS

1. **Nanopayment API endpoints:** What are the exact REST API endpoint URLs for creating, authorizing, and settling nanopayments? (Reference mentions `/api-reference/gateway/all/settle-x402payment` but full API docs not accessed)

2. **Wallet SDK packages:** What are the npm package names for developer-controlled wallet creation? (Docs reference SDKs exist but don't name them; CLI is the workaround)

3. **x402-fetch package:** Is there a published npm package called `x402-fetch` or similar convenience library? (Mentioned in passing on agents.circle.com; unverified if it's public)

4. **Developer console URL:** What is the exact URL to access the Circle developer dashboard to create API keys? (Referenced but not linked in fetched docs)

5. **Claude Code skills integration:** How exactly does Circle CLI wire into Claude Code? What skills are exposed? (Mentioned Circle works with Claude Code but integration details not documented in accessible pages)

6. **Wallet SDK method signatures:** What are the exact method names for:
   - Creating a wallet programmatically (not via CLI)
   - Funding a wallet
   - Checking balance
   - Authorizing x402 payments
   (CLI commands verified; SDK methods not documented in fetched materials)

7. **Settlement timing & fees:** What is the exact settlement schedule (how often batches are committed onchain)? What are the fee structures? (Docs mention "throughout the day" but exact timing/fees not detailed)

---

## FRICTION FOR DEVELOPERS

1. **SDK discovery:** Wallet creation documented only via CLI, not SDK. Developers unclear if they need direct SDK integration or if CLI is sufficient for production agents.

2. **API endpoint fragmentation:** Nanopayments referenced as having endpoints but full API reference not easily discoverable from main gateway page.

3. **Console access:** No clear link to developer.circle.com dashboard from main developer docs; unclear how to generate API keys.

4. **x402 package uncertainty:** Multiple integration points (Circle CLI, @circle-fin/x402-batching, unverified x402-fetch) with unclear when to use each.

5. **Claude Code integration:** Marketed as "works with Claude Code" but actual skill bindings and integration code not publicly documented.

6. **Testnet setup:** Arc testnet address documented (contract), but no guide on faucet, testnet RPC, or getting Arc test tokens for funding wallets.

---

## SOURCES VERIFIED

- https://developers.circle.com/gateway/nanopayments ✓
- https://www.circle.com/nanopayments ✓
- https://developers.circle.com/agent-stack ✓
- https://developers.circle.com/agent-stack/circle-cli ✓
- https://developers.circle.com/wallets ✓
- https://developers.circle.com/stablecoins/what-is-usdc ✓
- https://developers.circle.com/llms.txt ✓
- https://agents.circle.com/skills/setup.md ✓
- https://agents.circle.com/skills/wallet-login.md ✓
- https://agents.circle.com ✓

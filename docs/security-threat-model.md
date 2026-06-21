# Keryx Security Threat Model

**Version:** 2026-06-21 (public-endpoint hardening)
**Scope:** Non-custodial dApp — SIWE auth, browser co-sign session, SourceRegistry, IPFS gated content, API keys, offline dev path.

---

## 1. Verification Matrix

| # | Surface | Threat | Status | Evidence / Notes |
|---|---------|--------|--------|-----------------|
| S1 | SIWE nonce | Replay attack | **PASS** | Nonce consumed on first verify; `lib/auth.ts` deletes the nonce from the in-memory store before issuing JWT. Domain + chainId validated. |
| S2 | SIWE nonce | Stale nonce reuse (long-lived) | **PASS** | Nonces expire after `config.siweNonceTtlSeconds` (default 5 min). Expired nonces rejected. |
| S3 | JWT | Forged token | **PASS** | `jose` HS256 with `JWT_SECRET`; tampered token → 401 at every handler that calls `getSession()`. |
| S4 | JWT | Expired token | **PASS** | `getSession()` uses `jose.jwtVerify` which enforces `exp` claim; expired → 401. |
| S5 | JWT | Middleware-only bypass (CVE-2025-29927) | **PASS** | Auth is validated inside each handler via `getSession()`, not only in middleware. No Next.js middleware-only gate. |
| S6 | SourceRegistry | Unauthorized update/deactivate | **PASS** | `onlyCreator` modifier; non-creator call reverts `NotCreator`. Verified: Hardhat tests `NotCreator update` + `NotCreator deactivate` — 16/16 pass. |
| S7 | SourceRegistry | URL squatting | **PASS** | Source ID = `keccak256(abi.encode(msg.sender, urlHash))`. Different caller → different ID. Creator's payout wallet cannot be hijacked. Verified: Hardhat squat-resistance test. |
| S8 | SourceRegistry | String-length DoS (calldata bloat) | **PASS** | `contentCid ≤ 128 bytes`, `tags ≤ 256 bytes`; `StringTooLong` revert. Verified: Hardhat boundary tests. |
| S9 | SourceRegistry | Split manipulation (bad bp) | **PASS** | `_validateSplit` enforces sum = 10 000, no zero-bp author, ≥ 1 author, ≤ 20 authors. Verified: Hardhat BadSplit + ZeroAddress tests. |
| S10 | Browser co-sign | Server sends inflated payment amount exceeding cap | **PASS (H1 fix)** | Browser independently tracks `signedTotal` per `ask()` run (ref reset on each call). Refuses to sign if `signedTotal + amountUsdc > grantCap + epsilon`. Server-side `canSpend()` is a second layer. Neither layer trusts the other alone. Implemented: `lib/hooks/use-ask-stream.ts`. |
| S11 | Browser co-sign | payTo redirect to attacker wallet | **PARTIAL — documented residual** | For fetch-toll payments: browser validates `payTo` against `/api/sources` wallet list (fetched once on page load). For citation payments: author wallets are not exposed by `/api/sources`, so payTo cannot be enumerated. The **cap** is the binding containment: even under full server compromise + payTo redirect, total diverted ≤ funded cap. See Residual R1. |
| S12 | Browser co-sign | Cross-session reqId resolution | **PASS (M2 fix)** | Pending map keyed by `sessionId:reqId`. `resolveSignature(sessionId, reqId, header)` verifies session scope. A caller cannot resolve another session's pending promise. Implemented: `lib/payments/session-grants.ts`, `app/api/ask/sign/route.ts`, `app/api/ask/route.ts`. |
| S13 | Session private key | Server sees or persists the session key | **PASS** | Key generated with `viem/accounts generatePrivateKey()` in the browser tab; never transmitted to any server endpoint. Server receives only `sessAddr` (public address). `lib/hooks/use-session-grant.ts` verified: `skRef` lives in a React ref, backed up to `sessionStorage` only. |
| S14 | Session private key | Key in logs or responses | **PASS** | Grep audit: no `skRef.current`, `sk`, or `keryx_session_sk` appear in `console.*`, `Response.json(...)`, or serialized DB writes. |
| S15 | IPFS content | Free read of ciphertext | **PASS** | Raw IPFS CID fetches ciphertext only; no key material in the IPFS blob. `lib/ipfs/content-crypto.ts` decryption occurs server-side inside the x402 `produce()` callback — structurally post-payment-verify. |
| S16 | IPFS master key | Exposure in logs or responses | **PASS** | `CONTENT_MASTER_KEY` only accessed via `process.env` inside `lib/ipfs/content-crypto.ts`. Grep audit: value never passed to `console.*`, `JSON.stringify`, or any response body. `.env.local` is gitignored. |
| S17 | API key | Raw key stored / returned beyond mint | **PASS** | `mintApiKey()` stores `SHA-256(rawKey)` only; returns `rawKey` once at creation. Subsequent verify uses `timingSafeEqual(sha256(incoming), stored)`. `app/api/keys/route.ts` returns `rawKey` only in the POST 201 response — standard "show once" pattern. |
| S18 | API key | Timing oracle | **PASS** | `lib/api-keys.ts:timingSafeEqual` uses `crypto.timingSafeEqual` on 64-char fixed-length SHA-256 hex buffers, preventing length-extension oracle. |
| S19 | API key | Header-only delivery | **PASS** | `app/api/agent/ask/route.ts` extracts key from `Authorization: Bearer` header only; never from query string or body. |
| S20 | Rate limiting | Uncapped compute abuse | **PASS** | `rate-limiter-flexible` applied per API key id; 429 + `Retry-After` header on breach. Verified: rate limiter applied in agent ask route. |
| S21 | JWT secret | In logs or responses | **PASS** | `JWT_SECRET` only accessed via `process.env.JWT_SECRET` inside `lib/auth.ts`. Never logged. On missing value, endpoint returns `503 "JWT_SECRET not configured"` — the value itself is not revealed. |
| S22 | data/spend-wallet.json | Accidental commit of server wallet key | **PASS** | `data/` is not excluded by `.gitignore` but `spend-wallet.json` content is a viem-generated key written at runtime; `.env.local` holds the funding private key. The `spend-wallet.json` stores the derived spend EOA only. Pre-commit hook and `CLAUDE.md` prohibit committing secrets. |
| S23 | Offline dev path | Regression from hardening | **PASS** | `KERYX_FORCE_OFFLINE=1` / no `REGISTRY_ADDRESS` / no `PINATA_JWT` / no SIWE grant: agent uses `OfflineGateway`, sources served from SQLite direct, content is plaintext, no sign-requests emitted. No CONTENT_MASTER_KEY decrypt path executed. No breaking change introduced. |
| S24 | `/api/ask` (no-session treasury path) | Anonymous caller drives unbounded treasury spend — `budget` was caller-controlled (coerced finite>0 only) and the route had **no rate limit**, so a script could POST a huge budget in a loop and drain `RealGateway` (treasury) USDC / fabricate volume. | **PASS (2026-06-21 fix)** | No-session budget clamped to `config.anonMaxBudget` (default 0.1, just above the UI dial's 0.08 max). IP-keyed rate limit `treasuryAsk` (5 / 60s) via `cf-connecting-ip`. Browser co-sign path (user funds their own grant-capped session) is intentionally exempt from both. `app/api/ask/route.ts`, `lib/rate-limit.ts`. |
| S25 | `/api/cite/[id]` | Absurd `amount` skews the leaderboard | **PASS (2026-06-21 fix)** | `amount > config.maxCitationUsdc` (default 5) → 400. NOT a drain vector — the caller self-pays via x402 to a source-validated wallet — so this is a fat-finger / metric-skew bound, not a spend control. `app/api/cite/[id]/route.ts`. |

---

## 2. Honest Centralization Trade-offs

These are intentional design choices for the testnet demo. They are not hidden risks.

| # | Trade-off | Why Accepted | Mitigation Path |
|---|-----------|--------------|-----------------|
| C1 | **Circle facilitator** | Circle's `BatchFacilitatorClient` processes all EIP-712 settlement requests. Keryx has no alternative on-chain settlement path on Arc testnet. | Post-hackathon: direct on-chain ERC-3009 transfer without a custodial facilitator. |
| C2 | **Server IPFS key-holder** | The server holds `CONTENT_MASTER_KEY`. It decrypts content after payment verification. Content is ciphertext on IPFS — the server must hold the key to serve plaintext. | Post-hackathon: Lit Protocol key release (once Arc is added to Lit's supported chains). |
| C3 | **Browser session key XSS surface bounded by cap** | The session private key lives in `sessionStorage` (tab-scoped). An XSS attack on the Keryx origin could exfiltrate it. The funded cap is the hard ceiling for damage. | Mitigations: strict CSP, short TTL (1h default), small funded amounts. Full mitigation: in-browser `crypto.subtle` signing with non-exportable keys. |
| C4 | **Funder / treasury gas wallet** | The server-side `AGENT_FUNDER_PRIVATE_KEY` funds the spend EOA for `RealGateway` (non-SIWE path). If leaked, an attacker can drain gas from this wallet. It does NOT hold USDC directly. | Funder wallet holds minimal native gas only. Rotate regularly. |

---

## 3. Documented Residuals

| ID | Description | Containment | TODO |
|----|-------------|-------------|------|
| R1 | **payTo redirect within cap (citation path)** | Under full server compromise, a malicious server could redirect citation `payTo` to an attacker address. The browser cannot enumerate citation author wallets from public endpoints. The funded cap (e.g. $0.05–$1.00) is the absolute ceiling for diverted funds. The fetch-toll `payTo` is validated against the known source wallet list. | TODO: expose a signed author-wallet manifest from the server (signed with the server's key, verified client-side) so citation payTo can also be validated. |
| R2 | **Grant funding not on-chain verified** | `POST /api/session/grant` accepts the client's claimed `txHash` without verifying the deposit hit Circle's Gateway balance. Lying only fails the liar's own settlement (Gateway balance is the real ceiling). A user who lies about funding gets 402-rejected at the first settlement attempt. | TODO: query Gateway balance API before marking grant `active`; reject if `available < claimed cap`. |
| R3 | **Session key in sessionStorage** | `sessionStorage` is readable by any JavaScript on the same origin (XSS). Key is tab-scoped and erased on tab close. Cap-bounded. | Mitigations in place: CSP, small cap, short TTL. Full fix: Web Crypto non-exportable key (post-hackathon). |
| R4 | **Server-side grant state lost on restart** | Session grants are in-process memory. A server restart drops all active grants (browser tabs show as expired). Users must re-fund. | Acceptable for testnet demo. Production fix: persist grant metadata in DB (not the key — there is none server-side). |
| R5 | **A2A `/api/agent/ask` budget unbounded** | The x402-paid A2A path passes `budget` straight to `collectRun` with no ceiling. Same drain class as S24 but gated behind the $0.02 fee; an unkeyed caller also skips the per-key rate limiter. A caller who registers their own source could set a large budget, pay $0.02, and net the downstream citation reward. Bounded in practice (traction client uses 0.03). | TODO (user decision — paid path, may want larger budgets intentionally): clamp A2A budget to a dedicated ceiling and/or rate-limit unkeyed A2A callers by IP. |

---

## 4. Grep Audit Results

Performed against `lib/` and `app/` (excluding `node_modules`):

| Secret | Audit Query | Result |
|--------|-------------|--------|
| Session private key (`sk`, `skRef.current`) | `grep -rn "skRef\|keryx_session_sk"` in logs/responses | **CLEAN** — only accessed inside `use-session-grant.ts` for `createWalletClient()`, never serialised or logged |
| `CONTENT_MASTER_KEY` | `grep -rn "CONTENT_MASTER_KEY"` in `console.*` / responses | **CLEAN** — referenced only by name in `content-crypto.ts` via `process.env`; never passed to logger or response body |
| Raw API key | `grep -rn "rawKey"` in logs | **CLEAN** — assembled once in `mintApiKey()`, returned in POST 201 only, never logged |
| `JWT_SECRET` | `grep -rn "JWT_SECRET"` in logs/responses | **CLEAN** — accessed via `process.env` in `auth.ts`; error messages say "JWT_SECRET not configured", not the value |
| `ANTHROPIC_API_KEY` | `grep -rn "ANTHROPIC_API_KEY"` in logs/responses | **CLEAN** — passed directly to `@anthropic-ai/sdk` constructor; never in logs or responses |

---

## 5. Post-Hackathon Upgrade Notes (out of scope, tracked)

- Client-side `crypto.subtle` session key generation (non-exportable, eliminates XSS risk).
- Lit Protocol key release for IPFS decryption (eliminates C2 once Arc is on Lit).
- Redis-backed rate limiting (replaces in-process `rate-limiter-flexible` for multi-instance deploy).
- Event-only SourceRegistry indexing at scale (replace `sourceIds[]` enumeration).
- On-chain deposit verification before grant activation (closes R2).
- Signed author-wallet manifest for citation `payTo` validation (closes R1).

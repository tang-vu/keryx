/**
 * Keryx runtime configuration — single source of truth for chain, economics, and providers.
 * Everything is env-driven so flipping testnet → mainnet is one config change.
 */

export const config = {
  // ── Chain (Arc testnet defaults) ──
  network: process.env.KERYX_NETWORK ?? "arcTestnet",
  // x402 network identifier used in payment requirements
  networkId: "eip155:5042002",
  rpcUrl: process.env.KERYX_RPC_URL ?? "https://rpc.testnet.arc.network",
  usdcAddress: (process.env.KERYX_USDC_ADDRESS ??
    "0x3600000000000000000000000000000000000000") as `0x${string}`,
  gatewayWallet: (process.env.KERYX_GATEWAY_WALLET ??
    "0x0077777d7EBA4688BDeF3E311b846F25870A19B9") as `0x${string}`,
  // GatewayMinter contract — mints USDC on the destination chain from a Circle transfer
  // attestation. Used by the creator-withdraw relay to submit gatewayMint(). Testnet value
  // from @circle-fin/x402-batching CHAIN_CONFIGS.arcTestnet.gatewayMinter.
  gatewayMinter: (process.env.KERYX_GATEWAY_MINTER ??
    "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B") as `0x${string}`,
  explorerUrl: "https://testnet.arcscan.app",
  gatewayBalanceApi: "https://gateway-api-testnet.circle.com/v1/balances",
  cctpDomain: 26,

  // ── Agent economics (USDC) ──
  defaultBudget: num(process.env.KERYX_DEFAULT_BUDGET, 0.05),
  // share of a query's budget reserved for weighted citation rewards (rest is fetch tolls)
  citationPoolRatio: num(process.env.KERYX_CITATION_POOL_RATIO, 0.5),
  defaultFetchPrice: num(process.env.KERYX_DEFAULT_FETCH_PRICE, 0.002),
  // x402 authorization validity window (seconds). The buyer signs validBefore = now + this value;
  // Circle's Gateway facilitator requires the REMAINING validity at verify time to be >= 7 days
  // (604800s) or it rejects with `authorization_validity_too_short`. Signing→verify latency (several
  // network hops), second-truncation, and host clock skew all erode that window, so a window of
  // exactly 604800 fails intermittently. Keep ~1 day of margin above the floor (no upper bound —
  // 30d still verifies). Empirically: <604800 always fails; 604800 is the floor with zero slack.
  maxTimeoutSeconds: Math.round(num(process.env.KERYX_MAX_TIMEOUT_SECONDS, 691200)),
  // Gateway spend-wallet top-up. Circle's facilitator won't settle against tiny balances, so the
  // agent keeps a healthy reusable Gateway balance and tops up when it drops below the threshold.
  gatewayDepositUsdc: process.env.KERYX_GATEWAY_DEPOSIT ?? "1",
  gatewayMinAvailableUsdc: num(process.env.KERYX_GATEWAY_MIN_AVAILABLE, 0.1),
  // Agent-to-agent: fee another agent pays Keryx to answer a question (x402 → treasury).
  a2aFeeUsdc: num(process.env.KERYX_A2A_FEE, 0.02),
  // Hard ceiling on the budget the anonymous (no-session) treasury path will honor. That path is
  // unauthenticated and spends Keryx's OWN funds (RealGateway), with `budget` caller-controlled —
  // without a cap a caller could POST an arbitrarily large budget and drive treasury spend. The
  // browser co-sign path spends the user's own funded session (grant-cap bounded) and is NOT
  // clamped. Default 0.1 sits just above the UI budget dial's 0.08 max, so the demo is unaffected.
  anonMaxBudget: num(process.env.KERYX_ANON_MAX_BUDGET, 0.1),
  // Sanity ceiling (USDC) on a single citation settlement reaching /api/cite. Not a drain vector
  // (the caller self-pays via x402 to a source-owned wallet), but bounds a fat-finger / absurd
  // `amount` that would skew the leaderboard. ~100×+ above any realistic weighted reward.
  maxCitationUsdc: num(process.env.KERYX_MAX_CITATION_USDC, 5),
  // Ceiling (USDC) on the fee a creator's instant Gateway withdraw will tolerate. The actual
  // same-chain fee on testnet is ~0; this is only an upper bound passed in the burn intent
  // (mirrors the SDK/operator default of 2.01 so the proven withdraw path isn't fee-rejected).
  withdrawMaxFeeUsdc: num(process.env.KERYX_WITHDRAW_MAX_FEE, 2.01),
  // Ceiling on the budget the A2A path (/api/agent/ask) will honor before driving treasury-funded
  // creator payouts. Same drain class as anonMaxBudget but behind the x402 fee, so more generous.
  // The traction a2a-client uses 0.03, well under this.
  a2aMaxBudget: num(process.env.KERYX_A2A_MAX_BUDGET, 0.5),

  // ── Agent reasoning ──
  // Max re-evaluation rounds after the initial fetch pass. Each round assesses per-claim coverage
  // and may buy additional previously-skipped sources to fill gaps. 0 disables re-evaluation
  // (single-pass behavior, pre-v0.4). Default 1 keeps latency low while still showing multi-pass.
  reevaluateRounds: Math.round(num(process.env.KERYX_REEVALUATE_ROUNDS, 1)),

  // ── Open x402 marketplace discovery ──
  // When on, the agent probes the live Circle x402 service bazaar (`circle services search`) during
  // discovery and reasons over real external endpoints alongside its registered creators. These
  // settle on other chains (Base/ETH/… mainnet), not Keryx's Arc rail, so they are DISCOVERY-ONLY:
  // evaluated and logged, never purchased (the orchestrator enforces this, mirroring the budget cap).
  externalDiscovery: (process.env.KERYX_EXTERNAL_DISCOVERY ?? "1") !== "0",
  // Max external endpoints surfaced per query (top by topical relevance).
  externalDiscoveryLimit: Math.round(num(process.env.KERYX_EXTERNAL_DISCOVERY_LIMIT, 5)),

  // ── LLM ──
  // Provider priority: Anthropic > DeepSeek/OpenAI-compatible > offline heuristic.
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  deepseekKey: process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
  llmBaseUrl: process.env.KERYX_LLM_BASE_URL ?? "https://api.deepseek.com",
  llmModel: process.env.KERYX_LLM_MODEL ?? "deepseek-chat",
  synthesisModel: process.env.KERYX_SYNTHESIS_MODEL ?? "deepseek-chat",

  // ── App ──
  baseUrl: process.env.BASE_URL ?? "http://localhost:3000",

  // ── Auth ──
  // JWT_SECRET must be ≥ 32 bytes (256 bits) for HS256 security. When unset,
  // getSession() returns null (auth degrades gracefully — build passes, but
  // session routes won't issue real JWTs).
  jwtSecret: process.env.JWT_SECRET ?? "",
  // Comma-separated wallet addresses that receive the 'dev' role at sign-in time.
  // Lowercased at load time so comparisons are case-insensitive.
  devWallets: (process.env.KERYX_DEV_WALLETS ?? "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean),
  // Reown Cloud project ID for WalletConnect mobile wallet support.
  // Optional: when unset, only injected wallets (MetaMask, Rabby) are available.
  wcProjectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "",

  // ── IPFS / content encryption ──
  // When set, content is encrypted with AES-256-GCM and pinned to Pinata on ingest.
  // Plaintext is released only inside settleThenServe's produce() after x402 settles.
  // When unset (offline dev), content is served directly from the DB — no behavior change.
  pinataJwt: process.env.PINATA_JWT ?? "",
  // 32-byte hex master key used to wrap per-item AES keys. Never logged or transmitted.
  // Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  contentMasterKey: process.env.CONTENT_MASTER_KEY ?? "",
  // Public IPFS gateway for fetching encrypted blobs. Defaults to Pinata's public gateway.
  ipfsGatewayUrl: process.env.KERYX_IPFS_GATEWAY ?? "https://gateway.pinata.cloud",

  // ── Wallets ──
  // funderKey is Keryx's own TREASURY wallet — used by the volume engine, A2A, and collectRun.
  // It is NEVER used for user sessions (those are funded by the user's own browser-held EOA).
  sellerAddress: (process.env.SELLER_ADDRESS ?? "") as `0x${string}` | "",
  funderKey: (process.env.AGENT_FUNDER_PRIVATE_KEY ??
    process.env.BUYER_PRIVATE_KEY ??
    "") as `0x${string}` | "",

  // ── Session grants (browser co-sign, Phase 03) ──
  // TTL for a user's session grant. After this window the server stops honoring sign-requests
  // for that session, limiting the XSS exposure window to the funded session amount only.
  // Default: 3600s (1 hour). Expired grants prompt the user to re-grant or revoke residual.
  // NO server secret is stored for user sessions — the private key lives only in the browser tab.
  sessionGrantTtlSeconds: Math.round(num(process.env.KERYX_SESSION_GRANT_TTL, 3600)),

  // ── On-chain SourceRegistry ──
  // Set after deploying contracts/source-registry.sol to Arc testnet.
  // When unset: indexer is a no-op, register form falls back to DB-direct write.
  // NEXT_PUBLIC_ variant is also read so the browser can call useWriteContract.
  registryAddress: (process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS ??
    process.env.KERYX_REGISTRY_ADDRESS ??
    "") as `0x${string}` | "",
  // The block number at which SourceRegistry was deployed. The indexer uses this
  // as the cold-start backfill origin so it doesn't scan blocks before the contract exists.
  registryDeployBlock: process.env.KERYX_REGISTRY_DEPLOY_BLOCK ?? "0",
  // One-time deployer key — used ONLY for `npx hardhat run scripts/deploy-source-registry.ts`.
  // Never used for per-source writes (those are creator-signed from the browser).
  deployerKey: (process.env.DEPLOYER_PRIVATE_KEY ?? "") as `0x${string}` | "",
} as const;

export type LlmProvider = "anthropic" | "deepseek" | "heuristic";

/** Which reasoning engine to use, by available credentials. */
export function llmProvider(): LlmProvider {
  if (config.anthropicKey.length > 0) return "anthropic";
  if (config.deepseekKey.length > 0) return "deepseek";
  return "heuristic";
}

/** True when a real LLM key is present; otherwise Keryx runs in deterministic heuristic mode. */
export function hasLlm(): boolean {
  return llmProvider() !== "heuristic";
}

/** True when Supabase is configured; otherwise the local SQLite adapter is used. */
export function hasSupabase(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function num(v: string | undefined, fallback: number): number {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

// Startup warning: JWT_SECRET set but too short. Don't crash — offline dev (empty
// secret) is intentional and already handled by getSession() returning null.
// Only warn when a secret IS provided but is dangerously short (< 32 bytes).
if (config.jwtSecret.length > 0 && config.jwtSecret.length < 32) {
  console.warn(
    `[keryx config] JWT_SECRET is only ${config.jwtSecret.length} bytes — ` +
    "HS256 requires ≥ 32 bytes. Tokens are brute-forceable. " +
    "Run: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" to generate one.",
  );
}

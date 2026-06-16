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

  // ── LLM ──
  // Provider priority: Anthropic > DeepSeek/OpenAI-compatible > offline heuristic.
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  deepseekKey: process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
  llmBaseUrl: process.env.KERYX_LLM_BASE_URL ?? "https://api.deepseek.com",
  llmModel: process.env.KERYX_LLM_MODEL ?? "deepseek-chat",
  synthesisModel: process.env.KERYX_SYNTHESIS_MODEL ?? "deepseek-chat",

  // ── App ──
  baseUrl: process.env.BASE_URL ?? "http://localhost:3000",

  // ── Wallets ──
  sellerAddress: (process.env.SELLER_ADDRESS ?? "") as `0x${string}` | "",
  funderKey: (process.env.AGENT_FUNDER_PRIVATE_KEY ??
    process.env.BUYER_PRIVATE_KEY ??
    "") as `0x${string}` | "",
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

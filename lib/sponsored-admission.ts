/** Shared admission for hosted research that uses Keryx's treasury and model/search capacity.
 * Keys identify wallets; minting another key never creates another sponsored allowance. */
import { createHash } from "node:crypto";
import { consumeDurablePoint } from "./rate-limit-store";

const WINDOW_MS = 60_000;
// Preserve the existing treasuryAsk (5), ask (10), and public (60) per-minute tiers.
const ANONYMOUS_LIMIT = 5;
const IDENTIFIED_LIMIT = 10;
const DEFAULT_GLOBAL_LIMIT = 60;

export type SponsoredCaller =
  | { kind: "anonymous"; ip: string; wallet?: string }
  | { kind: "key"; ip: string; wallet: string }
  | { kind: "bot"; platform: "discord" | "slack" | "telegram"; userId: string };

type Bucket = { key: string; tier: string; points: number };

function ipKey(ip: string): string {
  return createHash("sha256").update(ip.trim() || "unknown").digest("hex");
}

function globalDispatchLimit(): number {
  const value = process.env.KERYX_SPONSORED_DISPATCHES_PER_MINUTE;
  if (value === undefined || value.trim() === "") return DEFAULT_GLOBAL_LIMIT;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new Error("Invalid sponsored dispatch admission configuration");
  }
  return Number(value);
}

async function admit(buckets: Bucket[]): Promise<Response | null> {
  try {
    // Every counter is atomic in the durable store. A later refusal retains earlier points:
    // conservative under concurrency, and no compensation race can manufacture capacity.
    for (const bucket of buckets) {
      const decision = await consumeDurablePoint(bucket.key, bucket.tier, bucket.points, WINDOW_MS);
      if (!decision.allowed) {
        const retryAfter = Math.max(1, Math.ceil(decision.msBeforeNext / 1000));
        return Response.json({
          error: "sponsored_rate_limit",
          message: "Sponsored dispatch capacity is temporarily full. Try again shortly or use caller-funded research.",
          retryAfter,
        }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
      }
    }
    return null;
  } catch {
    return unavailable();
  }
}

function unavailable(): Response {
  return Response.json({
    error: "sponsored_admission_unavailable",
    message: "Sponsored dispatch admission is temporarily unavailable. Try again shortly.",
    retryAfter: 60,
  }, { status: 503, headers: { "Retry-After": "60" } });
}

/** Call after authenticating/validating the request and before model, search, or payment work. */
export async function checkSponsoredResearchAdmission(caller: SponsoredCaller): Promise<Response | null> {
  let globalLimit: number;
  try { globalLimit = globalDispatchLimit(); } catch { return unavailable(); }
  const buckets: Bucket[] = [];
  if (caller.kind === "bot") {
    // Signed provider requests carry the user's platform id; provider IPs identify no end user.
    buckets.push({ key: `${caller.platform}:${caller.userId}`, tier: "sponsored-user", points: ANONYMOUS_LIMIT });
  } else {
    if (caller.wallet) {
      buckets.push({ key: caller.wallet.toLowerCase(), tier: "sponsored-wallet", points: IDENTIFIED_LIMIT });
    }
    const key = ipKey(caller.ip);
    if (caller.kind === "anonymous") {
      buckets.push({ key, tier: "sponsored-anonymous-ip", points: ANONYMOUS_LIMIT });
    }
    // Same bucket for key and anonymous requests, regardless of wallet count or entry surface.
    buckets.push({ key, tier: "sponsored-ip", points: IDENTIFIED_LIMIT });
  }
  // Locally throttled callers never burn the shared dispatch allowance.
  buckets.push({ key: "all", tier: "sponsored-dispatch", points: globalLimit });
  return admit(buckets);
}

/** Minting identity keys has its own limits and never grants research quota or debits it. */
export async function checkApiKeyMintAdmission(wallet: string, ip: string): Promise<Response | null> {
  const limited = await admit([
    { key: wallet.toLowerCase(), tier: "api-key-mint-wallet", points: IDENTIFIED_LIMIT },
    { key: ipKey(ip), tier: "api-key-mint-ip", points: IDENTIFIED_LIMIT },
    { key: "all", tier: "api-key-mint-global", points: DEFAULT_GLOBAL_LIMIT },
  ]);
  if (!limited) return null;
  const retryAfter = Number(limited.headers.get("Retry-After"));
  return Response.json({
    error: limited.status === 429 ? "api_key_mint_rate_limit" : "api_key_mint_unavailable",
    message: "API key creation is temporarily limited. Existing keys share the same wallet allowance; try again shortly.",
    retryAfter,
  }, { status: limited.status, headers: limited.headers });
}

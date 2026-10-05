/** Shared admission for hosted research that uses Keryx's treasury and model/search capacity.
 * Keys identify wallets; minting another key never creates another sponsored allowance. */
import { createHash } from "node:crypto";
import { consumeDurablePoint } from "./rate-limit-store";

const WINDOW_MS = 60_000;
// Preserve the existing treasuryAsk (5), ask (10), and public (60) per-minute tiers.
const ANONYMOUS_LIMIT = 5;
const IDENTIFIED_LIMIT = 10;
const DEFAULT_GLOBAL_LIMIT = 60;
// Per-minute tiers bound bursts, not totals: at the anonymous budget ceiling 60 dispatches a minute
// is an open-ended daily treasury liability. These daily counts make sponsored research a fixed,
// knowable cost (dispatches x KERYX_ANON_MAX_BUDGET) per caller and for the whole service.
const DAY_MS = 86_400_000;
const DEFAULT_CALLER_DAILY_LIMIT = 50;
const DEFAULT_GLOBAL_DAILY_LIMIT = 2_000;

export type SponsoredCaller =
  | { kind: "anonymous"; ip: string; wallet?: string }
  | { kind: "key"; ip: string; wallet: string }
  | { kind: "bot"; platform: "discord" | "slack" | "telegram"; userId: string };

type Bucket = { key: string; tier: string; points: number; windowMs?: number };

function ipKey(ip: string): string {
  return createHash("sha256").update(ip.trim() || "unknown").digest("hex");
}

function positiveLimit(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new Error("Invalid sponsored dispatch admission configuration");
  }
  return Number(value);
}

function dispatchLimits(): { perMinute: number; perDay: number; callerPerDay: number } {
  return {
    perMinute: positiveLimit(process.env.KERYX_SPONSORED_DISPATCHES_PER_MINUTE, DEFAULT_GLOBAL_LIMIT),
    perDay: positiveLimit(process.env.KERYX_SPONSORED_DISPATCHES_PER_DAY, DEFAULT_GLOBAL_DAILY_LIMIT),
    callerPerDay: positiveLimit(process.env.KERYX_SPONSORED_DISPATCHES_PER_CALLER_PER_DAY, DEFAULT_CALLER_DAILY_LIMIT),
  };
}

async function admit(buckets: Bucket[]): Promise<Response | null> {
  try {
    // Every counter is atomic in the durable store. A later refusal retains earlier points:
    // conservative under concurrency, and no compensation race can manufacture capacity.
    for (const bucket of buckets) {
      const decision = await consumeDurablePoint(bucket.key, bucket.tier, bucket.points, bucket.windowMs ?? WINDOW_MS);
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
  let limits: ReturnType<typeof dispatchLimits>;
  try { limits = dispatchLimits(); } catch { return unavailable(); }
  const buckets: Bucket[] = [];
  if (caller.kind === "bot") {
    // Signed provider requests carry the user's platform id; provider IPs identify no end user.
    const key = `${caller.platform}:${caller.userId}`;
    buckets.push({ key, tier: "sponsored-user", points: ANONYMOUS_LIMIT });
    buckets.push({ key, tier: "sponsored-user-day", points: limits.callerPerDay, windowMs: DAY_MS });
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
    if (caller.wallet) {
      buckets.push({ key: caller.wallet.toLowerCase(), tier: "sponsored-wallet-day", points: limits.callerPerDay, windowMs: DAY_MS });
    }
    buckets.push({ key, tier: "sponsored-ip-day", points: limits.callerPerDay, windowMs: DAY_MS });
  }
  // Locally throttled callers never burn the shared dispatch allowance.
  buckets.push({ key: "all", tier: "sponsored-dispatch", points: limits.perMinute });
  buckets.push({ key: "all", tier: "sponsored-dispatch-day", points: limits.perDay, windowMs: DAY_MS });
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

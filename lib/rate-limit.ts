/**
 * In-memory rate limiting via rate-limiter-flexible RateLimiterMemory.
 *
 * Single-process VPS (keryx.cc runs one Node process) so in-memory is sufficient.
 * Upgrade path: swap RateLimiterMemory → RateLimiterRedis in the constructors below;
 * the checkRateLimit() interface is unchanged.
 *
 * Rate limit resets on process restart — documented limitation, acceptable for testnet.
 */

import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { NextResponse } from "next/server";

/** Per-tier singleton limiters. Keyed by API key id (not the raw key string). */
const limiters: Record<string, RateLimiterMemory> = {
  // Authenticated key callers: 10 calls per 60s window.
  ask: new RateLimiterMemory({ points: 10, duration: 60, keyPrefix: "ask" }),
  // Unauthenticated (IP-based) callers hitting public read endpoints.
  public: new RateLimiterMemory({ points: 60, duration: 60, keyPrefix: "pub" }),
  // Anonymous (no-session) /api/ask calls drive a real treasury-funded agent run — expensive in
  // LLM tokens and real USDC. Keyed by client IP. 5/60s is generous for a human demoing the site
  // but blocks scripted treasury-drain / fake-volume loops. Session co-sign calls bypass this tier.
  treasuryAsk: new RateLimiterMemory({ points: 5, duration: 60, keyPrefix: "tre" }),
  // Unkeyed A2A callers (/api/agent/ask without a Bearer key). The x402 fee gates the run, but an
  // unauthenticated caller could still loop large-budget treasury payouts — IP-key it. More
  // generous than treasuryAsk because A2A is a paid path; keyed callers use the `ask` tier instead.
  a2aPublic: new RateLimiterMemory({ points: 10, duration: 60, keyPrefix: "a2a" }),
};

export type RateLimitTier = keyof typeof limiters;

/**
 * Consume one point for the given key on the given tier.
 *
 * Returns null when the request is allowed.
 * Returns a 429 Response with Retry-After header when the limit is exceeded.
 * The caller should `return checkRateLimit(...)` — truthy means blocked.
 */
export async function checkRateLimit(
  key: string,
  tier: RateLimitTier,
  opts?: { code?: string; message?: string },
): Promise<NextResponse | null> {
  const limiter = limiters[tier];
  try {
    await limiter.consume(key);
    return null;
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      const retryAfter = Math.ceil(err.msBeforeNext / 1000);
      // The caller can supply a friendlier error `code` + `message` so the client can
      // tell an expected throttle (e.g. free-trial limit hit → invite to connect a wallet)
      // apart from a generic abuse block. Defaults preserve the original contract.
      return NextResponse.json(
        {
          error: opts?.code ?? "rate limit exceeded",
          ...(opts?.message ? { message: opts.message } : {}),
          retryAfter,
        },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        },
      );
    }
    // Unexpected error — fail open (don't block traffic on limiter internals).
    console.error("[rate-limit] unexpected error:", err);
    return null;
  }
}

/**
 * Best-effort client IP for IP-keyed rate limiting. keryx.cc sits behind a Cloudflare Tunnel, so
 * the real client IP arrives in `cf-connecting-ip`; fall back to the first `x-forwarded-for` hop,
 * then `x-real-ip`. Unknowns share one bucket (conservative — they rate-limit together).
 */
export function clientIp(req: { headers: Headers }): string {
  const h = req.headers;
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return h.get("x-real-ip")?.trim() ?? "unknown";
}

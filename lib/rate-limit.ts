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
): Promise<NextResponse | null> {
  const limiter = limiters[tier];
  try {
    await limiter.consume(key);
    return null;
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      const retryAfter = Math.ceil(err.msBeforeNext / 1000);
      return NextResponse.json(
        { error: "rate limit exceeded", retryAfter },
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

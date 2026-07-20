/**
 * Rate limiting, keyed by API key id (not the raw key string) or by client IP.
 *
 * Counters are persisted (see lib/rate-limit-store.ts) so they survive a deploy and are shared by
 * every process on the box. The in-process limiter remains only as the fallback path.
 */

import { NextResponse } from "next/server";
import { consumePoint } from "./rate-limit-store";

const WINDOW_MS = 60_000;

/** Per-tier budgets, all over a 60s window. */
const tiers = {
  // Authenticated key callers: 10 calls per window.
  ask: 10,
  // Unauthenticated (IP-based) callers hitting public read endpoints.
  public: 60,
  // Anonymous (no-session) /api/ask calls drive a real treasury-funded agent run — expensive in
  // LLM tokens and real USDC. Keyed by client IP. 5/60s is generous for a human demoing the site
  // but blocks scripted treasury-drain / fake-volume loops. Session co-sign calls bypass this tier.
  treasuryAsk: 5,
  // Unkeyed A2A callers (/api/agent/ask without a Bearer key). The x402 fee gates the run, but an
  // unauthenticated caller could still loop large-budget treasury payouts — IP-key it. More
  // generous than treasuryAsk because A2A is a paid path; keyed callers use the `ask` tier instead.
  a2aPublic: 10,
} as const;

export type RateLimitTier = keyof typeof tiers;

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
  const { allowed, msBeforeNext } = await consumePoint(key, tier, tiers[tier], WINDOW_MS);
  if (allowed) return null;

  const retryAfter = Math.max(1, Math.ceil(msBeforeNext / 1000));
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

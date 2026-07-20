/**
 * Durable fixed-window counters behind checkRateLimit().
 *
 * The limiters used to live only in process memory. Keryx deploys on every change, so each deploy
 * handed every caller a fresh allowance — and the throttled tiers are the treasury-funded ones
 * (anonymous /api/ask, the Discord/Slack/Telegram front doors, the unkeyed A2A endpoint), where a
 * reset window is real USDC. The web process and the traction daemon also kept separate counts.
 *
 * The DB row is authoritative. The in-process limiter stays as the fallback for when the DB is
 * unreachable: degraded (per-process, reset on restart) but never open.
 */

import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { getDb } from "./db";
import type { RateLimitDecision } from "./db/keryx-db";

/** Fallback limiters, created per tier on first use so their shape follows the tier config. */
const fallback = new Map<string, RateLimiterMemory>();

function fallbackLimiter(tier: string, points: number, windowMs: number): RateLimiterMemory {
  let limiter = fallback.get(tier);
  if (!limiter) {
    limiter = new RateLimiterMemory({ points, duration: windowMs / 1000, keyPrefix: tier });
    fallback.set(tier, limiter);
  }
  return limiter;
}

/** Expired rows are dead weight, not a correctness problem — sweeping them hourly is enough. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
let lastSweep = 0;

async function sweepExpired(now: number): Promise<void> {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  try {
    const db = await getDb();
    await db.deleteExpiredRateLimits(now);
  } catch (err) {
    console.error("[rate-limit] sweep failed:", err);
  }
}

/**
 * Consume one point from `<tier>:<key>`. Never throws — a DB failure degrades to the in-process
 * limiter rather than admitting the request.
 */
export async function consumePoint(
  key: string,
  tier: string,
  points: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  const now = Date.now();
  try {
    const db = await getDb();
    const decision = await db.consumeRateLimit(`${tier}:${key}`, points, windowMs, now);
    void sweepExpired(now);
    return decision;
  } catch (err) {
    console.error("[rate-limit] durable store unavailable, using in-process limiter:", err);
    return consumeInProcess(key, tier, points, windowMs);
  }
}

async function consumeInProcess(
  key: string,
  tier: string,
  points: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  try {
    await fallbackLimiter(tier, points, windowMs).consume(key);
    return { allowed: true, msBeforeNext: windowMs };
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      return { allowed: false, msBeforeNext: err.msBeforeNext };
    }
    // Limiter internals broke too — fail open rather than blocking all traffic on a bug here.
    console.error("[rate-limit] in-process limiter error:", err);
    return { allowed: true, msBeforeNext: windowMs };
  }
}

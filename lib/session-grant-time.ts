import { z } from "zod";
import { canonicalTime } from "./auth-time-policy";

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(value => value.toLowerCase());
const schema = z.object({ sessionId: address, ownerAddr: address, sessAddr: address,
  grantEpoch: z.string().min(1).max(128), expiresAt: z.string(), serverNow: z.string(),
  remainingMs: z.number().int().nonnegative(), ttlMs: z.number().int().positive() });
type Identity = { sessionId: string; sessAddr: string };

/** Advisory UI deadline only. Never enrolls, renews or authorizes a grant. */
export function createSessionGrantClock(value: unknown, expected: Identity, requestStarted: number, now: number, maximumTtlMs: number) {
  function checked(input: unknown, start: number, current: number) {
    const body = schema.parse(input), elapsed = current - start;
    if (!Number.isSafeInteger(maximumTtlMs) || maximumTtlMs <= 0 || body.ttlMs > maximumTtlMs ||
      body.remainingMs > body.ttlMs || canonicalTime(body.expiresAt) - canonicalTime(body.serverNow) !== body.remainingMs ||
      body.sessionId !== expected.sessionId.toLowerCase() || body.ownerAddr !== body.sessionId || body.sessAddr !== expected.sessAddr.toLowerCase() ||
      !Number.isFinite(start) || !Number.isFinite(current) || start < 0 || elapsed < 0) throw new Error("Session timing unavailable");
    return { body, deadline: current + Math.max(0, body.remainingMs - elapsed) };
  }
  const initial = checked(value, requestStarted, now);
  let deadline = initial.deadline;
  return {
    ...initial.body,
    remaining(current: number) {
      if (!Number.isFinite(current) || current < now) return 0;
      return Math.max(0, deadline - current);
    },
    clamp(input: unknown, start: number, current: number) {
      const next = checked(input, start, current);
      if (next.body.grantEpoch !== initial.body.grantEpoch || next.body.expiresAt !== initial.body.expiresAt) throw new Error("Session generation changed");
      deadline = Math.min(deadline, next.deadline);
    },
  };
}

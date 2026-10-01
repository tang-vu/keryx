import { z } from "zod";

// Shared time policy only: this module is safe in the browser and contains no secrets.
export const AUTH_CHALLENGE_TTL_MS = 300_000;
export const WEB_SESSION_TTL_MS = 7 * 86400_000;
export const PRIVATE_LOGIN_TTL_MS = 900_000;
export function canonicalTime(value: string): number {
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || time < 0 || new Date(time).toISOString() !== value) throw new Error("Server time unavailable");
  return time;
}
const challengeSchema = z.object({ nonce: z.string().regex(/^[a-zA-Z0-9]{8,64}$/),
  issuedAt: z.string(), challengeExpiresAt: z.string(), sessionExpiresAt: z.string() });
/** Server-issued dates select login duration, never the client's UTC clock. */
export function parseDatedAuthChallenge(value: unknown) {
  const body = challengeSchema.parse(value), issued = canonicalTime(body.issuedAt);
  if (canonicalTime(body.challengeExpiresAt) - issued !== AUTH_CHALLENGE_TTL_MS ||
    canonicalTime(body.sessionExpiresAt) - issued !== WEB_SESSION_TTL_MS) throw new Error("Server challenge time unavailable");
  return body;
}

/**
 * Server-side session grant registry, persisted in the database.
 *
 * A "grant" records that a user funded a browser-held session EOA and gave Keryx permission to
 * request EIP-712 signatures from it up to a total USDC cap. The PRIVATE KEY lives only in the
 * browser tab — this module never sees or stores it. Only the public address, the cap, and the
 * running spend total.
 *
 * These used to live in a process-local Map, which had two costs. A deploy or crash stranded every
 * funded session (tabs showed "expired" until the user re-registered), and `spent` reset to zero
 * with the process — so the server's own cap accounting restarted on every bounce. The Gateway
 * balance remained the true ceiling, but the cap, which is what the non-custodial story rests on,
 * did not survive. Both are fixed by persisting the row.
 *
 * Pending sign-requests are a different lifetime and live in ./pending-signatures.
 */

import { getDb } from "../db";
import type { SessionGrantRecord } from "../db/keryx-db";
import { config } from "../config";

export type SessionGrant = SessionGrantRecord;

/** Default grant TTL from config. */
export function grantExpiry(): number {
  return Date.now() + config.sessionGrantTtlSeconds * 1000;
}

export async function storeGrant(
  sessionId: string,
  grant: Omit<SessionGrant, "sessionId" | "spent">,
): Promise<void> {
  const db = await getDb();
  await db.upsertSessionGrant({ ...grant, sessionId });
}

/**
 * Fetch a live grant. Expired rows are deleted and reported as absent, so a lapsed grant can
 * never authorise a spend, and the table doesn't accumulate dead sessions.
 */
export async function getGrant(sessionId: string): Promise<SessionGrant | undefined> {
  const db = await getDb();
  const grant = await db.getSessionGrant(sessionId);
  if (!grant) return undefined;
  if (Date.now() > grant.expiry) {
    await db.deleteSessionGrant(sessionId);
    return undefined;
  }
  return grant;
}

export async function isGrantValid(sessionId: string): Promise<boolean> {
  return (await getGrant(sessionId)) !== undefined;
}

/** Record a confirmed spend. False when the grant no longer exists to charge. */
export async function recordSpend(sessionId: string, amount: number): Promise<boolean> {
  const db = await getDb();
  return db.addSessionGrantSpend(sessionId, amount);
}

/** Reserve cap before asking the browser to create a bearer payment authorization. */
export const reserveSpend = recordSpend;

/** Release a reservation only while no payment authorization has been submitted. */
export async function releaseSpend(sessionId: string, amount: number): Promise<void> {
  const db = await getDb();
  await db.releaseSessionGrantSpend(sessionId, amount);
}

export async function dropGrant(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.deleteSessionGrant(sessionId);
}

/** True when adding `amount` would stay within the cap. */
export async function canSpend(sessionId: string, amount: number): Promise<boolean> {
  const grant = await getGrant(sessionId);
  if (!grant) return false;
  return grant.spent + amount <= grant.cap + 1e-9; // +epsilon for float rounding
}

/** Housekeeping: drop grants whose TTL lapsed. Safe to call at any time. */
export async function pruneExpiredGrants(): Promise<void> {
  const db = await getDb();
  await db.deleteExpiredSessionGrants(Date.now());
}

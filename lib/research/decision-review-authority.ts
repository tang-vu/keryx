import type { SessionGrantRecord, WebSessionRecord } from "../db/keryx-db";
import { DecisionReviewError, reviewMicros } from "./decision-review-types";

/** Fresh readback only. The ordinary gateway still reserves and checks each payment. */
export function assertDecisionReviewAuthority(owner: string, sessionHash: string, session: WebSessionRecord | null,
  original: SessionGrantRecord | undefined, current: SessionGrantRecord | undefined, now = Date.now()): void {
  const refuse = () => { throw new DecisionReviewError("review_conflict"); };
  if (!Number.isSafeInteger(now) || now < 0 || !session || session.hash !== sessionHash || session.wallet.toLowerCase() !== owner ||
    !Number.isSafeInteger(session.issuedAt) || session.issuedAt < 0 || session.issuedAt > now ||
    !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= now) refuse();
  if (!current || !original) return refuse();
  if (current.ownerAddr.toLowerCase() !== owner || original.ownerAddr.toLowerCase() !== owner || current.sessionId !== original.sessionId ||
    current.grantEpoch !== original.grantEpoch || current.sessAddr !== original.sessAddr || current.cap !== original.cap ||
    current.expiry !== original.expiry || !Number.isSafeInteger(current.expiry) || current.expiry <= now) refuse();
  try { if (BigInt(reviewMicros(current.spent)) > BigInt(reviewMicros(current.cap))) refuse(); }
  catch { refuse(); }
}

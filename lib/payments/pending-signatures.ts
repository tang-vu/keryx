/**
 * In-process map of sign-requests awaiting a browser response.
 *
 * BrowserCoSignGateway suspends on a per-reqId promise; POST /api/ask/sign resolves it once the
 * browser posts back its signed header. Unresolved promises reject on a timeout so a closed tab
 * doesn't hang the agent forever.
 *
 * Deliberately NOT persisted, unlike the grants themselves: a pending signature is bound to a live
 * SSE connection in this process. If the process dies the connection dies with it, so there is
 * nothing to resume. The flip side is that co-sign cannot span instances — a sign POST landing on
 * a different node than its SSE stream will not find the promise. Single-instance today; a
 * multi-instance deploy needs sticky sessions or a shared broker.
 */

import type { PaymentRequirements } from "./x402-payment-evidence";

// Keyed by `sessionId:reqId` so a caller cannot resolve another session's pending promise
// even if they guess the UUID reqId.
const pending = new Map<string, PendingSignature>();

interface PendingSignature {
  challenge: PendingSignatureChallenge;
  resolve: (header: string) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanupAbort: () => void;
}

export interface PendingSignatureChallenge {
  requirements: PaymentRequirements;
  expectedSigner: string;
}

/** How long the browser has to respond to a sign-request before we give up. */
const SIGN_TIMEOUT_MS = 30_000;

function pendingKey(sessionId: string, reqId: string): string {
  return `${sessionId}:${reqId}`;
}

/**
 * Create a pending-signature slot and return a promise that resolves with the signed payment
 * header when the browser calls back, or rejects after SIGN_TIMEOUT_MS. The resolved header is
 * the raw base64 `{signature, authorization}` string.
 */
export function awaitSignature(
  sessionId: string,
  reqId: string,
  challenge: PendingSignatureChallenge,
  abortSignal?: AbortSignal,
): Promise<string> {
  cancelPending(sessionId, reqId); // clean up any stale entry (shouldn't happen, but be safe)
  const key = pendingKey(sessionId, reqId);

  return new Promise<string>((resolve, reject) => {
    const onAbort = () => {
      const slot = pending.get(key);
      if (!slot) return;
      clearTimeout(slot.timer);
      pending.delete(key);
      slot.cleanupAbort();
      reject(new Error("client disconnected"));
    };
    const cleanupAbort = () => abortSignal?.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      pending.delete(key);
      cleanupAbort();
      reject(new Error(`sign-request timed out after ${SIGN_TIMEOUT_MS / 1000}s`));
    }, SIGN_TIMEOUT_MS);

    // Keep the original server-validated challenge, independent of callback input.
    pending.set(key, {
      challenge: {
        expectedSigner: challenge.expectedSigner,
        requirements: { ...challenge.requirements, extra: { ...challenge.requirements.extra } },
      },
      resolve, reject, timer, cleanupAbort,
    });
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    // Abort may have happened just before the listener was attached.
    if (abortSignal?.aborted) onAbort();
  });
}

export function getPendingChallenge(sessionId: string, reqId: string): PendingSignatureChallenge | undefined {
  return pending.get(pendingKey(sessionId, reqId))?.challenge;
}

/**
 * Called by POST /api/ask/sign when the browser sends its signed header. The sessionId is part of
 * the key, so a caller cannot resolve another session's promise.
 * Returns false when the reqId is not pending for this session.
 */
export function resolveSignature(sessionId: string, reqId: string, header: string): boolean {
  const key = pendingKey(sessionId, reqId);
  const slot = pending.get(key);
  if (!slot) return false;
  clearTimeout(slot.timer);
  pending.delete(key);
  slot.cleanupAbort();
  slot.resolve(header);
  return true;
}

export function cancelPending(sessionId: string, reqId: string): void {
  const key = pendingKey(sessionId, reqId);
  const slot = pending.get(key);
  if (!slot) return;
  clearTimeout(slot.timer);
  pending.delete(key);
  slot.cleanupAbort();
  slot.reject(new Error("cancelled"));
}

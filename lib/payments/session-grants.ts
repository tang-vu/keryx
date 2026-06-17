/**
 * Server-side session grant registry.
 *
 * A "grant" records that a user has funded a browser-held session EOA and
 * given Keryx permission to request EIP-712 signatures from the browser up to
 * a total USDC cap. The PRIVATE KEY lives only in the browser tab — this module
 * never sees or stores it.
 *
 * The pending-signature map lets the BrowserCoSignGateway suspend on a
 * per-reqId promise that is resolved by POST /api/ask/sign once the browser
 * sends its signed header. Unresolved promises time out and reject so a stalled
 * browser doesn't hang the agent forever.
 */

import { config } from "../config";

export interface SessionGrant {
  /** The session EOA whose Gateway balance backs these payments (no key server-side). */
  sessAddr: string;
  /** Wallet address that owns this session (SIWE-authed asker). */
  ownerAddr: string;
  /** Total USDC the user funded — the hard spending ceiling. */
  cap: number;
  /** USDC spent so far this grant (monotonically increasing). */
  spent: number;
  /** Unix ms when this grant expires (server-enforced, defence against stale tabs). */
  expiry: number;
  /** On-chain tx that funded the session EOA (for record-keeping only). */
  txHash: string;
}

interface PendingSignature {
  resolve: (header: string) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Process-scoped grant store. Survives across requests in the same Node process;
// lost on server restart (user must re-grant — acceptable for testnet demo).
const grants = new Map<string, SessionGrant>();

// Pending map keyed by `sessionId:reqId` so a caller cannot resolve another
// session's pending promise even if they guess the UUID reqId.
const pending = new Map<string, PendingSignature>();

/** Composite key for the pending map — scopes each reqId to its session. */
function pendingKey(sessionId: string, reqId: string): string {
  return `${sessionId}:${reqId}`;
}

// How long the browser has to respond to a sign-request before we give up.
const SIGN_TIMEOUT_MS = 30_000;

// ── Grant lifecycle ────────────────────────────────────────────────────────────

export function storeGrant(sessionId: string, grant: Omit<SessionGrant, "spent">): void {
  grants.set(sessionId, { ...grant, spent: 0 });
}

export function getGrant(sessionId: string): SessionGrant | undefined {
  const g = grants.get(sessionId);
  if (!g) return undefined;
  // Expire lazily — callers must check this themselves via isGrantValid().
  if (Date.now() > g.expiry) {
    grants.delete(sessionId);
    return undefined;
  }
  return g;
}

export function isGrantValid(sessionId: string): boolean {
  return getGrant(sessionId) !== undefined;
}

/** Record a confirmed spend. Returns false if the grant no longer exists. */
export function recordSpend(sessionId: string, amount: number): boolean {
  const g = grants.get(sessionId);
  if (!g) return false;
  g.spent = Math.round((g.spent + amount) * 1e6) / 1e6;
  return true;
}

export function dropGrant(sessionId: string): void {
  grants.delete(sessionId);
}

/** Check cap: returns true when adding `amount` would stay within cap. */
export function canSpend(sessionId: string, amount: number): boolean {
  const g = getGrant(sessionId);
  if (!g) return false;
  return g.spent + amount <= g.cap + 1e-9; // +epsilon for float rounding
}

// ── Pending signature lifecycle ────────────────────────────────────────────────

/**
 * Create a pending-signature slot and return a promise that resolves with the
 * signed payment header when the browser calls back, or rejects after SIGN_TIMEOUT_MS.
 * The resolved header is the raw base64 `{signature, authorization}` string.
 *
 * The slot is keyed by `sessionId:reqId` so a caller from a different session
 * cannot resolve this promise even if they guess the reqId UUID.
 */
export function awaitSignature(sessionId: string, reqId: string): Promise<string> {
  // Clean up any stale entry (shouldn't happen, but be safe).
  cancelPending(sessionId, reqId);
  const key = pendingKey(sessionId, reqId);

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(key);
      reject(new Error(`sign-request timed out after ${SIGN_TIMEOUT_MS / 1000}s`));
    }, SIGN_TIMEOUT_MS);

    pending.set(key, { resolve, reject, timer });
  });
}

/**
 * Called by POST /api/ask/sign when the browser sends its signed header.
 * The sessionId is verified before resolution so a caller cannot resolve
 * another session's pending promise.
 * Returns true on success, false when the reqId is not pending for this session.
 */
export function resolveSignature(sessionId: string, reqId: string, header: string): boolean {
  const key = pendingKey(sessionId, reqId);
  const slot = pending.get(key);
  if (!slot) return false;
  clearTimeout(slot.timer);
  pending.delete(key);
  slot.resolve(header);
  return true;
}

export function cancelPending(sessionId: string, reqId: string): void {
  const key = pendingKey(sessionId, reqId);
  const slot = pending.get(key);
  if (!slot) return;
  clearTimeout(slot.timer);
  pending.delete(key);
  slot.reject(new Error("cancelled"));
}

/** Default grant TTL from config. */
export function grantExpiry(): number {
  return Date.now() + config.sessionGrantTtlSeconds * 1000;
}

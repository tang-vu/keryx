import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import type { LocalSessionAuthorization } from "./browser-session-withdrawal-storage";
import { parseBrowserSessionPaymentRequirements } from "./browser-session-runtime";

const hash = z.string().regex(/^0x[0-9a-f]{64}$/), address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(v=>v.toLowerCase());
const journal = z.object({ nonce: hash, sessionId: address, requestId: z.string().uuid(), grantEpoch: z.string().uuid(), signer: address,
  phase: z.string(), requirements: z.unknown(), paymentContext: z.unknown().optional(), signedHeaderHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  payment: z.object({ authorizationId: hash, payer: address, payee: address, network: z.string(),
    sourceId: z.string(), kind: z.string(), amountUsdc: z.number().finite().nonnegative(), settled: z.boolean(),
    settlementStatus: z.string().optional(), txHash: z.string().nullable().optional() }).passthrough() }).passthrough();
const page = z.object({ network: z.literal(profile.networkId), sessAddr: address, retryAuthorized: z.literal(false),
  payments: z.array(z.unknown()).max(64), nextCursor: hash.nullable() }).strict();

/** A lifetime signed total is not a current liability. Only an original real settled
 * journal with the complete retained nonce/economic tuple can distinguish past debit.
 * Missing old metadata, failed/unknown states and unmatched evidence remain held. */
export async function readBrowserWithdrawalLiabilities(rows: readonly LocalSessionAuthorization[], owner: string, signer: string,
  epoch: string, json: (path: string) => Promise<unknown>) {
  const known = new Map<string, z.infer<typeof journal>>(); let cursor: string | null = null;
  for (;;) {
    const query = new URLSearchParams({ sessAddr: signer, grantEpoch: epoch, ...(cursor ? { afterNonce: cursor } : {}) });
    const result = page.parse(await json(`/api/session/withdraw/payments?${query}`));
    if (result.sessAddr !== signer || (cursor && result.nextCursor && result.nextCursor <= cursor)) throw new Error("Original liability page differs");
    for (const value of result.payments) {
      const p = journal.parse(value);
      if (p.sessionId !== owner || p.signer !== signer || known.has(p.nonce) || (cursor && p.nonce <= cursor)) throw new Error("Original liability selector differs");
      known.set(p.nonce, p);
    }
    if (!result.nextCursor) break;
    if (!result.payments.length || !known.has(result.nextCursor)) throw new Error("Original liability cursor differs");
    cursor = result.nextCursor;
  }
  let held = BigInt(0);
  for (const row of rows) {
    if (!/^[1-9]\d{0,15}$/.test(row.amount) || BigInt(row.amount) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Retained exposure differs");
    const p = known.get(row.nonce), original = row.original;
    let settled = false;
    if (p && original && row.requirementsDigest) {
      let requirements: ReturnType<typeof parseBrowserSessionPaymentRequirements> | null = null;
      try { requirements = parseBrowserSessionPaymentRequirements(p.requirements); } catch { /* Wrong rail/domain remains held. */ }
      const digest = requirements ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(requirements)))),
        byte => byte.toString(16).padStart(2,"0")).join("") : null;
      settled = p.phase === "settled" && p.payment.settled && p.payment.settlementStatus === "settled" &&
        !!p.payment.txHash && !!p.signedHeaderHash && p.payment.network === profile.networkId &&
        p.payment.payer === signer && p.payment.payee === original.requirements.payTo &&
        p.payment.authorizationId === row.nonce && p.nonce === original.expectedNonce && p.grantEpoch === row.epoch &&
        p.grantEpoch === original.grantEpoch && p.requestId === original.reqId && p.sessionId === original.sessionId &&
        p.signer === original.sessAddr && p.payment.sourceId === original.sourceId && p.payment.kind === original.kind &&
        Math.abs(p.payment.amountUsdc*1e6-Number(row.amount)) <= 0.000001 &&
        original.requirements.amount === row.amount && digest === row.requirementsDigest &&
        canonicalJson(requirements) === canonicalJson(original.requirements) &&
        canonicalJson(p.paymentContext ?? null) === canonicalJson(original.paymentContext ?? null);
    }
    if (!settled) held += BigInt(row.amount);
  }
  return held;
}

import { createHash, randomBytes } from "node:crypto";
import type { QueryRun } from "../types";
import { requireRunClaims, RunClaimError, runClaimAttemptSchema, runClaimBindingSchema, runClaimDeliverySchema, runClaimIdSchema,
  runClaimIssuanceSchema, runClaimReceiptSchema, runClaimTokenSchema, type RunClaimBinding, type RunClaimsStore } from "./contracts";

export function runClaimTokenHash(token: string, rawBinding: RunClaimBinding): string {
  try {
    const binding = runClaimBindingSchema.parse(rawBinding);
    return createHash("sha256").update(`keryx-anonymous-run-claim-v1|${binding.network}|${binding.origin}|${runClaimTokenSchema.parse(token)}`).digest("hex");
  } catch { throw new RunClaimError("claim_unavailable"); }
}
const sameBinding = (a: RunClaimBinding, b: RunClaimBinding) => a.network === b.network && a.origin === b.origin;

/** Prepare at a trusted new-request boundary before research. Completion is single-shot and
 * caller-local: a reader/history/recovery cannot mint a token for an older saved run.
 * The raw secret exists only after persistence and never becomes part of QueryRun. */
export async function prepareRunClaimDelivery(db: { readonly runClaims?: RunClaimsStore }, rawBinding: RunClaimBinding, id: string) {
  const store = requireRunClaims(db);
  let binding: RunClaimBinding, runId: string;
  try { binding = runClaimBindingSchema.parse(rawBinding); runId = runClaimIdSchema.parse(id); }
  catch { throw new RunClaimError("claims_unavailable"); }
  try { await store.assertAvailable(); }
  catch { throw new RunClaimError("claims_unavailable"); }
  const preparedAt = Date.now();
  let completed = false;
  return Object.freeze({ async complete(run: QueryRun) {
    if (completed) throw new RunClaimError("claim_unavailable");
    completed = true;
    if (run.id !== runId || Date.parse(run.createdAt) < preparedAt || !Number.isFinite(Date.parse(run.createdAt))
      || Date.parse(run.createdAt) > Date.now()) throw new RunClaimError("claim_unavailable");
    if (Object.hasOwn(run, "asker") || Object.hasOwn(run, "originalFulfillment") || run.askerFunded === true || run.fundingOwner === "browser")
      return null;
    const token = randomBytes(32).toString("hex");
    try {
      const issued = runClaimIssuanceSchema.parse(await store.issue({ runId, completedAt: run.createdAt,
        tokenHash: runClaimTokenHash(token, binding), binding }));
      if (issued.runId !== runId || !sameBinding(issued.binding, binding)) throw new Error("Unbound claim issuance");
      return runClaimDeliverySchema.parse({ version: 1, claimUrl: `${binding.origin}/claim-run#${token}`, expiresAt: issued.expiresAt });
    } catch (error) { if (error instanceof RunClaimError) throw error; throw new RunClaimError("claims_unavailable"); }
  } });
}

/** Caller obtains wallet/session from durable SIWE authentication, never the claim body.
 * Hash before crossing the storage boundary; errors never include submitted credentials. */
export async function claimRun(db: { readonly runClaims?: RunClaimsStore }, token: string,
  authority: { wallet: string; sessionHash: string }, binding: RunClaimBinding) {
  const store = requireRunClaims(db);
  const tokenHash = runClaimTokenHash(token, binding);
  let input;
  try { input = runClaimAttemptSchema.parse({ wallet: authority.wallet, sessionHash: authority.sessionHash, tokenHash, binding }); }
  catch { throw new RunClaimError("claim_unavailable"); }
  try {
    const receipt = runClaimReceiptSchema.parse(await store.claim(input));
    if (receipt.wallet !== input.wallet || !sameBinding(receipt.binding, input.binding)) throw new Error("Unbound claim receipt");
    return receipt;
  } catch (error) { if (error instanceof RunClaimError) throw error; throw new RunClaimError("claims_unavailable"); }
}

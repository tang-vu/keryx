import type { KeryxDB } from "../db/keryx-db";
import { readBoundedJson } from "../read-bounded-json";
import { validateWithdrawalRequest, type WithdrawalRequestRecord } from "./withdrawal-request";

type Store = Pick<KeryxDB, "reserveCreatorWithdrawal" | "getCreatorWithdrawal" | "claimCreatorWithdrawalTransfer"
  | "getCreatorWithdrawalTransferClaim" | "getCreatorWithdrawalAttestation" | "saveCreatorWithdrawalAttestation">;
type RequestTransfer = (record: WithdrawalRequestRecord, signal: AbortSignal) => Promise<unknown>;

/** Authenticated owner projection only. Stored attestations are not completed mints. */
export async function withdrawalTransferProgress(store: Store, id: string, owner: string) {
  const record = await store.getCreatorWithdrawal(id, owner);
  if (!record) return null;
  const attestation = await store.getCreatorWithdrawalAttestation(id, owner);
  const claim = await store.getCreatorWithdrawalTransferClaim(id, owner);
  return { requestId: record.id, recipient: record.policy.recipient, amountMicros: record.request.burnIntent.spec.value,
    status: attestation ? "attestation-stored" as const : claim ? "awaiting-transfer-evidence" as const : "request-stored" as const,
    chainFinalityVerified: false as const };
}

/** Server coordinator. beforeClaim MUST establish durable, request-idempotent relay
 * gas admission; it is not a boolean liquidity check. No production caller is wired
 * until that admission implementation is available. The callback and transfer
 * transport are server-owned dependencies, never client-provided authority. */
export async function submitWithdrawalTransfer(store: Store, value: WithdrawalRequestRecord, authenticatedOwner: string,
  beforeClaim: (record: WithdrawalRequestRecord, signal: AbortSignal) => Promise<void>,
  requestTransfer: RequestTransfer, signal: AbortSignal) {
  const record = await validateWithdrawalRequest(structuredClone(value));
  if (record.owner !== authenticatedOwner.toLowerCase()) throw new Error("Withdrawal owner unavailable");
  if (signal.aborted) return null;
  await store.reserveCreatorWithdrawal(record);
  if (await store.getCreatorWithdrawalTransferClaim(record.id, record.owner))
    return withdrawalTransferProgress(store, record.id, record.owner);
  await beforeClaim(structuredClone(record), signal);
  if (signal.aborted) return withdrawalTransferProgress(store, record.id, record.owner);
  // The store grants this only to the inserting caller, including after a lost
  // claim response. An existing token never grants another vendor POST.
  const claim = await store.claimCreatorWithdrawalTransfer(record.id, record.owner);
  if (!claim || signal.aborted) return withdrawalTransferProgress(store, record.id, record.owner);
  try {
    const response = await requestTransfer(structuredClone(record), signal);
    // Even if the HTTP caller disconnects, retain an already-returned matched
    // response. This storage operation never authorizes another transfer or mint.
    await store.saveCreatorWithdrawalAttestation(record.id, record.owner, claim.claimId, response);
  } catch {
    // The original claim remains. Invalid/error/lost responses stay unresolved;
    // a successful database commit with lost readback can still be recovered below.
  }
  return withdrawalTransferProgress(store, record.id, record.owner);
}

/** One request only, no redirects/retries. Deadline covers headers and body. */
export const requestCircleWithdrawalTransfer: RequestTransfer = async (value, signal) => {
  const record = await validateWithdrawalRequest(structuredClone(value));
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 10000);
  const combined = AbortSignal.any([signal, stop.signal]);
  try {
    combined.throwIfAborted();
    const response = await fetch("https://gateway-api-testnet.circle.com/v1/transfer", {
      method: "POST", redirect: "error", headers: { "Content-Type": "application/json" },
      body: JSON.stringify([record.request]), signal: combined,
    });
    const body = await readBoundedJson(response, 16384); combined.throwIfAborted();
    if (!response.ok) throw new Error();
    return body;
  } catch { throw new Error("Withdrawal transfer response unavailable"); }
  finally { clearTimeout(timer); }
};

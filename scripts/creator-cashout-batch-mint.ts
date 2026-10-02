import assert from "node:assert/strict";
import { join } from "node:path";
import type { Hex } from "viem";
import type { createWithdrawalMintJournal } from "../lib/gateway/withdrawal-mint-journal";
import { queueWithdrawalRelayPage } from "../lib/gateway/withdrawal-relay-queue";
import type { WithdrawalMintTerms } from "../lib/gateway/withdrawal-mint-transaction";
import type { KeryxDB } from "../lib/db/keryx-db";
import type { CreatorBatchPlan } from "./creator-cashout-batch-plan";
import { retainedCreatorBatchOriginal } from "./creator-cashout-batch-signing";
import { saveWithdrawalDrillExclusive } from "./withdrawal-drill-files";

type Journal = ReturnType<typeof createWithdrawalMintJournal>;
/** Isolate failed fresh estimates. Only successfully bounded originals can acquire
 * a new nonce; previously queued/observed originals are never re-estimated. */
export async function queueCreatorBatchMints(directory: string, journal: Journal,
  store: Pick<KeryxDB, "getCreatorWithdrawalAttestation">, terms: Omit<WithdrawalMintTerms, "nonce">,
  estimate: (held: NonNullable<Awaited<ReturnType<Journal["getGasAdmission"]>>>,
    attestation: NonNullable<Awaited<ReturnType<KeryxDB["getCreatorWithdrawalAttestation"]>>>) => Promise<bigint>, signal: AbortSignal) {
  const approved = new Set<string>(), estimateUnavailableIds: string[] = [];
  for (const id of journal.listGasAdmissionIds(undefined, 64).ids) {
    try {
      const held = await journal.getGasAdmission(id); assert.ok(held);
      const response = await store.getCreatorWithdrawalAttestation(id, held.request.owner);
      if (!response) continue;
      signal.throwIfAborted(); assert.ok(await estimate(held, response) <= BigInt(terms.gas)); signal.throwIfAborted();
      approved.add(id);
    } catch { if (signal.aborted) throw new Error("Batch estimate cancelled"); estimateUnavailableIds.push(id); }
  }
  const queued = await queueWithdrawalRelayPage(directory, journal, {
    getCreatorWithdrawalAttestation: (id, owner) => approved.has(id) ? store.getCreatorWithdrawalAttestation(id, owner) : Promise.resolve(null),
  }, terms, signal, { limit: 64 });
  return { ...queued, estimateUnavailableIds };
}

/** Unknown broadcast is recovery-only even across later explicit worker passes.
 * The shared engine still retains the original signed bytes and nonce. */
export function creatorBatchBroadcastOnce(directory: string, journal: Pick<Journal, "listRequestIds" | "getPrepared">,
  plan: CreatorBatchPlan, send: (request: { serializedTransaction: Hex }) => Promise<Hex>, signal: AbortSignal) {
  return async (request: { serializedTransaction: Hex }) => {
    const matches: string[] = [];
    for (const id of journal.listRequestIds()) if ((await journal.getPrepared(id))?.serializedTransaction === request.serializedTransaction) matches.push(id);
    assert.equal(matches.length, 1);
    const id = matches[0], draft = plan.drafts.find(draft => draft.id === id); assert.ok(draft);
    const original = await retainedCreatorBatchOriginal(directory, draft); assert.equal(original.id, id);
    const saved = await journal.getPrepared(id); assert.ok(saved); signal.throwIfAborted();
    saveWithdrawalDrillExclusive(join(directory, `broadcast-attempt-${id}.json`), { requestId: id, transactionHash: saved.transactionHash });
    return send(request);
  };
}

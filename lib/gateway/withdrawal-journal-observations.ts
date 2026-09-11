import type { DatabaseSync } from "node:sqlite";
import type { WithdrawalRequestRecord } from "./withdrawal-request";
import type { WithdrawalAttestation } from "./withdrawal-attestation";
import type { matchWithdrawalMintTransaction, WithdrawalMintTerms } from "./withdrawal-mint-transaction";
import type { createWithdrawalReceiptObserver } from "./withdrawal-receipt-observation";
import { sameObservedMint, validateRecordedMintObservation } from "./withdrawal-recorded-observation";

type Core = {
  getSlot(id: string): Promise<{ request: WithdrawalRequestRecord; attestation: WithdrawalAttestation; terms: WithdrawalMintTerms } | null>;
  getPrepared(id: string): Promise<Awaited<ReturnType<typeof matchWithdrawalMintTransaction>> | null>;
};
/** Server-owned observer only. No endpoint should accept precomputed observations
 * from a client. These methods neither sign/broadcast nor free reserved capacity. */
export function attachWithdrawalObservations(db: DatabaseSync, core: Core, check: () => void,
  atomic: <T>(action: () => T) => T, nowMs = Date.now) {
  async function getObserved(id: string) {
    check();
    const slot = await core.getSlot(id), prepared = await core.getPrepared(id);
    if (!slot || !prepared) return null;
    const row = db.prepare("SELECT data FROM mint_journal_observations WHERE id=?").get(id);
    return row ? validateRecordedMintObservation(JSON.parse(String(row.data)), slot.request, prepared) : null;
  }
  async function reconcile(id: string, observe: ReturnType<typeof createWithdrawalReceiptObserver>, signal: AbortSignal) {
    const previous = await getObserved(id);
    const slot = await core.getSlot(id), prepared = await core.getPrepared(id);
    if (!slot || !prepared) return { latestCheck: "not-prepared" as const, observation: previous };
    if (signal.aborted) return { latestCheck: "unknown" as const, observation: previous };
    const result = await observe(slot.request, slot.attestation, prepared.serializedTransaction, slot.terms, signal).catch(() => null);
    if (signal.aborted || !result) return { latestCheck: "unknown" as const, observation: previous };
    const observation = validateRecordedMintObservation(result, slot.request, prepared);
    const age = nowMs() - Date.parse(observation.observedAt);
    if (!Number.isFinite(age) || age < -5000 || age > 60000) throw new Error("Mint observation age unavailable");
    atomic(() => {
      db.prepare("INSERT INTO mint_journal_observations(id,data) VALUES(?,?) ON CONFLICT(id) DO NOTHING")
        .run(id, JSON.stringify(observation));
    });
    const saved = await getObserved(id);
    if (!saved || !sameObservedMint(saved, observation)) throw new Error("Mint observation conflict");
    return { latestCheck: "matched" as const, observation: saved };
  }
  return { getObserved, reconcile };
}

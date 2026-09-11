import type { KeryxDB } from "../db/keryx-db";
import { withPrivateWorkerLock } from "../a2a/private-worker-lock";
import type { createWithdrawalMintJournal } from "./withdrawal-mint-journal";
import { withdrawalMintTermsSchema, type WithdrawalMintTerms } from "./withdrawal-mint-transaction";

type Journal = ReturnType<typeof createWithdrawalMintJournal>;
type Store = Pick<KeryxDB, "getCreatorWithdrawalAttestation">;

/** Internal queue recovery only. The directory, journal, store and fee terms are
 * operator-owned dependencies. Cursor/request IDs stay in private operator state.
 * No Circle submission, signing, broadcast or cash-out projection occurs here. */
export async function queueWithdrawalRelayPage(directory: string, journal: Journal, store: Store,
  selectedTerms: Omit<WithdrawalMintTerms, "nonce">, signal: AbortSignal,
  options: { afterId?: string; limit?: number } = {}) {
  const { nonce: _nonce, ...terms } = withdrawalMintTermsSchema.parse({ ...selectedTerms, nonce: 0 });
  void _nonce;
  const copiedOptions = { ...options };
  return withPrivateWorkerLock(directory, async () => {
    const page = journal.listGasAdmissionIds(copiedOptions.afterId, copiedOptions.limit ?? 32);
    let attached = 0, awaitingEvidence = 0, unavailable = 0, scanned = 0;
    let lastId = copiedOptions.afterId ?? null;
    for (const id of page.ids) {
      if (signal.aborted) return { state: "aborted" as const, attached, awaitingEvidence, unavailable, scanned, nextCursor: lastId };
      try {
        const held = await journal.getGasAdmission(id);
        if (!held) throw new Error();
        const response = await store.getCreatorWithdrawalAttestation(id, held.request.owner);
        if (signal.aborted) return { state: "aborted" as const, attached, awaitingEvidence, unavailable, scanned, nextCursor: lastId };
        if (!response) awaitingEvidence++;
        else { await journal.reserveAdmitted(id, response, terms, signal); attached++; }
      } catch {
        if (signal.aborted) return { state: "aborted" as const, attached, awaitingEvidence, unavailable, scanned, nextCursor: lastId };
        unavailable++;
      }
      scanned++; lastId = id;
    }
    return { state: page.nextCursor ? "limited" as const : "scanned" as const,
      attached, awaitingEvidence, unavailable, scanned, nextCursor: page.nextCursor };
  });
}

import type { HistoryMembershipStore } from "../history/owned-history";
import { AccountError, snapshotSchema, walletInputSchema, type AccountMembershipStore, type AccountSnapshot } from "./contracts";

/** Request-local interactive projection only. NEVER attach to a shared DB adapter.
 * Legacy profile/history keys have no consent to another wallet's private rows. */
export function createAccountHistoryProjection(store: AccountMembershipStore, raw: AccountSnapshot): HistoryMembershipStore {
  const snapshot = snapshotSchema.parse(raw);
  return Object.freeze({ async resolve(verifiedWallet: string) {
    if (walletInputSchema.parse(verifiedWallet) !== snapshot.session.wallet) throw new AccountError("account_unauthenticated");
    await store.assertCurrent(snapshot);
    return { accountId: snapshot.membership.accountId, revision: snapshot.membership.revision,
      wallets: snapshot.membership.members.map(m => m.wallet) };
  } });
}

/** Legacy orchestration helper, not a final serialization seal: its last awaited
 * account check can race an earlier privacy proof. Production account history
 * additionally requires the request-local native synchronous history seal.
 * Parent must use the existing owner/privacy-fenced reader, with no streaming.
 * Revalidate its row privacy after private IO, then serialize exact account/session
 * authorization in the store. This wrapper supplies no claims or privacy authority. */
export async function readWithAccountFence<T>(store: AccountMembershipStore, raw: AccountSnapshot,
  read: (projection: HistoryMembershipStore) => Promise<T>, privacyFence: (value: T) => Promise<void>, signal?: AbortSignal) {
  const start = snapshotSchema.parse(raw);
  const checkAbort = () => { if (signal?.aborted) throw new AccountError("account_unavailable"); };
  checkAbort(); await store.assertCurrent(start);
  const value = await read(createAccountHistoryProjection(store, start));
  checkAbort(); await privacyFence(value);
  checkAbort(); await store.assertCurrent(start); checkAbort();
  return value;
}

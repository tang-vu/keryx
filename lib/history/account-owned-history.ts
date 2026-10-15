import { isDeepStrictEqual } from "node:util";
import type { KeryxDB } from "../db/keryx-db";
import { AccountError, bindingSchema, interactiveSessionSchema, snapshotSchema, type AccountHistoryObservation,
  type AccountHistorySeal } from "../accounts/contracts";
import { createAccountHistoryProjection } from "../accounts/history-projection";
import { ACCOUNT_HISTORY_DEADLINE_MS, MAX_ACCOUNT_HISTORY_ITEMS, MAX_ACCOUNT_HISTORY_ORIGINAL_BYTES,
  MAX_ACCOUNT_HISTORY_TOTAL_BYTES } from "../accounts/sqlite-history-fence";
import { requirePrivacy } from "../run-privacy/contracts";
import { summarizeOwnershipOriginal } from "../run-claims/history";
import type { RunClaimBinding } from "../run-claims/contracts";
import { HistoryError } from "./personal-history";
import type { OwnedHistoryDB } from "./owned-history-reader";
import type { OwnedHistoryRow } from "./owned-history";

const unavailable = () => new HistoryError("history_unavailable");
type SessionContext = { db: KeryxDB; wallet: string; currentId: string };
type Detail = NonNullable<Awaited<ReturnType<typeof import("./owned-history-reader").readOwnedDetail>>>;

/** Explicit request view, never a global DB mutation or inherited membership.
 * Bearer tools and interactive sessions without account consent use this view. */
export function walletOwnedHistoryDb(db: OwnedHistoryDB): OwnedHistoryDB {
  return Object.freeze({ personalHistory: db.personalHistory, runOwnershipHistory: db.runOwnershipHistory,
    runPrivacy: db.runPrivacy, runPrivacyActive: db.runPrivacyActive });
}

/** The caller already authenticated the JWT and its exact durable tuple through
 * accountSessionContext. Hash/row selectors never become a new login credential. */
export async function accountOwnedHistory(context: SessionContext, rawBinding: RunClaimBinding, signal: AbortSignal) {
  const walletDb = walletOwnedHistoryDb(context.db), deadline = Date.now() + ACCOUNT_HISTORY_DEADLINE_MS;
  const check = () => { if (signal.aborted || Date.now() >= deadline) throw unavailable(); };
  check();
  const descriptor = Object.getOwnPropertyDescriptor(context.db, "accountMembership");
  if (!descriptor) return { db: walletDb, account: null };
  if (descriptor.enumerable) throw unavailable();
  const store = context.db.accountMembership;
  if (store === undefined) return { db: walletDb, account: null }; // Genuine optional absence, including the ordinary lazy getter.
  if (!store || typeof store.resolve !== "function" || typeof store.assertCurrent !== "function") throw unavailable();
  const row = await context.db.getWebSession(context.currentId); check();
  if (!row || row.hash !== context.currentId || row.wallet !== context.wallet) throw new AccountError("account_unauthenticated");
  const session = interactiveSessionSchema.parse({ sessionHash: row.hash, wallet: row.wallet, issuedAt: row.issuedAt, expiresAt: row.expiresAt });
  const binding = bindingSchema.parse(rawBinding), raw = await store.resolve(session, binding); check();
  if (!raw) return { db: walletDb, account: null }; // No explicit consent on this exact session.
  const snapshot = snapshotSchema.parse(raw);
  if (!isDeepStrictEqual(snapshot.session, session) || !isDeepStrictEqual(snapshot.binding, binding)) throw unavailable();
  if (typeof store.prepareHistoryFence !== "function") throw unavailable();
  const prepare = store.prepareHistoryFence.bind(store), privacy = requirePrivacy(walletDb);
  const observations = new Map<string, AccountHistoryObservation>();
  let observedBytes = 0;
  const watched = Object.freeze({ ...privacy, async owner(id: string, actor: Parameters<typeof privacy.owner>[1]) {
    check(); const item = await privacy.owner(id, actor); check();
    if (!item) return item;
    let value: AccountHistoryObservation;
    try {
      const bytes = Buffer.byteLength(JSON.stringify(item.run));
      if (bytes > MAX_ACCOUNT_HISTORY_ORIGINAL_BYTES) throw unavailable();
      const encoded = JSON.stringify({ id, ownerWallet: actor.wallet, run: item.run, state: item.state });
      value = JSON.parse(encoded) as AccountHistoryObservation;
      const previous = observations.get(id);
      if (previous) {
        // FIRST positive proof stays authoritative for this request. Never
        // overwrite it with a later changed body/state/owner that looks current.
        if (!isDeepStrictEqual(previous, value)) throw unavailable();
      } else {
        if (observations.size >= MAX_ACCOUNT_HISTORY_ITEMS || observedBytes + bytes > MAX_ACCOUNT_HISTORY_TOTAL_BYTES) throw unavailable();
        observations.set(id, value); observedBytes += bytes;
      }
    } catch { throw unavailable(); }
    return item;
  } });
  const db: OwnedHistoryDB = Object.freeze({ ...walletDb, runPrivacy: watched,
    historyMembership: createAccountHistoryProjection(store, snapshot) });

  function selectRows(rows: readonly OwnedHistoryRow[]) {
    check(); if (rows.length > MAX_ACCOUNT_HISTORY_ITEMS || new Set(rows.map(row => row.id)).size !== rows.length) throw unavailable();
    return rows.map(row => {
      const item = observations.get(row.id);
      if (!item || item.ownerWallet !== row.ownerWallet || item.state.erased || item.state.visibility !== row.visibility
        || item.state.revision !== row.revision) throw unavailable();
      // Bind every original-derived row field, not only the old question/date
      // fence. Receipt projections retain their existing financial contract.
      const summary = summarizeOwnershipOriginal(item.run);
      for (const key of ["id", "createdAt", "question", "provenance", "recordedSpendUsdc", "recordedCreatorAllocationUsdc", "paymentMode", "isFollowUp"] as const)
        if (!isDeepStrictEqual(row[key], summary[key])) throw unavailable();
      return { ...item, ownership: row.ownership };
    });
  }
  function selectDetail(item: Detail | null): AccountHistoryObservation[] {
    check(); if (!item) return [];
    const observed = observations.get(item.run.id);
    if (!observed || item.ownerWallet !== observed.ownerWallet || !isDeepStrictEqual(item.run, observed.run)
      || !isDeepStrictEqual(item.state, observed.state) || item.state.erased) throw unavailable();
    return [observed];
  }
  return { db, account: Object.freeze({ selectRows, selectDetail,
    async prepare(observed: readonly AccountHistoryObservation[]) {
      check(); const seal = await prepare(snapshot, observed, deadline); check();
      if (typeof seal !== "function") throw unavailable(); return seal;
    },
    async privacyFence(observed: readonly AccountHistoryObservation[]) {
      for (const item of observed) {
        check(); const current = await watched.owner(item.id, { wallet: item.ownerWallet, binding }); check();
        if (!current || current.state.erased) throw unavailable();
      }
    },
    seal(seal: AccountHistorySeal) {
      check(); const returned = seal();
      if (returned !== undefined) throw unavailable();
      check(); // Still synchronous; no private IO or await after native seal.
    },
  }) };
}

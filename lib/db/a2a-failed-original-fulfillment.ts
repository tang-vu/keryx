import type { DatabaseSync } from "node:sqlite";
import type { ArcNetworkProfile } from "../arc-network-profile";
import type { A2aOrder, A2aOrderResolution } from "../a2a/order";
import { validateA2aOriginalClaim, matchesA2aOriginalBinding } from "../a2a/original-claim";
import { canonicalJson } from "../canonical-json";
import {
  fulfillmentAuthoritySchema, fulfillmentClaimInputSchema, fulfillmentCompletionInputSchema,
  fulfillmentObjectSha256, matchesFailedFulfillmentOriginal, validateFulfilledQueryRun,
  type A2aFulfillmentClaim, type A2aFulfillmentCompletion, type A2aFulfillmentRecord,
  type FulfillmentAuthority, type FulfillmentClaimInput, type FulfillmentCompletionInput,
} from "../a2a/failed-original-fulfillment-protocol";
import { hasSettledProof } from "./a2a-original-claim";
import { assertSqliteResearchAuthority } from "./research-monthly";
import { writeSqliteQueryRun } from "./query-run-record";
import type { QueryRun } from "../types";
import { a2aResponseFromRun, quoteFromA2aOrder } from "../a2a/result";

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const originalId = (value: string) => { if (!/^a2a_[a-f0-9]{64}$/.test(value)) throw new Error("Fulfillment original refused"); return value; };
function noCreatorAttempts(db: DatabaseSync, id: string): boolean {
  return !db.prepare("SELECT 1 FROM payment_events WHERE query_id=? AND kind IS NOT 'inbound' LIMIT 1").get(id);
}
function readRecord(db: DatabaseSync, id: string): A2aFulfillmentRecord | null {
  const row = db.prepare("SELECT * FROM a2a_failed_original_fulfillments WHERE original_id=?").get(id);
  if (!row) return null;
  const input = fulfillmentClaimInputSchema.parse({ authority: JSON.parse(String(row.authority_data)),
    claimId: row.claim_id, claimedAt: row.claimed_at });
  const failedOrder = JSON.parse(String(row.failed_order_data)) as A2aOrder;
  if (input.authority.original.id !== id || !matchesFailedFulfillmentOriginal(failedOrder, input.authority))
    throw new Error("Retained fulfillment claim changed");
  const result = db.prepare("SELECT * FROM a2a_fulfillment_completions WHERE original_id=?").get(id);
  const completion = result ? fulfillmentCompletionInputSchema.parse({ claimId: result.claim_id, originalId: id,
    runSha256: result.run_sha256, providerLedgerSha256: result.provider_ledger_sha256, completedAt: result.completed_at }) : null;
  if (completion && completion.claimId !== input.claimId) throw new Error("Retained fulfillment completion changed");
  return { claim: { ...input, failedOrder }, completion };
}
function transact<T>(db: DatabaseSync, write: boolean, operation: () => T): T {
  db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
  try { const result = operation(); db.exec("COMMIT"); return result; }
  catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
}
export function getSqliteA2aFulfillment(db: DatabaseSync, id: string, profile: ArcNetworkProfile): A2aFulfillmentRecord | null {
  originalId(id); assertSqliteResearchAuthority(db, profile);
  return transact(db, false, () => { assertSqliteResearchAuthority(db, profile); return readRecord(db, id); });
}
/** A unique claim is permanent even after provider failure or process exit. It never requeues,
 * changes the failed original, or grants a second claimant an execution token. */
export function claimSqliteA2aFulfillment(db: DatabaseSync, raw: FulfillmentClaimInput,
  profile: ArcNetworkProfile, readOrder: (row: Record<string, unknown>) => A2aOrder): A2aFulfillmentClaim | null {
  const input = fulfillmentClaimInputSchema.parse(raw), authority = input.authority;
  validateA2aOriginalClaim(authority.original, profile);
  if (Date.parse(input.claimedAt) > Date.now() || Date.now() - Date.parse(input.claimedAt) > 60_000 ||
    Date.now() >= Date.parse(authority.expiresAt)) throw new Error("Fulfillment claim outside supplier window");
  assertSqliteResearchAuthority(db, profile, true);
  return transact(db, true, () => {
    assertSqliteResearchAuthority(db, profile, true);
    const row = db.prepare("SELECT * FROM a2a_orders WHERE id=?").get(authority.original.id);
    const order = row ? readOrder(row) : null;
    if (!order || !matchesFailedFulfillmentOriginal(order, authority) ||
      Date.parse(order.updatedAt) > Date.parse(input.claimedAt) ||
      !hasSettledProof(db, order, authority.original) || !noCreatorAttempts(db, order.id) ||
      db.prepare("SELECT 1 FROM query_runs WHERE id=?").get(order.queryId) ||
      db.prepare("SELECT 1 FROM a2a_failed_original_fulfillments WHERE original_id=? OR claim_id=?").get(order.id, input.claimId)) return null;
    db.prepare(`INSERT INTO a2a_failed_original_fulfillments(original_id,claim_id,authority_data,failed_order_data,claimed_at)
      VALUES(?,?,?,?,?)`).run(order.id, input.claimId, canonicalJson(authority), canonicalJson(order), input.claimedAt);
    const claim = readRecord(db, order.id)?.claim;
    if (!claim || !same(claim, { ...input, failedOrder: order })) throw new Error("Fulfillment claim readback refused");
    return claim;
  });
}
function resolution(claim: A2aFulfillmentClaim, completion: FulfillmentCompletionInput): A2aOrderResolution {
  return { action: "fulfill_failed_original", actor: "operator-cli", reason: "verified_failed_original_fulfilled",
    resolvedAt: completion.completedAt,
    evidence: { executionJournalVersion: 1, paymentBoundaryCrossed: false, resultSaveBoundaryCrossed: true,
      creatorAttempts: 0, settledCreatorMicros: 0, pendingCreatorMicros: 0, failedCreatorMicros: 0,
      simulatedCreatorMicros: 0, queryRunFound: true },
    fulfillment: { claimId: claim.claimId, originalFailureSha256: claim.authority.originalEvidenceSha256,
      authoritySha256: fulfillmentObjectSha256(claim.authority), providerLedgerSha256: completion.providerLedgerSha256,
      runSha256: completion.runSha256 } };
}
function hasCompletion(db: DatabaseSync, authority: FulfillmentAuthority,
  readOrder: (row: Record<string, unknown>) => A2aOrder): boolean {
  const record = readRecord(db, authority.original.id);
  if (!record?.completion || !same(record.claim.authority, authority)) return false;
  const row = db.prepare("SELECT * FROM a2a_orders WHERE id=?").get(authority.original.id);
  const saved = db.prepare("SELECT data FROM query_runs WHERE id=?").get(authority.original.queryId);
  if (!row || !saved || typeof saved.data !== "string") return false;
  const order = readOrder(row), run = JSON.parse(saved.data) as QueryRun;
  if (!matchesA2aOriginalBinding(order, authority.original) || order.status !== "completed" || order.errorCode !== null ||
    order.startedAt !== record.claim.failedOrder.startedAt || order.workerId !== record.claim.failedOrder.workerId ||
    order.executionJournalVersion !== 1 || order.paymentStartedAt !== null ||
    order.resultSavingAt !== record.completion.completedAt || order.updatedAt !== record.completion.completedAt ||
    !same(order.resolution, resolution(record.claim, record.completion)) || !hasSettledProof(db, order, authority.original) ||
    !noCreatorAttempts(db, order.id)) return false;
  try { validateFulfilledQueryRun(run, record.claim, record.completion); }
  catch { return false; }
  const expected = { ...record.claim.failedOrder, status: "completed", errorCode: null,
    resultSavingAt: record.completion.completedAt, updatedAt: record.completion.completedAt,
    resolution: resolution(record.claim, record.completion),
    response: a2aResponseFromRun(run, quoteFromA2aOrder(record.claim.failedOrder),
      { acceptedAt: record.claim.failedOrder.createdAt, startedAt: record.claim.failedOrder.startedAt }) };
  return same(order, expected);
}
/** One native transaction inserts the actual run once and commits only the matching failed
 * original. A rollback cannot strand a saved run or erase the immutable failure snapshot. */
export function completeSqliteA2aFulfillment(db: DatabaseSync, raw: A2aFulfillmentCompletion,
  profile: ArcNetworkProfile, readOrder: (row: Record<string, unknown>) => A2aOrder): boolean {
  const completion = fulfillmentCompletionInputSchema.parse({ claimId: raw.claimId, originalId: raw.originalId,
    runSha256: raw.runSha256, providerLedgerSha256: raw.providerLedgerSha256, completedAt: raw.completedAt });
  if (Date.parse(completion.completedAt) > Date.now()) throw new Error("Fulfillment completion chronology refused");
  // Copy at the boundary so the stored payload and digest use one result snapshot.
  const run = JSON.parse(canonicalJson(raw.run)) as QueryRun;
  assertSqliteResearchAuthority(db, profile, true);
  return transact(db, true, () => {
    assertSqliteResearchAuthority(db, profile, true);
    const record = readRecord(db, completion.originalId);
    if (!record || record.claim.claimId !== completion.claimId) return false;
    validateA2aOriginalClaim(record.claim.authority.original, profile);
    validateFulfilledQueryRun(run, record.claim, completion);
    if (record.completion) return same(record.completion, completion) && hasCompletion(db, record.claim.authority, readOrder);
    const row = db.prepare("SELECT * FROM a2a_orders WHERE id=?").get(completion.originalId);
    const order = row ? readOrder(row) : null;
    if (!order || !matchesFailedFulfillmentOriginal(order, record.claim.authority) ||
      !same(order, record.claim.failedOrder) || !hasSettledProof(db, order, record.claim.authority.original) ||
      !noCreatorAttempts(db, order.id) || db.prepare("SELECT 1 FROM query_runs WHERE id=?").get(run.id)) return false;
    const receipt = a2aResponseFromRun(run, quoteFromA2aOrder(order), { acceptedAt: order.createdAt, startedAt: order.startedAt });
    writeSqliteQueryRun(db, run, false);
    const changed = db.prepare(`UPDATE a2a_orders SET status='completed',response_data=?,error_code=NULL,
      result_saving_at=?,resolution_data=?,updated_at=? WHERE id=? AND status='failed' AND error_code='research_failed'
      AND payment_started_at IS NULL AND result_saving_at IS NULL`).run(JSON.stringify(receipt), completion.completedAt,
        canonicalJson(resolution(record.claim, completion)), completion.completedAt, order.id);
    if (changed.changes !== 1) throw new Error("Fulfillment completion original CAS refused");
    db.prepare(`INSERT INTO a2a_fulfillment_completions(original_id,claim_id,run_sha256,provider_ledger_sha256,completed_at)
      VALUES(?,?,?,?,?)`).run(order.id, completion.claimId, completion.runSha256, completion.providerLedgerSha256, completion.completedAt);
    if (!hasCompletion(db, record.claim.authority, readOrder)) throw new Error("Fulfillment completion readback refused");
    return true;
  });
}
/** Exact native delivered proof only. It cannot claim, initialize or mutate a result. */
export function hasSqliteA2aFulfillment(db: DatabaseSync, raw: FulfillmentAuthority,
  profile: ArcNetworkProfile, readOrder: (row: Record<string, unknown>) => A2aOrder): boolean {
  const authority = fulfillmentAuthoritySchema.parse(raw); validateA2aOriginalClaim(authority.original, profile);
  assertSqliteResearchAuthority(db, profile);
  return transact(db, false, () => { assertSqliteResearchAuthority(db, profile); return hasCompletion(db, authority, readOrder); });
}

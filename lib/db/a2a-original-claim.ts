import type { DatabaseSync } from "node:sqlite";
import type { ArcNetworkProfile } from "../arc-network-profile";
import type { A2aOrder } from "../a2a/order";
import { matchesA2aOriginalBinding, matchesA2aOriginalClaim, validateA2aClaimWorker, validateA2aOriginalClaim, type A2aOriginalClaim } from "../a2a/original-claim";
import { assertSqliteResearchAuthority } from "./research-monthly";

function hasSettledProof(db: DatabaseSync, order: A2aOrder, binding: A2aOriginalClaim): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM research_purchase_authorizations c
    JOIN payment_events p ON p.id=? AND p.kind='inbound' AND p.source_id='a2a'
      AND p.query_id=c.purchase_id AND lower(p.payer)=c.payer AND lower(p.payee)=c.payee
      AND lower(p.authorization_id)=c.authorization_id AND p.network=c.network
      AND p.settled=1 AND p.settlement_status='settled' AND p.tx_hash=? AND p.amount_usdc=?
    WHERE c.network=? AND c.asset=? AND c.payer=? AND c.payee=? AND c.authorization_id=?
      AND c.product='a2a' AND c.purchase_id=? AND c.request_hash=? AND c.amount_micros=?
      AND NOT EXISTS(SELECT 1 FROM research_monthly_redemptions WHERE order_id=c.purchase_id)`)
    .get(`inbound_${binding.id}`, order.transaction, Number(binding.amountMicroUsdc) / 1e6,
      binding.network, binding.asset, binding.payer, binding.payee, binding.authorizationId,
      binding.id, binding.requestHash, Number(binding.amountMicroUsdc)));
}

/** One protected read snapshot; returns no question, identifiers, journal rows or writer authority. */
export function hasSqliteA2aOriginalSettlement(db: DatabaseSync, raw: A2aOriginalClaim,
  profile: ArcNetworkProfile, readOrder: (row: Record<string, unknown>) => A2aOrder): boolean {
  const binding = validateA2aOriginalClaim(raw, profile);
  assertSqliteResearchAuthority(db, profile);
  db.exec("BEGIN");
  try {
    assertSqliteResearchAuthority(db, profile);
    const row = db.prepare("SELECT * FROM a2a_orders WHERE id=?").get(binding.id);
    const order = row ? readOrder(row) : null;
    const result = Boolean(order && matchesA2aOriginalBinding(order, binding) && hasSettledProof(db, order, binding));
    db.exec("COMMIT");
    return result;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** No row is started until every binding and original settled proof passes under the writer lock. */
export function claimSqliteA2aOriginal(db: DatabaseSync, raw: A2aOriginalClaim, workerId: string, startedAt: string,
  profile: ArcNetworkProfile, readOrder: (row: Record<string, unknown>) => A2aOrder): A2aOrder | null {
  const binding = validateA2aOriginalClaim(raw, profile);
  validateA2aClaimWorker(workerId, startedAt);
  assertSqliteResearchAuthority(db, profile, true);
  db.exec("BEGIN IMMEDIATE");
  try {
    assertSqliteResearchAuthority(db, profile, true);
    const row = db.prepare("SELECT * FROM a2a_orders WHERE id=?").get(binding.id);
    let claimed: A2aOrder | null = null;
    if (row) {
      const order = readOrder(row);
      if (matchesA2aOriginalClaim(order, binding) && hasSettledProof(db, order, binding) &&
        !db.prepare("SELECT 1 FROM query_runs WHERE id=?").get(binding.queryId) &&
        !db.prepare("SELECT 1 FROM payment_events WHERE query_id=? AND kind IS NOT 'inbound'").get(binding.queryId)) {
        const updated = db.prepare(`UPDATE a2a_orders SET started_at=?,worker_id=?,updated_at=?
          WHERE id=? AND status='running' AND started_at IS NULL AND worker_id IS NULL RETURNING *`)
          .get(startedAt, workerId, startedAt, binding.id);
        if (updated) claimed = readOrder(updated);
      }
    }
    db.exec("COMMIT");
    return claimed;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

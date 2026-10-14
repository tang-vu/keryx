import { randomUUID } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { assertOrdinarySqliteResearchAuthority } from "./research-monthly";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteWritePolicy } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { assertStorageFences, STORAGE_IDENTITY_TABLE, storageFenceStatements } from "./storage-identity-sqlite";
import { parseScopes } from "../api-key-scopes";
import { exactA2aMicros } from "../a2a/amount-micros";
import { AcceptanceError, acceptanceAuthoritySchema, acceptanceEntrySchema, acceptanceInputSchema, acceptanceWallet,
  deliverableIdSchema, networkSchema, type AcceptanceAuthority, type DeliverableAcceptanceStore } from "../deliverable-acceptance/contracts";
import { acceptanceMetrics, originalBinding, ownerSnapshot, publicState, sha256 } from "../deliverable-acceptance/original";

export const DELIVERABLE_ACCEPTANCE_SQL = `
CREATE TABLE IF NOT EXISTS deliverable_acceptance_store (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deliverable_acceptance_entries (
  owner TEXT NOT NULL, network TEXT NOT NULL, original_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),
  idempotency_key TEXT NOT NULL, original_fingerprint TEXT NOT NULL, delivered_digest TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),
  PRIMARY KEY(owner,network,original_id,revision), UNIQUE(owner,network,original_id,idempotency_key)
);
CREATE TRIGGER IF NOT EXISTS deliverable_acceptance_store_immutable BEFORE UPDATE ON deliverable_acceptance_store BEGIN SELECT RAISE(ABORT,'acceptance_unavailable'); END;
CREATE TRIGGER IF NOT EXISTS deliverable_acceptance_store_no_delete BEFORE DELETE ON deliverable_acceptance_store BEGIN SELECT RAISE(ABORT,'acceptance_unavailable'); END;
CREATE TRIGGER IF NOT EXISTS deliverable_acceptance_entries_immutable BEFORE UPDATE ON deliverable_acceptance_entries BEGIN SELECT RAISE(ABORT,'acceptance_unavailable'); END;
CREATE TRIGGER IF NOT EXISTS deliverable_acceptance_entries_no_delete BEFORE DELETE ON deliverable_acceptance_entries BEGIN SELECT RAISE(ABORT,'acceptance_unavailable'); END;`;
const names = ["deliverable_acceptance_store", "deliverable_acceptance_entries"];
const shapes = (db: DatabaseSync, excluded: readonly string[] = []) => JSON.stringify(db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name IN (?,?)${excluded.length ? ` AND name NOT IN (${excluded.map(() => "?").join(",")})` : ""} ORDER BY type,name`).all(...names, ...excluded));
let expectedShape: string | undefined;
function schema(db: DatabaseSync, excluded: readonly string[] = []) {
  if (!expectedShape) { const reference = new DatabaseSync(":memory:"); try { reference.exec(DELIVERABLE_ACCEPTANCE_SQL); expectedShape = shapes(reference); } finally { reference.close(); } }
  if (shapes(db, excluded) !== expectedShape) throw new AcceptanceError("acceptance_unavailable");
}
function active(db: DatabaseSync, owner: string, raw: AcceptanceAuthority) {
  const authority = acceptanceAuthoritySchema.parse(raw), now = Date.now();
  if (authority.kind === "session") {
    if (!db.prepare("SELECT 1 FROM web_sessions WHERE hash=? AND wallet=? AND issued_at<=? AND expires_at>?").get(authority.id, owner, now, now))
      throw new AcceptanceError("acceptance_unauthenticated");
  } else {
    const key = db.prepare("SELECT scopes FROM api_keys WHERE id=? AND lower(wallet)=? AND revoked_at IS NULL").get(authority.id, owner);
    if (!key || !parseScopes(key.scopes as string | null).includes("deliverable:write")) throw new AcceptanceError("acceptance_unauthenticated");
  }
}
/** Cohesive ordinary journal; sealed/native connection cores never acquire this optional port. */
export function createSqliteDeliverableAcceptance(db: DatabaseSync): DeliverableAcceptanceStore {
  assertOrdinarySqliteResearchAuthority(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    assertOrdinarySqliteResearchAuthority(db);
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE tbl_name IN (?,?) LIMIT 1").get(...names)) schema(db);
    db.exec(DELIVERABLE_ACCEPTANCE_SQL); schema(db);
    db.prepare("INSERT OR IGNORE INTO deliverable_acceptance_store(singleton,id) VALUES(1,?)").run(randomUUID()); db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return acceptancePort(db, () => assertOrdinarySqliteResearchAuthority(db), () => schema(db));
}

/** The reviewed domain is installed only by the stopped-writer migration. */
export function createEnrolledSqliteDeliverableAcceptance(db: DatabaseSync): DeliverableAcceptanceStore | undefined {
  const unavailable = () => new AcceptanceError("acceptance_unavailable");
  if (arguments.length !== 1) throw unavailable();
  const identity = assertVerifiedSqliteConnection(db);
  if (identity.authorityMode !== "mainnet-real") throw unavailable();
  const fences = Object.keys(storageFenceStatements(db, identity));
  const excluded = new Set([STORAGE_IDENTITY_TABLE, "storage_identity_no_update", "storage_identity_no_delete", "storage_identity_no_insert", ...fences]);
  const admitted = sqliteApplicationSchemaProfile(db, excluded);
  if (!supportedSqliteApplicationProfiles(true).includes(admitted)) throw unavailable();
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE tbl_name IN (?,?) LIMIT 1").get(...names)) return undefined;
  schema(db, fences);
  const seed = db.prepare("SELECT singleton,id FROM deliverable_acceptance_store LIMIT 2").all();
  if (seed.length !== 1 || seed[0].singleton !== 1 || typeof seed[0].id !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(seed[0].id)) throw unavailable();
  let refused = false;
  const retire = () => { refused = true; db.close(); };
  const contention = (error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
    && "errcode" in error && (error.errcode === 5 || error.errcode === 6);
  const check = () => {
    if (refused) throw unavailable();
    try {
      assertVerifiedSqliteConnection(db); assertStorageFences(db, identity);
      if (sqliteApplicationSchemaProfile(db, excluded) !== admitted) throw unavailable();
      schema(db, fences);
    } catch (error) { if (!contention(error)) retire(); throw unavailable(); }
  };
  const authority = (write: boolean) => {
    // This policy check reads the genuine connection's private metadata only.
    // A denied readonly write does not retire the reader or execute SQL.
    if (write) { try { assertVerifiedSqliteWritePolicy(db); } catch { throw unavailable(); } }
    check();
  };
  const sql = <T>(read: () => T): T => {
    if (refused) throw unavailable();
    try { return read(); } catch (error) { if (!contention(error)) retire(); throw unavailable(); }
  };
  // Catch guards inside prepare/get/all/run/exec even when a public projection
  // intentionally catches an invalid original binding. No connection escapes.
  const guarded = new Proxy(db, { get(target, property) {
    if (property === "exec") return (query: string) => sql(() => target.exec(query));
    if (property === "prepare") return (query: string) => {
      const statement = sql(() => target.prepare(query));
      return new Proxy(statement, { get(value, key) {
        if (["get", "all", "run"].includes(String(key))) return (...args: unknown[]) => sql(() => Reflect.apply(Reflect.get(value, key), value, args));
        throw unavailable();
      } }) as StatementSync;
    };
    throw unavailable();
  } });
  return acceptancePort(guarded, authority, () => schema(guarded, fences), check);
}

/** Private composition: callers cannot supply a custom native authority. */
function acceptancePort(db: DatabaseSync, assertAuthority: (write: boolean) => void,
  assertSchema: () => void, afterNativeRead?: () => void): DeliverableAcceptanceStore {
  const original = (owner: string, network: string, id: string) => {
    const row = db.prepare("SELECT * FROM a2a_orders WHERE id=? AND lower(payer)=?").get(id, owner);
    if (!row || typeof row.response_data !== "string") throw new AcceptanceError("acceptance_unavailable");
    const settled = Boolean(db.prepare(`SELECT 1 FROM research_purchase_authorizations c JOIN payment_events p
      ON p.id=? AND p.kind='inbound' AND p.source_id='a2a' AND p.query_id=c.purchase_id AND lower(p.payer)=c.payer
      AND lower(p.payee)=c.payee AND lower(p.authorization_id)=c.authorization_id AND p.network=c.network
      AND p.settled=1 AND p.settlement_status='settled' AND p.tx_hash=? AND p.amount_usdc=?
      WHERE c.network=? AND c.payer=? AND c.payee=lower(?) AND c.authorization_id=lower(?)
      AND c.product='a2a' AND c.purchase_id=? AND c.request_hash=? AND c.amount_micros=?
      AND NOT EXISTS(SELECT 1 FROM research_monthly_redemptions WHERE order_id=c.purchase_id)`)
      .get(`inbound_${id}`, row.transaction_id, row.amount_usdc, network, owner, String(row.payee), String(row.authorization_id), id,
        String(row.request_hash), exactA2aMicros(Number(row.amount_usdc)) ?? -1));
    const text = JSON.stringify({ order: row, deliveryText: row.response_data, settled, network });
    const store = db.prepare("SELECT id FROM deliverable_acceptance_store WHERE singleton=1").get();
    return originalBinding(String(store?.id), text, owner, network, id);
  };
  const latest = (owner: string, network: string, id: string) => {
    const row = db.prepare("SELECT data FROM deliverable_acceptance_entries WHERE owner=? AND network=? AND original_id=? ORDER BY revision DESC LIMIT 1").get(owner, network, id);
    return row ? acceptanceEntrySchema.parse(JSON.parse(String(row.data))) : null;
  };
  const pending = (id: string) => Boolean(db.prepare("SELECT 1 FROM payment_events WHERE query_id=? AND kind IS NOT 'inbound' AND (settlement_status='pending' OR settlement_status IS NULL) LIMIT 1").get(id));
  const transaction = <T>(write: boolean, fn: () => T): T => {
    assertAuthority(write); db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    try { assertAuthority(write); assertSchema(); const result = fn(); afterNativeRead?.(); db.exec("COMMIT"); afterNativeRead?.(); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const args = (owner: string, network: string, id: string) => [acceptanceWallet(owner), networkSchema.parse(network), deliverableIdSchema.parse(id)] as const;
  const sharedState = (network: string, id: string) => {
    const row = db.prepare("SELECT lower(payer) AS owner FROM a2a_orders WHERE id=?").get(id);
    if (!row) return publicState(null);
    try { const binding = original(String(row.owner), network, id), entry = latest(String(row.owner), network, id);
      return publicState(entry?.originalFingerprint === binding.originalFingerprint && entry.deliveredDigest === binding.deliveredDigest ? entry : null);
    } catch { return publicState(null); }
  };
  return Object.freeze({
    async read(...raw) { const [owner, network, id] = args(...raw); return transaction(false, () => ownerSnapshot(original(owner, network, id), owner, network, id, latest(owner, network, id), pending(id))); },
    async submit(rawOwner, rawNetwork, rawId, rawInput, authority) {
      const [owner, network, id] = args(rawOwner, rawNetwork, rawId), input = acceptanceInputSchema.parse(rawInput);
      return transaction(true, () => {
        active(db, owner, authority);
        const binding = original(owner, network, id), current = latest(owner, network, id);
        if (binding.originalFingerprint !== input.originalFingerprint || binding.deliveredDigest !== input.deliveredDigest) throw new AcceptanceError("acceptance_conflict");
        const replay = db.prepare("SELECT data FROM deliverable_acceptance_entries WHERE owner=? AND network=? AND original_id=? AND idempotency_key=?").get(owner, network, id, input.idempotencyKey);
        if (replay) {
          const entry = acceptanceEntrySchema.parse(JSON.parse(String(replay.data)));
          const { revision: _revision, submittedAt: _submittedAt, ...replayedInput } = entry;
          if (sha256(JSON.stringify(replayedInput)) !== sha256(JSON.stringify(input))) throw new AcceptanceError("acceptance_conflict");
          return ownerSnapshot(binding, owner, network, id, current, pending(id));
        }
        if ((current?.revision ?? 0) !== input.expectedRevision || current?.originalFingerprint && current.originalFingerprint !== binding.originalFingerprint)
          throw new AcceptanceError("acceptance_conflict");
        const entry = acceptanceEntrySchema.parse({ ...input, revision: input.expectedRevision + 1, submittedAt: new Date().toISOString() });
        db.prepare("INSERT INTO deliverable_acceptance_entries(owner,network,original_id,revision,idempotency_key,original_fingerprint,delivered_digest,data) VALUES(?,?,?,?,?,?,?,?)")
          .run(owner, network, id, entry.revision, entry.idempotencyKey, entry.originalFingerprint, entry.deliveredDigest, JSON.stringify(entry));
        return ownerSnapshot(binding, owner, network, id, latest(owner, network, id), pending(id));
      });
    },
    async publicState(rawNetwork, rawId) {
      const network = networkSchema.parse(rawNetwork), id = deliverableIdSchema.parse(rawId);
      return transaction(false, () => sharedState(network, id));
    },
    async metrics(rawNetwork) {
      const network = networkSchema.parse(rawNetwork);
      return transaction(false, () => {
        const rows = db.prepare(`SELECT DISTINCT original_id FROM deliverable_acceptance_entries e WHERE network=?
          AND revision=(SELECT max(revision) FROM deliverable_acceptance_entries WHERE owner=e.owner AND network=e.network AND original_id=e.original_id)
          AND json_extract(data,'$.publishState')=1 ORDER BY original_id LIMIT 1001`).all(network);
        if (rows.length > 1000) throw new AcceptanceError("acceptance_unavailable");
        return acceptanceMetrics(rows.map(row => sharedState(network, String(row.original_id))));
      });
    },
  } satisfies DeliverableAcceptanceStore);
}

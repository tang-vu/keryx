import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { GATEWAY_FUNDING_TABLES } from "./gateway-funding-ledger-types";

const DATA = "TEXT NOT NULL CHECK(json_valid(data) AND length(CAST(data AS BLOB))<=32768)";
export const GATEWAY_FUNDING_SCHEMA: Readonly<Record<string, string>> = Object.freeze({
  gateway_funding_namespaces: `CREATE TABLE gateway_funding_namespaces(sender TEXT PRIMARY KEY,data ${DATA})`,
  gateway_funding_policies: `CREATE TABLE gateway_funding_policies(policy_id TEXT PRIMARY KEY,data ${DATA})`,
  gateway_funding_authorizations: `CREATE TABLE gateway_funding_authorizations(operation_id TEXT PRIMARY KEY,owner_authorization_id TEXT NOT NULL UNIQUE,data ${DATA})`,
  gateway_funding_operations: `CREATE TABLE gateway_funding_operations(operation_id TEXT PRIMARY KEY,data ${DATA})`,
  gateway_funding_reservations: `CREATE TABLE gateway_funding_reservations(operation_id TEXT NOT NULL,step TEXT NOT NULL,sender TEXT NOT NULL,nonce TEXT NOT NULL,data ${DATA},PRIMARY KEY(operation_id,step),UNIQUE(sender,nonce))`,
  gateway_funding_crypto_claims: `CREATE TABLE gateway_funding_crypto_claims(operation_id TEXT NOT NULL,step TEXT NOT NULL,claim_id TEXT NOT NULL UNIQUE,PRIMARY KEY(operation_id,step))`,
  gateway_funding_prepared: `CREATE TABLE gateway_funding_prepared(operation_id TEXT NOT NULL,step TEXT NOT NULL,crypto_claim_id TEXT NOT NULL,transaction_hash TEXT NOT NULL UNIQUE,data ${DATA},PRIMARY KEY(operation_id,step))`,
  gateway_funding_broadcast_claims: `CREATE TABLE gateway_funding_broadcast_claims(operation_id TEXT NOT NULL,step TEXT NOT NULL,claim_id TEXT NOT NULL UNIQUE,PRIMARY KEY(operation_id,step))`,
  gateway_funding_observations: `CREATE TABLE gateway_funding_observations(observation_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,step TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('unknown','seen','terminal')),data ${DATA})`,
});
export const GATEWAY_FUNDING_INDEXES = Object.freeze({
  gateway_funding_observations_slot_kind: "CREATE INDEX gateway_funding_observations_slot_kind ON gateway_funding_observations(operation_id,step,kind)",
});
function fail(): never { throw new Error("Gateway funding ledger schema unavailable"); }
/** Included in the application's exact identity-fence inventory. Absent ledger
 * is allowed for the existing application, but opening the domain refuses it.
 * Partial or modified ledger schema is never repaired by application init. */
export function gatewayFundingFenceStatements(db: DatabaseSync, required = false): Record<string, string> {
  const present = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name GLOB 'gateway_funding_*' LIMIT 10").all();
  if (!present.length && !required) return {};
  if (present.length !== GATEWAY_FUNDING_TABLES.length) fail();
  for (const [name, sql] of Object.entries(GATEWAY_FUNDING_INDEXES)) {
    if (db.prepare("SELECT sql=? AS matches FROM sqlite_schema WHERE type='index' AND name=?").get(sql, name)?.matches !== 1) fail();
  }
  const result: Record<string, string> = {};
  for (const table of GATEWAY_FUNDING_TABLES) {
    if (db.prepare("SELECT sql=? AS matches FROM sqlite_schema WHERE type='table' AND name=?").get(GATEWAY_FUNDING_SCHEMA[table], table)?.matches !== 1) fail();
    for (const verb of ["INSERT", "UPDATE", "DELETE"]) {
      const name = `funding_domain_${createHash("sha256").update(table).digest("hex").slice(0, 16)}_${verb.toLowerCase()}`;
      const allowed = verb === "INSERT" || table === "gateway_funding_namespaces" && verb === "UPDATE";
      const condition = allowed ? `keryx_funding_capability('${table}','${verb}') IS NOT 1` : "1";
      result[name] = `CREATE TRIGGER ${name} BEFORE ${verb} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT,'funding domain writer required'); END`;
    }
  }
  const name = "funding_terminal_observer_required";
  result[name] = `CREATE TRIGGER ${name} BEFORE INSERT ON gateway_funding_observations WHEN NEW.kind='terminal' AND keryx_funding_capability('terminal-observer','INSERT') IS NOT 1 BEGIN SELECT RAISE(ABORT,'funding terminal observer required'); END`;
  return result;
}
export function assertGatewayFundingSchema(db: DatabaseSync): void {
  for (const [name, sql] of Object.entries(gatewayFundingFenceStatements(db, true))) {
    if (db.prepare("SELECT sql=? AS matches FROM sqlite_schema WHERE type='trigger' AND name=?").get(sql, name)?.matches !== 1) fail();
  }
}

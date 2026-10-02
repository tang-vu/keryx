import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { refuseStorage } from "./storage-identity";
import { STORAGE_APPLICATION_TABLES, STORAGE_IDENTITY_TABLE } from "./storage-identity-sqlite";
import { GATEWAY_FUNDING_TABLES } from "./gateway-funding-ledger-types";

export const STORAGE_SNAPSHOT_LIMITS = Object.freeze({ deadlineMs: 15_000, fileBytes: 64 * 1024 * 1024,
  rows: 100_000, fieldBytes: 2 * 1024 * 1024, totalBytes: 128 * 1024 * 1024, encodedBytes: 32 * 1024 * 1024, schemaObjects: 512, columns: 128 });
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export interface StorageSnapshot {
  schemaDigest: string; snapshotDigest: string; rowCount: number;
  tableCounts: Record<string, number>; unknownClasses: string[]; enrollmentRefusal?: string;
}
/** Typed, length-framed logical encoding; preserves integer precision, blobs and real bit patterns. */
export function encodeStorageValue(value: unknown, sqliteType: string): string {
  if (sqliteType === "null" && value === null) return '["null"]';
  if (sqliteType === "integer" && typeof value === "bigint") return JSON.stringify(["integer", value.toString()]);
  if (sqliteType === "real" && typeof value === "number" && Number.isFinite(value)) {
    const bits = Buffer.alloc(8); bits.writeDoubleBE(value); return JSON.stringify(["real", bits.toString("hex")]);
  }
  if (sqliteType === "text" && typeof value === "string") return JSON.stringify(["text", value]);
  if (sqliteType === "blob" && value instanceof Uint8Array) return JSON.stringify(["blob", Buffer.from(value).toString("hex")]);
  return refuseStorage("unsupported_value");
}
/** Caller owns an already-held snapshot/IMMEDIATE transaction. No networking, config, decryption or mutation. */
export function scanFullStorageSnapshot(db: DatabaseSync): StorageSnapshot {
  const deadline = Date.now() + STORAGE_SNAPSHOT_LIMITS.deadlineMs;
  const check = () => { if (Date.now() >= deadline) refuseStorage("snapshot_deadline"); };
  const schemaFields = ["type", "name", "tbl_name", "sql"];
  const boundedSchema = schemaFields.flatMap(name => [
    `length(CAST(${quote(name)} AS BLOB)) AS ${quote(`${name}_bytes`)}`,
    `CASE WHEN length(CAST(${quote(name)} AS BLOB))<=${STORAGE_SNAPSHOT_LIMITS.fieldBytes} THEN CAST(${quote(name)} AS BLOB) ELSE NULL END AS ${quote(name)}`,
  ]);
  const schema: Record<string, unknown>[] = [];
  let schemaBytes = 0;
  const decodeText = (value: unknown): string | null => {
    if (value === null) return null;
    if (!(value instanceof Uint8Array)) return refuseStorage("unsupported_value");
    try { return new TextDecoder("utf-8", { fatal: true }).decode(value); }
    catch { return refuseStorage("malformed_text"); }
  };
  for (const row of db.prepare(`SELECT ${boundedSchema.join(",")} FROM sqlite_schema ORDER BY type,name LIMIT ?`).iterate(STORAGE_SNAPSHOT_LIMITS.schemaObjects + 1)) {
    check();
    const object: Record<string, unknown> = {};
    for (const name of schemaFields) {
      if (Number(row[`${name}_bytes`]) > STORAGE_SNAPSHOT_LIMITS.fieldBytes) refuseStorage("schema_limit");
      object[name] = decodeText(row[name]);
    }
    schemaBytes += Buffer.byteLength(JSON.stringify(object));
    if (schemaBytes > STORAGE_SNAPSHOT_LIMITS.encodedBytes) refuseStorage("encoded_byte_limit");
    schema.push(object);
  }
  if (schema.length > STORAGE_SNAPSHOT_LIMITS.schemaObjects) refuseStorage("schema_limit");
  for (const object of schema) {
    if ([object.name, object.tbl_name, object.sql].some(value => typeof value === "string" && Buffer.byteLength(value) > STORAGE_SNAPSHOT_LIMITS.fieldBytes)) refuseStorage("schema_limit");
    if (object.type === "view" || typeof object.sql === "string" && /\bCREATE\s+VIRTUAL\s+TABLE\b/i.test(object.sql)) refuseStorage("unsupported_schema");
  }
  const schemaDigest = createHash("sha256").update(JSON.stringify(schema)).digest("hex");
  const hash = createHash("sha256");
  const frame = (value: string) => { hash.update(`${Buffer.byteLength(value)}:`); hash.update(value); };
  frame("keryx-full-logical-snapshot-v1"); frame(schemaDigest);
  let rowCount = 0, totalBytes = 0, encodedBytes = schemaBytes, enrollmentRefusal: string | undefined;
  const tableCounts: Record<string, number> = {}, unknown = new Set<string>();
  const funded = new Set([...GATEWAY_FUNDING_TABLES, "session_grants", "browser_authorization_intents", "browser_journal_bindings", "browser_signer_capacity",
    "browser_signing_v2_writer", "browser_signing_v3_writer", "browser_signing_namespaces", "browser_signing_queries", "browser_signing_originals",
    "browser_retained_grants", "session_grant_consents", "session_withdrawal_preparations", "session_withdrawal_completions",
    "session_withdrawal_exposures", "session_withdrawal_cancellations", "a2a_orders", "withdrawals", "creator_withdrawal_requests", "creator_withdrawal_transfer_attempts",
    "hosted_treasury_policies", "hosted_treasury_authorizations",
    "creator_owner_withdrawal_completions",
    "creator_withdrawal_attestations", "private_research_intents", "private_treasury_pools", "private_treasury_reservations",
    "private_research_payment_attempts", "private_creator_submissions", "private_creator_confirmations", "private_treasury_releases",
    "private_research_executions", "private_research_results", "private_research_interruptions", "auth_challenges", "web_sessions", "api_keys", "api_key_usage", "gap_intents"]);
  for (const object of schema.filter(row => row.type === "table")) {
    check(); const table = String(object.name);
    if (table === STORAGE_IDENTITY_TABLE) continue;
    const columns = [...db.prepare(`SELECT CASE WHEN length(CAST(name AS BLOB))<=${STORAGE_SNAPSHOT_LIMITS.fieldBytes} THEN CAST(name AS BLOB) ELSE NULL END AS name, length(CAST(name AS BLOB)) AS name_bytes, hidden FROM pragma_table_xinfo(?) LIMIT ?`).iterate(table, STORAGE_SNAPSHOT_LIMITS.columns + 1)].map(column => {
      if (Number(column.name_bytes) > STORAGE_SNAPSHOT_LIMITS.fieldBytes) refuseStorage("schema_limit");
      return { name: decodeText(column.name), hidden: column.hidden };
    });
    if (columns.length > STORAGE_SNAPSHOT_LIMITS.columns || columns.some(column => column.hidden !== 0)) refuseStorage("unsupported_schema");
    if (!columns.length || columns.some(column => typeof column.name !== "string" || String(column.name).startsWith("__keryx_scan_"))) refuseStorage("unsupported_schema");
    const names = columns.map(column => String(column.name));
    const rowid = typeof object.sql === "string" && !/\bWITHOUT\s+ROWID\b/i.test(object.sql)
      ? ["_rowid_", "rowid", "oid"].find(name => !names.some(column => column.toLowerCase() === name)) : undefined;
    if (rowid) names.unshift(rowid);
    const projections = names.flatMap((name, index) => [
      `typeof(${quote(name)}) AS ${quote(`__keryx_scan_type_${index}`)}`,
      `length(CAST(${quote(name)} AS BLOB)) AS ${quote(`__keryx_scan_length_${index}`)}`,
      `CASE WHEN length(CAST(${quote(name)} AS BLOB))<=${STORAGE_SNAPSHOT_LIMITS.fieldBytes} THEN CASE WHEN typeof(${quote(name)})='text' THEN CAST(${quote(name)} AS BLOB) ELSE ${quote(name)} END ELSE NULL END AS ${quote(`__keryx_scan_value_${index}`)}`,
    ]);
    const statement = db.prepare(`SELECT ${projections.join(",")} FROM ${quote(table)} LIMIT ?`);
    statement.setReadBigInts(true);
    const rows: string[] = [];
    let count = 0;
    for (const row of statement.iterate(STORAGE_SNAPSHOT_LIMITS.rows + 1)) {
      check(); if (++rowCount > STORAGE_SNAPSHOT_LIMITS.rows) refuseStorage("row_limit"); count++;
      const fields: string[] = [], values: Record<string, unknown> = {};
      for (let index = 0; index < names.length; index++) {
        const length = row[`__keryx_scan_length_${index}`];
        if (typeof length === "bigint") {
          if (length > BigInt(STORAGE_SNAPSHOT_LIMITS.fieldBytes)) refuseStorage("field_limit");
          totalBytes += Number(length); if (totalBytes > STORAGE_SNAPSHOT_LIMITS.totalBytes) refuseStorage("byte_limit");
        }
        const type = String(row[`__keryx_scan_type_${index}`]);
        const rawValue = row[`__keryx_scan_value_${index}`];
        const value = type === "text" ? decodeText(rawValue) : rawValue;
        fields.push(encodeStorageValue(value, type)); values[names[index]] = value;
      }
      const encodedRow = JSON.stringify(fields);
      encodedBytes += Buffer.byteLength(encodedRow);
      if (encodedBytes > STORAGE_SNAPSHOT_LIMITS.encodedBytes) refuseStorage("encoded_byte_limit");
      rows.push(encodedRow);
      // Known foreign/malformed payment authority is never waived by an owner attestation.
      if (table === "payment_events") {
        if (values.network !== null && values.network !== "eip155:5042002") refuseStorage("foreign_authority");
        if (!names.includes("settlement_status") || !["simulated", "pending", "settled", "failed"].includes(String(values.settlement_status)) ||
            ![BigInt(0), BigInt(1)].includes(values.settled as bigint) ||
            typeof values.amount_usdc !== "number" && typeof values.amount_usdc !== "bigint") refuseStorage("malformed_authority");
        const amount = Number(values.amount_usdc);
        if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 1e6)) || Math.abs(amount * 1e6 - Math.round(amount * 1e6)) > 0.000001) refuseStorage("malformed_authority");
        if (values.settlement_status !== "simulated" || values.settled !== BigInt(0) || values.authorization_id != null || values.grant_epoch != null) enrollmentRefusal = "unresolved_funded_or_authority_provenance";
        else unknown.add("historical_simulated_payment_origin");
      }
      if (table === "browser_authorization_intents") {
        if (values.network !== "eip155:5042002" || values.token !== "0x3600000000000000000000000000000000000000" ||
            typeof values.gateway_contract !== "string" || values.gateway_contract.toLowerCase() !== "0x0077777d7eba4688bdef3e311b846f25870a19b9") refuseStorage("foreign_authority");
      }
      if (table === "browser_journal_control" && (values.id !== BigInt(1) || ![BigInt(0), BigInt(1)].includes(values.active as bigint))) refuseStorage("malformed_authority");
      if (table === "browser_journal_writer") enrollmentRefusal = "unresolved_funded_or_authority_provenance";
      if (table === "browser_signing_v2_control" || table === "browser_signing_v2_barrier") {
        const state = table === "browser_signing_v2_control" ? "active" : "ever_active";
        const expectedColumns = ["id", state, "min_original_version"].sort().join(",");
        if (columns.map(column => column.name).sort().join(",") !== expectedColumns ||
            values.id !== BigInt(1) || values[state] !== BigInt(0) || values.min_original_version !== BigInt(2))
          enrollmentRefusal = "unresolved_funded_or_authority_provenance";
      }
    }
    tableCounts[table] = count;
    if (count && funded.has(table)) enrollmentRefusal = "unresolved_funded_or_authority_provenance";
    if (["browser_signing_v2_control", "browser_signing_v2_barrier"].includes(table) && count !== 1)
      enrollmentRefusal = "unresolved_funded_or_authority_provenance";
    if (table !== "sqlite_sequence" && !STORAGE_APPLICATION_TABLES.includes(table)) enrollmentRefusal = "unsupported_table";
    if (count && !funded.has(table) && !["payment_events", "browser_journal_control", "browser_signing_v2_control", "browser_signing_v2_barrier", "sqlite_sequence"].includes(table)) unknown.add(`legacy_metadata:${table}`);
    frame(table); frame(JSON.stringify(names));
    for (const row of rows.sort()) frame(row);
  }
  return { schemaDigest, snapshotDigest: hash.digest("hex"), rowCount, tableCounts, unknownClasses: [...unknown].sort(), enrollmentRefusal };
}

import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProvenanceLimits, StorageProvenanceReport } from "./storage-provenance";

// Independent public testnet observations; they are never a runtime profile or an origin proof.
const NETWORK = "eip155:5042002";
const USDC = "0x3600000000000000000000000000000000000000";
const WALLET = "0x0077777d7eba4688bdef3e311b846f25870a19b9";
const MINTER = "0x0022222abe238cc2c7bb1f21003f0a260052475b";
const TABLES = {
  payment_events: ["id", "payer", "payee", "network", "settled", "settlement_status", "amount_usdc", "authorization_id", "grant_epoch", "authorization_phase"],
  browser_authorization_intents: ["network", "token", "gateway_contract", "nonce", "grant_epoch", "amount_micro_usdc"],
  session_grants: ["session_id", "owner_addr", "sess_addr", "grant_epoch", "cap", "spent"],
  browser_signer_capacity: ["signer", "spent_micro"],
  browser_retained_grants: ["signer", "grant_epoch", "spent_micro"],
  browser_journal_bindings: ["nonce", "requirements"],
  browser_journal_control: ["id", "active"],
  withdrawals: ["network", "amount_usdc"],
  creator_withdrawal_requests: ["data"],
  private_research_intents: ["data"],
  private_creator_submissions: ["data"],
  private_research_payment_attempts: ["confirmation"],
  a2a_orders: ["request_data"],
  auth_challenges: ["hash"],
  web_sessions: ["hash"],
} as const;
type Row = Record<string, unknown>;
const JSON_FIELDS = new Set(["requirements", "data", "request_data", "confirmation"]);
const SAFE_REASONS = new Set(["absolute_target_required", "unsafe_target", "target_replaced", "file_limit", "schema_limit", "schema_refused",
  "row_limit", "field_limit", "byte_limit", "deadline_exceeded", "foreign_authority", "malformed_authority"]);
function refuse(reason: string): never { throw new Error(reason); }
function targetIdentity(target: string, maximum: number) {
  if (!isAbsolute(target) || target !== resolve(target) || target.includes("\0")) refuse("absolute_target_required");
  const root = parse(target).root;
  let current = root;
  for (const part of relative(root, target).split(sep)) {
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink()) refuse("unsafe_target");
  }
  const stat = lstatSync(target, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform === "win32" ? realpathSync(target).toLowerCase() !== target.toLowerCase() : realpathSync(target) !== target)) refuse("unsafe_target");
  if (stat.size < BigInt(1) || stat.size > BigInt(maximum)) refuse("file_limit");
  return { dev: stat.dev.toString(), ino: stat.ino.toString(), birth: stat.birthtimeNs.toString() };
}
const lower = (value: unknown) => typeof value === "string" ? value.toLowerCase() : "";
function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("malformed_authority");
  return value as Row;
}
function boundedMicros(value: unknown, decimal = false) {
  if (typeof value === "number") {
    const micros = decimal ? Math.round(value * 1e6) : value;
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(micros) || (decimal && Math.abs(value * 1e6 - micros) > 0.000001)) refuse("malformed_authority");
    return;
  }
  if (!decimal && typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < (BigInt(1) << BigInt(256))) return;
  refuse("malformed_authority");
}

/** Never traverse arbitrary private content. Only supported authority envelope paths. */
function inspectEnvelope(value: unknown, count: (name: string) => void, depth = 0): Row {
  if (depth > 8) refuse("malformed_authority");
  const row = object(value);
  const projection: Row = {};
  if ("scheme" in row && row.scheme !== "exact") refuse("malformed_authority");
  for (const [name, expected] of [["network", NETWORK], ["asset", USDC], ["token", USDC], ["gatewayWallet", WALLET],
    ["gatewayMinter", MINTER], ["gateway_contract", WALLET], ["gatewayContract", WALLET], ["verifyingContract", WALLET]] as const) {
    if (!(name in row)) continue;
    if (typeof row[name] !== "string" || !row[name]) refuse("malformed_authority");
    if (lower(row[name]) !== expected.toLowerCase()) refuse("foreign_authority");
    projection[name] = lower(row[name]); count("testnet_field_match_not_origin_proof");
  }
  if ("chainId" in row) { if (row.chainId !== 5042002) refuse(typeof row.chainId === "number" ? "foreign_authority" : "malformed_authority"); projection.chainId = 5042002; }
  for (const name of ["amount", "amountMicros", "value", "amount_micro_usdc"]) {
    if (name in row) { boundedMicros(row[name]); projection[name] = row[name]; }
  }
  for (const name of ["requirement", "requirements", "extra", "domain", "submission", "confirmation", "policy", "request", "payment", "authorization", "burnIntent", "spec"]) {
    if (!(name in row)) continue;
    if (name === "domain" && typeof row[name] === "number") {
      if (row[name] !== 26) refuse("foreign_authority"); projection[name] = 26;
    } else projection[name] = inspectEnvelope(row[name], count, depth + 1);
  }
  if ("accepts" in row) {
    if (!Array.isArray(row.accepts) || row.accepts.length > 8) refuse("malformed_authority");
    projection.accepts = row.accepts.map(value => inspectEnvelope(value, count, depth + 1));
  }
  for (const name of ["sourceDomain", "destinationDomain"]) {
    if (!(name in row)) continue;
    if (row[name] !== 26) refuse(typeof row[name] === "number" ? "foreign_authority" : "malformed_authority");
    projection[name] = 26;
  }
  for (const [name, expected] of [["sourceContract", WALLET], ["destinationContract", MINTER], ["sourceToken", USDC], ["destinationToken", USDC]] as const) {
    if (!(name in row)) continue;
    if (typeof row[name] !== "string" || !/^0x0{24}[a-fA-F0-9]{40}$/.test(row[name] as string)) refuse("malformed_authority");
    if (lower(row[name]).slice(26) !== expected.slice(2)) refuse("foreign_authority");
    projection[name] = lower(row[name]);
  }
  if (!Object.keys(projection).length) count("serialized_origin_unavailable");
  return projection;
}

/** Internal cooperative scanner. Call inspectStorageProvenance for the independent deadline. */
export function scanStorageProvenance(target: string, limits: ProvenanceLimits): StorageProvenanceReport {
  const report: StorageProvenanceReport = { format: "keryx-storage-provenance-intake-v1", backend: "sqlite", status: "intake_only",
    origin: "unknown_legacy", enrollmentAuthorized: false, modeIdentityAccepted: false, snapshotComplete: false };
  let db: DatabaseSync | undefined;
  let descriptor: number | undefined;
  const start = Date.now();
  const checkTime = () => { if (Date.now() - start > limits.deadlineMs) refuse("deadline_exceeded"); };
  try {
    const identity = targetIdentity(target, limits.fileBytes);
    descriptor = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev.toString() !== identity.dev || opened.ino.toString() !== identity.ino || opened.birthtimeNs.toString() !== identity.birth) refuse("target_replaced");
    const sidecars = { walBefore: existsSync(`${target}-wal`), shmBefore: existsSync(`${target}-shm`), walAfter: false, shmAfter: false };
    // SQLite may read/create WAL shared-memory coordination files; never open the main store writable.
    db = new DatabaseSync(target, { readOnly: true, allowExtension: false });
    if (JSON.stringify(identity) !== JSON.stringify(targetIdentity(target, limits.fileBytes))) refuse("target_replaced");
    db.exec("BEGIN;");
    const schemaHash = createHash("sha256"), authorityHash = createHash("sha256");
    const classifications: Record<string, number> = { unknown_legacy_origin: 1 };
    const count = (name: string) => { classifications[name] = (classifications[name] ?? 0) + 1; };
    const tables: Record<string, { rows: number; missingSelectedColumns: number }> = {};
    const schema = [];
    for (const row of db.prepare("SELECT type, CASE WHEN length(CAST(name AS BLOB))<=256 THEN name END name, CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql END sql FROM sqlite_schema LIMIT ?").iterate(limits.schemaObjects + 1)) {
      checkTime(); if (schema.length >= limits.schemaObjects) refuse("schema_limit");
      if (typeof row.name !== "string" || (row.sql === null && !row.name.startsWith("sqlite_autoindex"))) refuse("schema_refused");
      schema.push(row); schemaHash.update(JSON.stringify(row));
    }
    let scannedRows = 0, selectedBytes = 0, uninspectedTables = 0;
    let activation: "absent" | "inactive" | "active" | "malformed" = "absent";
    for (const entry of schema) {
      checkTime();
      if (!Object.hasOwn(TABLES, entry.name as string)) { if (entry.type === "table") uninspectedTables++; continue; }
      if (entry.type !== "table" || /VIRTUAL\s+TABLE/i.test(String(entry.sql))) refuse("schema_refused");
      const table = entry.name as keyof typeof TABLES;
      const columns: Row[] = [];
      for (const column of db.prepare(`PRAGMA table_xinfo("${table}")`).iterate()) {
        checkTime(); if (columns.length >= limits.columns) refuse("schema_limit"); columns.push(column);
      }
      if (columns.some(column => column.hidden !== 0)) refuse("schema_refused");
      const available = new Set(columns.map(column => String(column.name)));
      const chosen = TABLES[table].filter(name => available.has(name));
      const summary = tables[table] = { rows: 0, missingSelectedColumns: TABLES[table].length - chosen.length };
      if (summary.missingSelectedColumns) count("legacy_columns_missing");
      if (!chosen.length) { count("authority_schema_unavailable"); continue; }
      const selections = chosen.flatMap(name => [`length(CAST("${name}" AS BLOB)) AS "length_${name}"`,
        `CASE WHEN length(CAST("${name}" AS BLOB))<=${limits.fieldBytes} THEN "${name}" END AS "${name}"`]);
      for (const row of db.prepare(`SELECT ${selections.join(",")} FROM "${table}" ORDER BY rowid LIMIT ?`).iterate(limits.rows + 1)) {
        checkTime(); if (++scannedRows > limits.rows) refuse("row_limit"); summary.rows++;
        const projection: Row = {};
        for (const name of chosen) {
          const length = row[`length_${name}`];
          if (typeof length === "number") { if (length > limits.fieldBytes) refuse("field_limit"); selectedBytes += length; }
          if (selectedBytes > limits.selectedBytes) refuse("byte_limit");
          const value = row[name];
          if (value === null) { count("legacy_value_unavailable"); continue; }
          if (JSON_FIELDS.has(name)) {
            if (typeof value !== "string") refuse("malformed_authority");
            let parsed: unknown; try { parsed = JSON.parse(value); } catch { refuse("malformed_authority"); }
            if (name === "requirements") {
              const requirements = object(parsed), extra = object(requirements.extra);
              if (!requirements.network || !requirements.asset || requirements.scheme !== "exact" || !requirements.amount ||
                !/^0x[a-fA-F0-9]{40}$/.test(String(requirements.payTo)) || extra.name !== "GatewayWalletBatched" ||
                extra.version !== "1" || !extra.verifyingContract) refuse("malformed_authority");
            }
            projection[name] = inspectEnvelope(parsed, count);
          } else if (["network", "token", "gateway_contract"].includes(name)) {
            projection[name] = inspectEnvelope({ [name]: value }, count)[name];
          } else if (["cap", "spent", "amount_usdc", "spent_micro", "amount_micro_usdc"].includes(name)) {
            boundedMicros(value, ["cap", "spent", "amount_usdc"].includes(name)); projection[name] = value;
          } else if (name === "active" && table === "browser_journal_control") {
            if (row.id !== 1) refuse("malformed_authority");
            if (value !== 0 && value !== 1) { activation = "malformed"; refuse("malformed_authority"); }
            activation = value === 1 ? "active" : "inactive"; projection.active = value;
          } else if (name === "settlement_status" || name === "authorization_phase") {
            const allowed = name === "settlement_status" ? ["simulated", "pending", "settled", "failed"] : ["prepared", "exposed", "signed", "submission_attempted", "settled", "failed", "cancelled_unexposed"];
            if (typeof value !== "string" || !allowed.includes(value)) refuse("malformed_authority");
            count(value === "pending" ? "pending_retained" : `state_${value}`); projection[name] = value;
          } else {
            if (["nonce", "authorization_id"].includes(name) && (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value))) refuse("malformed_authority");
            if (["sess_addr", "signer", "payer", "payee", "owner_addr"].includes(name) && (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value))) refuse("malformed_authority");
            if (name === "settled" && value !== 0 && value !== 1) refuse("malformed_authority");
            // Hash bounded identifiers to retain change sensitivity; never return addresses/nonces/epochs/auth hashes.
            projection[name] = createHash("sha256").update(String(value)).digest("hex");
          }
        }
        if (table === "session_grants" && typeof row.cap === "number" && typeof row.spent === "number" && row.spent > row.cap) refuse("malformed_authority");
        authorityHash.update(JSON.stringify([table, projection]));
        if (["session_grants", "auth_challenges", "web_sessions", "a2a_orders"].includes(table)) count("row_origin_unavailable");
      }
      if (table === "browser_journal_control" && summary.rows !== 1) refuse("malformed_authority");
    }
    if (JSON.stringify(identity) !== JSON.stringify(targetIdentity(target, limits.fileBytes))) refuse("target_replaced");
    db.exec("ROLLBACK"); db.close(); db = undefined;
    sidecars.walAfter = existsSync(`${target}-wal`); sidecars.shmAfter = existsSync(`${target}-shm`);
    report.snapshotComplete = true;
    report.evidence = { schemaSha256: schemaHash.digest("hex"), selectedAuthoritySha256: authorityHash.digest("hex"),
      scannedRows, selectedBytes, uninspectedTables, tables, classifications, journalActivation: activation, sidecars };
    return report;
  } catch (error) {
    report.status = "refused";
    report.reason = error instanceof Error && SAFE_REASONS.has(error.message) ? error.message : "inspection_unavailable";
    return report;
  } finally { if (db) { try { db.exec("ROLLBACK"); } catch {} try { db.close(); } catch {} } if (descriptor !== undefined) { try { closeSync(descriptor); } catch {} } }
}

/** DATA inspection only. Raw batches are private and provisional until completion.
 * No target connection, SQL applier, receipt issuer, enrollment or application
 * authority. Protected, offline parent directories remain the operator boundary:
 * Node SQLite reopens the checked pathname rather than the held descriptor.
 * Large/private intake additionally needs external <=512MiB native process and
 * deadline containment; these data bounds are not a claim of OS enforcement. */
import { createHash } from "node:crypto";
import { type BigIntStats, closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../../lib/canonical-json";
import { storageIdentityDigest } from "../../lib/db/storage-identity";
import { readStorageIdentity } from "../../lib/db/storage-identity-sqlite";
import { checkSnapshotSidecars, configureSnapshotConnection, validateSnapshotHeader } from "../../lib/db/storage-provenance-snapshot";
import { OFFLINE_SNAPSHOT_LIMITS } from "../../lib/db/storage-provenance";
import { nativeMaterializationProfile, type NativeMaterializationProfileMode } from "../../lib/db/postgres/runtime-profile";
import { snapshotRows, snapshotRowWire, snapshotTables, type SnapshotRow, type SnapshotTable, type SnapshotValue } from "./typed-snapshot.mts";

const MiB = 1048576, digest = /^[a-f0-9]{64}$/;
export type TypedDeltaLimits = { snapshotBytes: number; inputRows: number; changes: number; deltaBytes: number; batchRows: number; batchBytes: number; keyBytes: number; elapsedMs: number };
export const TYPED_SNAPSHOT_DELTA_LIMITS = Object.freeze<TypedDeltaLimits>({ snapshotBytes: 512 * MiB, inputRows: 2000000,
  changes: 100000, deltaBytes: 64 * MiB, batchRows: 64, batchBytes: 24 * MiB, keyBytes: MiB, elapsedMs: 300000 });
type Limits = Readonly<TypedDeltaLimits>;
export type TypedDeltaSnapshot = Readonly<{ path: string; sha256: string }>;
export type TypedDeltaPriorMetadata = Readonly<{ format: "keryx-native-held-data-baseline-metadata-v1";
  profileMode: NativeMaterializationProfileMode; catalogSha256: string; targetState: "held"; sequence: number;
  snapshotSha256: string; schemaSha256: string; identityDigest: string; dataDigest: string }>;
export type TypedDeltaRequest = Readonly<{ before: TypedDeltaSnapshot; after: TypedDeltaSnapshot;
  priorTarget: Readonly<{ wire: string; expectedSha256: string }>; limits?: Partial<Limits> }>;
export type TypedDeltaChange = Readonly<{ table: string; operation: "insert" | "update" | "delete"; key: SnapshotRow;
  before: SnapshotRow | null; after: SnapshotRow | null; beforeSha256: string | null; afterSha256: string | null }>;
export type TypedDeltaBatch = Readonly<{ format: "keryx-typed-snapshot-delta-batch-v1"; index: number;
  provisional: true; changes: readonly TypedDeltaChange[] }>;
export class TypedSnapshotDeltaRefused extends Error {
  constructor(readonly code: string) { super("Typed snapshot delta refused: " + code); }
}
function refuse(code: string): never { throw new TypedSnapshotDeltaRefused(code); }
function sha(wire: string | Buffer) { return createHash("sha256").update(wire).digest("hex"); }
function exact(input: unknown, keys: string) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype
    || Object.getOwnPropertySymbols(input).length || Object.keys(input).sort().join(",") !== keys
    || Object.values(Object.getOwnPropertyDescriptors(input)).some(d => !d.enumerable || !("value" in d))) refuse("invalid_request");
  return input as Record<string, unknown>;
}
function limits(input: unknown): Limits {
  if (input === undefined) return TYPED_SNAPSHOT_DELTA_LIMITS;
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype
    || Object.getOwnPropertySymbols(input).length || Object.values(Object.getOwnPropertyDescriptors(input)).some(d => !d.enumerable || !("value" in d))) refuse("invalid_limits");
  const result = { ...TYPED_SNAPSHOT_DELTA_LIMITS };
  for (const [name, value] of Object.entries(input)) {
    if (!Object.hasOwn(result, name) || typeof value !== "number" || !Number.isSafeInteger(value) || value < 1
      || value > result[name as keyof Limits]) refuse("invalid_limits");
    result[name as keyof Limits] = value;
  }
  return Object.freeze(result);
}
function descriptor(input: unknown): TypedDeltaSnapshot {
  const value = exact(input, "path,sha256");
  if (typeof value.path !== "string" || value.path.length > 2048 || !isAbsolute(value.path) || resolve(value.path) !== value.path
    || value.path.includes("\0") || typeof value.sha256 !== "string" || !digest.test(value.sha256)) refuse("invalid_snapshot");
  return Object.freeze({ path: value.path, sha256: value.sha256 });
}
function quote(name: string) {
  if (!name || name.length > 256 || name.includes("\0")) refuse("unsupported_metadata");
  return '"' + name.replaceAll('"', '""') + '"';
}
function token(stat: BigIntStats) { return [stat.dev, stat.ino, stat.nlink, stat.size, stat.mode, stat.mtimeNs, stat.ctimeNs].join(":"); }
function pathStat(path: string) {
  let part = parse(path).root;
  for (const leaf of relative(part, path).split(sep)) { part = resolve(part, leaf); if (lstatSync(part).isSymbolicLink()) refuse("unsafe_path"); }
  const real = realpathSync(path); if (process.platform === "win32" ? real.toLowerCase() !== path.toLowerCase() : real !== path) refuse("unsafe_path");
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile() || stat.nlink !== BigInt(1) || stat.size < BigInt(100)) refuse("unsafe_path");
  if (process.platform !== "win32" && (stat.uid !== BigInt(process.getuid!()) || (stat.mode & BigInt(0o077)) !== BigInt(0))) refuse("unsafe_path");
  return stat;
}
type Held = ReturnType<typeof hold>;
function hold(value: TypedDeltaSnapshot, cap: Limits, check: () => void) {
  const initial = pathStat(value.path); if (initial.size > BigInt(cap.snapshotBytes)) refuse("snapshot_bound");
  checkSnapshotSidecars(value.path);
  const fd = openSync(value.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  const verify = () => { check(); checkSnapshotSidecars(value.path);
    if (token(fstatSync(fd, { bigint: true })) !== token(initial) || token(pathStat(value.path)) !== token(initial)) refuse("snapshot_changed"); };
  const hash = () => { verify(); const h = createHash("sha256"), buffer = Buffer.alloc(MiB); let offset = 0;
    for (;;) { const n = readSync(fd, buffer, 0, buffer.length, offset); if (!n) break; h.update(buffer.subarray(0, n)); offset += n; check(); }
    verify(); if (h.digest("hex") !== value.sha256) refuse("snapshot_hash"); };
  let db: DatabaseSync | undefined;
  try {
    verify(); validateSnapshotHeader(fd); hash();
    db = new DatabaseSync(value.path, { readOnly: true, allowExtension: false, timeout: 1000 });
    configureSnapshotConnection(db, OFFLINE_SNAPSHOT_LIMITS); db.exec("BEGIN");
    if (db.prepare("PRAGMA encoding").get()?.encoding !== "UTF-8") refuse("unsupported_encoding");
    const identity = readStorageIdentity(db);
    return { value, db, identity, identityDigest: storageIdentityDigest(identity), verify, hash,
      close() { try { if (db?.isTransaction) db.exec("ROLLBACK"); } finally { try { db?.close(); } finally { closeSync(fd); } } } };
  } catch (error) { try { db?.close(); } finally { closeSync(fd); } throw error; }
}
function schema(db: DatabaseSync) {
  const bound = db.prepare("SELECT count(*) n,coalesce(sum(length(CAST(sql AS BLOB))),0) bytes FROM sqlite_schema").get()!;
  if (typeof bound.n !== "number" || bound.n > 1024 || typeof bound.bytes !== "number" || bound.bytes > 4 * MiB) refuse("schema_bound");
  const rows = db.prepare("SELECT lower(hex(CAST(type AS BLOB))) type,lower(hex(CAST(name AS BLOB))) name,lower(hex(CAST(tbl_name AS BLOB))) parent,CASE WHEN sql IS NULL THEN NULL ELSE lower(hex(CAST(sql AS BLOB))) END sql FROM sqlite_schema ORDER BY type,name COLLATE BINARY").all();
  const wire = JSON.stringify(rows); if (Buffer.byteLength(wire) > 9 * MiB) refuse("schema_bound"); return sha(wire);
}
type Plan = { table: SnapshotTable; keys: string[]; positions: number[]; integerAlias: boolean; rows: number };
function plans(held: Held, cap: Limits, check: () => void) {
  const result: Plan[] = []; let count = 0;
  for (const table of snapshotTables(held.db)) {
    check(); const name = quote(table.name);
    const raw = held.db.prepare("SELECT lower(hex(CAST(name AS BLOB))) name,lower(hex(CAST(sql AS BLOB))) sql FROM sqlite_schema WHERE type='table' AND name=?").get(table.name);
    if (!raw || raw.name !== Buffer.from(table.name).toString("hex") || raw.sql !== Buffer.from(table.sql).toString("hex")) refuse("unsupported_metadata");
    const columns = held.db.prepare(`PRAGMA table_xinfo(${name})`).all();
    const keys = columns.filter(c => typeof c.pk === "number" && c.pk > 0).sort((a, b) => Number(a.pk) - Number(b.pk));
    const rawBytes = table.columns.map(c => `CASE WHEN typeof(${quote(c)}) IN ('text','blob') THEN length(CAST(${quote(c)} AS BLOB)) ELSE 0 END`).join("+");
    const size = held.db.prepare(`SELECT count(*) n,coalesce(max(${rawBytes}),0) bytes FROM ${name}`).get()!;
    if (typeof size.n !== "number" || !Number.isSafeInteger(size.n) || typeof size.bytes !== "number") refuse("row_encoding");
    count += size.n; if (count > cap.inputRows) refuse("input_rows_bound"); if (size.bytes > 4 * MiB) refuse("row_bound");
    if (size.n && !keys.length) refuse("unsupported_primary_key");
    const indexes = held.db.prepare(`PRAGMA index_list(${name})`).all().filter(i => i.origin === "pk");
    const integerAlias = keys.length === 1 && String(keys[0].type).toUpperCase() === "INTEGER" && indexes.length === 0;
    if (keys.length && !integerAlias) {
      if (indexes.length !== 1 || indexes[0].unique !== 1 || indexes[0].partial !== 0 || typeof indexes[0].name !== "string") refuse("unsupported_primary_key");
      const parts = held.db.prepare(`PRAGMA index_xinfo(${quote(indexes[0].name)})`).all().filter(i => i.key === 1);
      if (parts.length !== keys.length || parts.some((part, i) => part.name !== keys[i].name || part.cid !== keys[i].cid
        || part.coll !== "BINARY" || part.desc !== 0)) refuse("unsupported_primary_key");
    }
    if (size.n && held.db.prepare(`SELECT 1 FROM ${name} WHERE ${keys.map(c => `${quote(String(c.name))} IS NULL OR typeof(${quote(String(c.name))}) NOT IN (${integerAlias ? "'integer'" : "'integer','text','blob'"})`).join(" OR ")} LIMIT 1`).get()) refuse("unsupported_key_cell");
    const keyNames = keys.map(c => String(c.name));
    result.push({ table, keys: keyNames, positions: keyNames.map(k => table.columns.indexOf(k)), integerAlias, rows: size.n });
  }
  return { tables: result, rows: count };
}
function frozen(row: SnapshotRow): SnapshotRow { return Object.freeze(row.map(cell => Object.freeze([...cell]) as SnapshotValue)); }
function primary(row: SnapshotRow, plan: Plan, cap: Limits) {
  const key = Object.freeze(plan.positions.map(i => row[i]));
  if (Buffer.byteLength(snapshotRowWire(key)) > cap.keyBytes) refuse("key_bound"); return key;
}
function compare(a: SnapshotRow, b: SnapshotRow) {
  if (a.length !== b.length) refuse("unsupported_primary_key"); const rank = { integer: 0, text: 1, blob: 2 };
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i]; if (x[0] === "null" || x[0] === "real" || y[0] === "null" || y[0] === "real") refuse("unsupported_key_cell");
    if (x[0] !== y[0]) return rank[x[0]] < rank[y[0]] ? -1 : 1;
    if (x[0] === "integer") { const first = BigInt(x[1]), second = BigInt(y[1]); if (first !== second) return first < second ? -1 : 1; }
    else { const order = Buffer.compare(Buffer.from(x[1], "hex"), Buffer.from(y[1], "hex")); if (order) return order; }
  } return 0;
}
function feedHeader(hash: ReturnType<typeof createHash>, plan: Plan) { hash.update(JSON.stringify({ table: plan.table.name, columns: plan.table.columns, keys: plan.keys })).update("\n"); }
function* rows(held: Held, plan: Plan, cap: Limits, check: () => void) {
  if (!plan.rows) return; let previous: SnapshotRow | undefined, count = 0;
  for (const raw of snapshotRows(held.db, plan.table, plan.keys)) {
    check(); const row = frozen(raw), key = primary(row, plan, cap);
    if (previous && compare(previous, key) >= 0) refuse("duplicate_or_unordered_key"); previous = key; count++; yield row;
  } if (count !== plan.rows) refuse("snapshot_changed");
}
function checkClock(cap: Limits) { const started = performance.now(); return () => { if (performance.now() - started > cap.elapsedMs) refuse("elapsed_bound"); }; }
export async function inspectTypedDeltaSnapshot(input: TypedDeltaSnapshot, narrowedLimits?: Partial<Limits>) {
  const source = descriptor(input), cap = limits(narrowedLimits), check = checkClock(cap); let held: Held | undefined;
  try {
    held = hold(source, cap, check); const schemaSha256 = schema(held.db), plan = plans(held, cap, check), h = createHash("sha256");
    for (const table of plan.tables) { feedHeader(h, table); for (const row of rows(held, table, cap, check)) h.update(snapshotRowWire(row)).update("\n"); }
    held.hash(); return Object.freeze({ format: "keryx-typed-snapshot-data-inventory-v1", snapshotSha256: source.sha256,
      schemaSha256, identityDigest: held.identityDigest, dataDigest: h.digest("hex"), tables: plan.tables.length, rows: plan.rows,
      targetVerified: false, applicationAuthority: false, nativeFactoryQualified: false });
  } catch (error) { if (error instanceof TypedSnapshotDeltaRefused) throw error; refuse("input_unavailable"); }
  finally { held?.close(); }
}
function capture(input: TypedDeltaRequest) {
  const r = exact(input, input && Object.hasOwn(input, "limits") ? "after,before,limits,priorTarget" : "after,before,priorTarget");
  const prior = exact(r.priorTarget, "expectedSha256,wire");
  if (typeof prior.wire !== "string" || Buffer.byteLength(prior.wire) > 4096 || typeof prior.expectedSha256 !== "string"
    || !digest.test(prior.expectedSha256) || sha(prior.wire) !== prior.expectedSha256) refuse("prior_receipt_hash");
  let p: Record<string, unknown>; try { p = exact(JSON.parse(prior.wire), "catalogSha256,dataDigest,format,identityDigest,profileMode,schemaSha256,sequence,snapshotSha256,targetState"); } catch { refuse("prior_receipt"); }
  if (p.format !== "keryx-native-held-data-baseline-metadata-v1" || p.targetState !== "held" || canonicalJson(p) !== prior.wire
    || typeof p.sequence !== "number" || !Number.isSafeInteger(p.sequence) || p.sequence < 0
    || [p.dataDigest, p.identityDigest, p.schemaSha256, p.snapshotSha256].some(v => typeof v !== "string" || !digest.test(v))) refuse("prior_receipt");
  let profile; try { profile = nativeMaterializationProfile(p.profileMode as NativeMaterializationProfileMode); } catch { refuse("prior_profile"); }
  if (p.catalogSha256 !== profile.catalogSha256) refuse("prior_profile");
  return Object.freeze({ before: descriptor(r.before), after: descriptor(r.after), prior: Object.freeze(p as unknown as TypedDeltaPriorMetadata), priorSha256: prior.expectedSha256, cap: limits(r.limits) });
}
/** No raw batch is a completed/accepted delta. Early return, late bound, drift or
 * stale receipt produces NO completion summary; discard all provisional batches. */
export function streamTypedSnapshotDelta(input: TypedDeltaRequest) {
  const request = capture(input); // Capture before the generator's first next/await.
  return stream(request);
}
async function* stream(r: ReturnType<typeof capture>) {
  const check = checkClock(r.cap); let old: Held | undefined, next: Held | undefined;
  try {
    old = hold(r.before, r.cap, check); next = hold(r.after, r.cap, check);
    const oldSchema = schema(old.db), newSchema = schema(next.db);
    if (oldSchema !== newSchema) refuse("schema_changed");
    if (canonicalJson(old.identity) !== canonicalJson(next.identity)) refuse("identity_changed");
    if (r.prior.snapshotSha256 !== r.before.sha256 || r.prior.schemaSha256 !== oldSchema || r.prior.identityDigest !== old.identityDigest) refuse("prior_baseline");
    const left = plans(old, r.cap, check), right = plans(next, r.cap, check);
    if (left.rows + right.rows > r.cap.inputRows) refuse("input_rows_bound");
    if (canonicalJson(left.tables.map(t => ({ table: t.table, keys: t.keys }))) !== canonicalJson(right.tables.map(t => ({ table: t.table, keys: t.keys })))) refuse("schema_changed");
    const beforeHash = createHash("sha256"), afterHash = createHash("sha256"), deltaHash = createHash("sha256");
    let batch: TypedDeltaChange[] = [], dataBytes = 0, batchIndex = 0, deltaBytes = 0, changes = 0, inserts = 0, updates = 0, deletes = 0, scanned = 0;
    const pack = (): TypedDeltaBatch => Object.freeze({ format: "keryx-typed-snapshot-delta-batch-v1", index: batchIndex,
      provisional: true, changes: Object.freeze(batch) });
    const batchBytes = (n: number, bytes: number) => Buffer.byteLength(JSON.stringify({ format: "keryx-typed-snapshot-delta-batch-v1", index: batchIndex, provisional: true, changes: [] })) + 1 + bytes + Math.max(0, n - 1);
    const seal = () => { const value = pack(), wire = JSON.stringify(value), bytes = Buffer.byteLength(wire) + 1;
      if (bytes > r.cap.batchBytes || deltaBytes + bytes > r.cap.deltaBytes) refuse("delta_bytes_bound");
      deltaHash.update(wire).update("\n"); deltaBytes += bytes; batchIndex++; batch = []; dataBytes = 0; return value; };
    for (let i = 0; i < left.tables.length; i++) {
      const a = left.tables[i], b = right.tables[i]; feedHeader(beforeHash, a); feedHeader(afterHash, b);
      const first = rows(old, a, r.cap, check), second = rows(next, b, r.cap, check);
      let x = first.next(), y = second.next();
      const consumeOld = () => { if (!x.done) beforeHash.update(snapshotRowWire(x.value)).update("\n"); x = first.next(); };
      const consumeNew = () => { if (!y.done) afterHash.update(snapshotRowWire(y.value)).update("\n"); y = second.next(); };
      try {
        while (!x.done || !y.done) {
          check(); if (scanned++ % 64 === 0) { old.verify(); next.verify(); }
          const order = x.done ? 1 : y.done ? -1 : compare(primary(x.value, a, r.cap), primary(y.value, b, r.cap));
          const before = order <= 0 && !x.done ? x.value : null, after = order >= 0 && !y.done ? y.value : null;
          const beforeWire = before && snapshotRowWire(before), afterWire = after && snapshotRowWire(after);
          if (beforeWire !== afterWire) {
            if (++changes > r.cap.changes) refuse("changes_bound");
            const operation = before === null ? "insert" : after === null ? "delete" : "update";
            const change: TypedDeltaChange = Object.freeze({ table: a.table.name, operation, key: primary(before ?? after!, a, r.cap),
              before, after, beforeSha256: beforeWire === null ? null : sha(beforeWire), afterSha256: afterWire === null ? null : sha(afterWire) });
            const bytes = Buffer.byteLength(JSON.stringify(change));
            if (batch.length && (batch.length >= r.cap.batchRows || batchBytes(batch.length + 1, dataBytes + bytes) > r.cap.batchBytes)) {
              yield seal(); old.verify(); next.verify();
            }
            if (batchBytes(1, bytes) > r.cap.batchBytes) refuse("batch_bytes_bound");
            batch.push(change); dataBytes += bytes; if (operation === "insert") inserts++; else if (operation === "update") updates++; else deletes++;
          }
          if (order <= 0) consumeOld(); if (order >= 0) consumeNew();
        }
      } finally { first.return(undefined); second.return(undefined); }
    }
    const beforeDataDigest = beforeHash.digest("hex"), afterDataDigest = afterHash.digest("hex");
    if (beforeDataDigest !== r.prior.dataDigest) refuse("prior_data");
    old.hash(); next.hash(); if (batch.length) { yield seal(); old.verify(); next.verify(); } old.verify(); next.verify();
    return Object.freeze({ format: "keryx-typed-snapshot-delta-completion-v1", beforeSnapshotSha256: r.before.sha256,
      afterSnapshotSha256: r.after.sha256, schemaSha256: oldSchema, identityDigest: old.identityDigest,
      beforeDataDigest, afterDataDigest, priorTargetReceiptSha256: r.priorSha256, priorSequence: r.prior.sequence,
      profileMode: r.prior.profileMode, catalogSha256: r.prior.catalogSha256,
      deltaDigest: deltaHash.digest("hex"), deltaBytes, deltaByteFormat: "batch-json-plus-lf", batches: batchIndex, changes, inserts, updates, deletes,
      inputRows: left.rows + right.rows, tables: left.tables.length, targetVerified: false, applicationAuthority: false,
      nativeFactoryQualified: false, targetWrites: 0 });
  } catch (error) { if (error instanceof TypedSnapshotDeltaRefused) throw error; refuse("input_unavailable"); }
  finally { try { old?.close(); } finally { next?.close(); } }
}

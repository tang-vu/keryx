/** Finite synthetic source-learning cost trial. No production DB, network or payment. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { isAbsolute, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { QueryRun } from "../lib/types";

export interface NativeLearningReadCounts {
  nativePrepares: number;
  schemaReads: number;
  queryDataReads: number;
  projectionReads: number;
}

const digest = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
function denyOutbound() {
  let attempts = 0;
  const deny = () => { attempts++; throw new Error("Synthetic source-learning measurement denies outbound I/O"); };
  globalThis.fetch = async () => deny();
  globalThis.WebSocket = class { constructor() { deny(); } } as unknown as typeof WebSocket;
  const require = createRequire(import.meta.url);
  for (const [api, methods] of [[require("node:http"), ["request", "get"]], [require("node:https"), ["request", "get"]],
    [require("node:net"), ["connect", "createConnection"]], [require("node:tls"), ["connect"]], [require("node:dgram"), ["createSocket"]],
    [require("node:child_process"), ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]]] as const)
    for (const method of methods) api[method] = deny;
  const net = require("node:net") as typeof import("node:net");
  net.Socket.prototype.connect = deny as typeof net.Socket.prototype.connect;
  const dns = require("node:dns") as typeof import("node:dns");
  for (const api of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype])
    for (const method of Object.getOwnPropertyNames(api))
      if ((method.startsWith("resolve") || ["lookup", "lookupService", "reverse"].includes(method)) && typeof Reflect.get(api, method) === "function")
        (api as unknown as Record<string, unknown>)[method] = deny;
  syncBuiltinESMExports();
  return () => attempts;
}


const args = process.argv.slice(2);
assert(args.length === 4 && args[0] === "--fixture" && ["empty", "public300"].includes(args[1]) && args[2] === "--root");
const fixture = args[1], root = realpathSync(args[3]);
assert(isAbsolute(root) && lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
const folder = mkdtempSync(join(root, "enrolled-source-learning-")), file = join(folder, "synthetic.sqlite"), manifest = join(folder, "deployment.json");
const outbound = denyOutbound();
const { canonicalJson } = await import("../lib/canonical-json");
const { installMainnetApplicationSchema } = await import("../lib/db/mainnet-application-schema");
const { installNativeUserDomainSchema } = await import("../lib/db/native-user-domain-schema");
const { writeSqliteQueryRun } = await import("../lib/db/query-run-record");
const { insertStorageIdentity, installStorageFences } = await import("../lib/db/storage-identity-sqlite");
const { STORAGE_MAINNET_PROFILE_DIGEST, validateStorageIdentity } = await import("../lib/db/storage-identity");
const { readSourceLearning } = await import("../lib/research/source-learning-server");
const sourceId = "synthetic_learning_source", network = "eip155:5042";
const identity = validateStorageIdentity({ format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
  network, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(),
  enrollmentId: randomUUID(), enrolledAt: "2026-10-05T00:00:00.000Z", provenanceDigest: "11".repeat(32) });
const native = new DatabaseSync(file), count = fixture === "public300" ? 300 : 0;
try {
  native.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(native); installNativeUserDomainSchema(native);
  native.prepare("INSERT INTO sources(id,name,url,description,rss_url,wallet_address,fetch_price,tags,authors,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(sourceId, "Synthetic source", "https://synthetic-learning.invalid", "Synthetic measurement source", "https://synthetic-learning.invalid/rss",
      `0x${"a".repeat(40)}`, 0, "[]", "[]", "2026-11-09T00:00:00.000Z");
  for (let index = 0; index < count; index++) {
    const id = `synthetic-${String(index).padStart(3, "0")}`;
    const run: QueryRun = { id, createdAt: new Date(Date.UTC(2026, 10, 9) + index * 1000).toISOString(),
      question: "SYNTHETIC QUESTION ".repeat(1024), answer: "SYNTHETIC ANSWER ".repeat(4096),
      engine: "synthetic", budget: 0, totalSpent: 0, totalToCreators: 0, subClaims: [], citations: [], paymentMode: "offline",
      decisions: [{ sourceId, sourceName: "Synthetic source", action: "SKIP", price: 0, expectedValue: 0, confidence: 0, targets: [], rationale: "Synthetic non-paid observation" }],
      trace: [{ phase: "fetch", ts: 0, message: "SYNTHETIC TRACE ".repeat(4096) }],
      sourceLearning: { version: 1, network, sources: [{ sourceId, topics: ["general"], eligibility: "offline",
        read: false, cached: false, bought: false, cited: false, accessMicros: "0", contribution: 0 }] } };
    writeSqliteQueryRun(native, run, true);
  }
  native.prepare("UPDATE run_privacy SET visibility='public'").run();
  insertStorageIdentity(native, identity); installStorageFences(native, identity); native.exec("COMMIT");
} finally { native.close(); }
writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
process.env.KERYX_STORAGE_MANIFEST = manifest; process.env.KERYX_SQLITE_PATH = file;
process.env.KERYX_FORCE_OFFLINE = "0"; process.env.KERYX_RUN_PRIVACY_ENABLED = "true";
process.env.CONTENT_MASTER_KEY = randomBytes(32).toString("hex");
const { createReadonlyEnrolledSqliteAdapter } = await import("../lib/db/enrolled-sqlite-adapter");
const reader = await createReadonlyEnrolledSqliteAdapter();
let result;
try {
  const originalBytes = digest(readFileSync(file));
  const counts: NativeLearningReadCounts = { nativePrepares: 0, schemaReads: 0, queryDataReads: 0, projectionReads: 0 };
  const original = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function(this: DatabaseSync, sql: string) {
    counts.nativePrepares++; const fixed = sql.replace(/\s+/g, " ").trim();
    if (/FROM sqlite_(?:schema|master)\b/.test(fixed)) counts.schemaReads++;
    if (fixed.includes("q.data") || fixed.startsWith("SELECT data FROM query_runs")) counts.queryDataReads++;
    if (fixed.includes("keryx_source_learning_projection_v1")) counts.projectionReads++;
    return original.call(this, sql);
  };
  let report, wallMs: number, cpuMs: number;
  try {
    const cpu = process.cpuUsage(), start = performance.now();
    report = await readSourceLearning(reader, sourceId, network);
    wallMs = performance.now() - start; const used = process.cpuUsage(cpu); cpuMs = (used.user + used.system) / 1000;
  } finally { DatabaseSync.prototype.prepare = original; }
  assert(report); assert.equal(report.excludedObservations, count); assert.deepEqual(report.records, []);
  assert.equal(digest(readFileSync(file)), originalBytes); assert.equal(outbound(), 0);
  result = { format: "keryx-enrolled-source-learning-cost-v1", fixture, node: process.versions.node,
    sqlite: process.versions.sqlite, counts, wallMs, cpuMs, outputSha256: digest(JSON.stringify(report)),
    sourceRows: count, readonlyDatabaseBytesStable: true, outboundAttempts: 0, paymentsExecuted: 0,
    limitations: "One instrumented actual full report on a genuine readonly enrolled synthetic store. Offline observations are excluded, not independent customer evidence. Not production HTTP/load or outage-cause proof." };
} finally { reader.close(); }
const owned = relative(root, folder);
assert(owned && !owned.startsWith("..") && !isAbsolute(owned) && !lstatSync(folder).isSymbolicLink());
rmSync(folder, { recursive: true }); assert(!existsSync(folder));
console.log(JSON.stringify({ ...result, temporaryFixtureRemoved: true }));

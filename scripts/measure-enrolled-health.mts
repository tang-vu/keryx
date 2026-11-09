/** Finite, synthetic enrolled-store cost measurement. No production DB or network. */
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { KeryxDB } from "../lib/db/keryx-db";

export interface NativeReadCounts {
  nativePrepares: number;
  metricInputReads: number;
  accountReads: number;
  jobReads: number;
  syncReads: number;
  schemaReads: number;
}

const script = fileURLToPath(import.meta.url), source = resolve(fileURLToPath(new URL("../", import.meta.url)));
const digest = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const sourceHashes = Object.fromEntries([
  "scripts/measure-enrolled-health.mts", "lib/db/enrolled-sqlite-adapter.ts", "lib/db/dashboard-metric-rows.ts",
  "lib/db/sqlite-adapter.ts", "lib/db/storage-identity-connection.ts", "lib/db/sqlite-application-schema-profile.ts",
  "lib/db/health-read-rows.ts", "lib/db/public-health-snapshot.ts",
].filter(name => existsSync(join(source, name))).map(name => [name, digest(readFileSync(join(source, name), "utf8").replaceAll("\r\n", "\n"))]));

function fixtureEnvironment(): NodeJS.ProcessEnv {
  const env: Partial<NodeJS.ProcessEnv> = {};
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "COMSPEC", "PATHEXT", "HOME"])
    if (process.env[name]) env[name] = process.env[name];
  return { ...env, NODE_ENV: "test", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
    KERYX_FORCE_OFFLINE: "1", KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0",
    SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", GOOGLE_API_KEY: "", BASE_URL: "https://synthetic-health.invalid", NO_COLOR: "1" };
}

function denyOutbound() {
  let attempts = 0;
  const deny = () => { attempts++; throw new Error("Synthetic health measurement denies outbound I/O"); };
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

const arguments_ = process.argv.slice(2);
if (!arguments_.length) {
  const root = process.env.KERYX_MEASURE_ROOT;
  assert(root && isAbsolute(root) && lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), "Set an existing owned KERYX_MEASURE_ROOT under canonical .local/tmp");
  const results = [];
  for (const fixture of ["empty", "queries300"]) {
    const child: SpawnSyncReturns<string> = spawnSync(process.execPath, ["--max-old-space-size=2048", "--import", "tsx", "--no-warnings", script,
      "--fixture", fixture, "--root", root], { cwd: source, env: fixtureEnvironment(), encoding: "utf8", timeout: 60_000,
      maxBuffer: 1024 * 1024, windowsHide: true });
    assert.equal(child.status, 0, `Fixture failed without retry: ${child.error ?? child.stderr}`);
    results.push(JSON.parse(child.stdout));
  }
  console.log(JSON.stringify({ format: "keryx-enrolled-health-cost-v1", kind: "synthetic-mainnet-schema",
    node: process.versions.node, platform: process.platform, sourceHashes, productionCalls: 0, paymentsExecuted: 0,
    results, limitations: "Genuine readonly enrolled facade on isolated synthetic stores. Not a Next HTTP, live traffic, production latency or outage-cause measurement. Timing and operation-count trials are separate." }));
} else {
  assert(arguments_.length === 4 && arguments_[0] === "--fixture" && ["empty", "queries300"].includes(arguments_[1]) && arguments_[2] === "--root");
  const fixture = arguments_[1], root = realpathSync(arguments_[3]);
  assert(isAbsolute(root) && lstatSync(root).isDirectory());
  const folder = mkdtempSync(join(root, "enrolled-health-")), file = join(folder, "synthetic.sqlite"), manifest = join(folder, "deployment.json");
  const attempts = denyOutbound();
  const { canonicalJson } = await import("../lib/canonical-json");
  const { installMainnetApplicationSchema } = await import("../lib/db/mainnet-application-schema");
  const { insertStorageIdentity, installStorageFences } = await import("../lib/db/storage-identity-sqlite");
  const { STORAGE_MAINNET_PROFILE_DIGEST, validateStorageIdentity } = await import("../lib/db/storage-identity");
  const identity = validateStorageIdentity({ format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
    network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST,
    deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(), enrolledAt: "2026-10-05T00:00:00.000Z", provenanceDigest: "11".repeat(32) });
  const native = new DatabaseSync(file);
  let schemaObjects = 0;
  try {
    native.exec("BEGIN IMMEDIATE");
    installMainnetApplicationSchema(native);
    if (fixture === "queries300") {
      const insert = native.prepare("INSERT INTO query_runs(id,question,answer,origin,payment_mode,duration_ms) VALUES(?,?,?,?,?,?)");
      for (let i = 0; i < 300; i++) insert.run(`synthetic-${i}`, "Public fixture question", "Synthetic fixture answer", i % 2 ? "web" : "mcp", "offline", 100 + i);
    }
    insertStorageIdentity(native, identity); installStorageFences(native, identity);
    native.exec("COMMIT");
    schemaObjects = Number(native.prepare("SELECT COUNT(*) AS n FROM sqlite_schema").get()!.n);
  } finally { native.close(); }
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  // This is the existing synthetic mainnet-schema fixture admission, not a real
  // execution mode. Network denial is already installed; no funding/worker opens.
  process.env.KERYX_STORAGE_MANIFEST = manifest; process.env.KERYX_SQLITE_PATH = file;
  process.env.KERYX_FORCE_OFFLINE = "0"; process.env.CONTENT_MASTER_KEY = randomBytes(32).toString("hex");
  const { createReadonlyEnrolledSqliteAdapter } = await import("../lib/db/enrolled-sqlite-adapter");
  const reader = await createReadonlyEnrolledSqliteAdapter();
  let result;
  try {
    const before = digest(readFileSync(file));
    const nowMs = Date.parse("2026-11-09T00:00:00.000Z"), keys = ["lastSyncedBlock", "registryParity", "dispatchHealth", "settlementParity", "pendingPaymentReconciliation", "a2aWorker"];
    const operations: Record<string, () => Promise<unknown>> = {
      metrics: () => reader.metrics(),
      jobs: () => reader.a2aOperationsSnapshot(nowMs),
      sync: async () => [...await reader.getSyncStates(keys)],
      healthReadSet: async () => {
        const snapshot = await (reader as KeryxDB).readPublicHealthSnapshot!(nowMs, true);
        assert(snapshot, "Genuine enrolled health composition must execute, not fall back");
        return { metrics: snapshot.metrics, jobs: snapshot.jobs, sync: [...snapshot.syncState] };
      },
    };
    const measurements: Record<string, unknown> = {};
    for (const [name, operation] of Object.entries(operations)) {
      const expected = JSON.stringify(await operation()), rounds = [];
      for (let i = 0; i < 5; i++) {
        const cpu = process.cpuUsage(), start = performance.now(), output = await operation();
        const elapsedMs = performance.now() - start, used = process.cpuUsage(cpu);
        assert.equal(JSON.stringify(output), expected);
        rounds.push({ wallMs: elapsedMs, cpuMs: (used.user + used.system) / 1000 });
      }
      const counts: NativeReadCounts = { nativePrepares: 0, metricInputReads: 0, accountReads: 0, jobReads: 0, syncReads: 0, schemaReads: 0 };
      const original = DatabaseSync.prototype.prepare;
      DatabaseSync.prototype.prepare = function(this: DatabaseSync, sql: string) {
        counts.nativePrepares++;
        const fixed = sql.replace(/\s+/g, " ").trim();
        if (/^SELECT (?:0 AS metric_group|amount_usdc,source_id|id,origin,asker|query_id,rating|status FROM gap_intents)/.test(fixed)) counts.metricInputReads++;
        if (fixed.startsWith("SELECT COUNT(DISTINCT LOWER(wallet_address))")) counts.accountReads++;
        if (fixed.startsWith("SELECT status,created_at,updated_at,started_at,execution_journal_version")) counts.jobReads++;
        if (fixed.startsWith("SELECT key, value FROM sync_state WHERE")) counts.syncReads++;
        if (/FROM sqlite_(?:schema|master)\b/.test(fixed)) counts.schemaReads++;
        return original.call(this, sql);
      };
      try { assert.equal(JSON.stringify(await operation()), expected); }
      finally { DatabaseSync.prototype.prepare = original; }
      measurements[name] = { rounds, counts, outputSha256: digest(expected) };
    }
    assert.equal(digest(readFileSync(file)), before, "Readonly trials do not change database bytes");
    assert.equal(attempts(), 0);
    result = { fixture, schemaObjects, measurements, readonlyDatabaseBytesStable: true, outboundAttempts: 0 };
  } finally { reader.close(); }
  const owned = relative(root, folder);
  assert(owned && !owned.startsWith("..") && !isAbsolute(owned) && !lstatSync(folder).isSymbolicLink());
  rmSync(folder, { recursive: true });
  assert(!existsSync(folder));
  console.log(JSON.stringify({ ...result, temporaryFixtureRemoved: true }));
}

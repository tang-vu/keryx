/** Finite synthetic protocol only. Never accepts a production/retained input,
 * connects to a target or starts an application. Root schedules --stress290 in
 * an externally deadline-contained512MiB Linux process; no cap is relaxed here. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../../lib/canonical-json";
import { STORAGE_TESTNET_PROFILE_DIGEST, validateStorageIdentity } from "../../lib/db/storage-identity";
import { insertStorageIdentity } from "../../lib/db/storage-identity-sqlite";
import { nativeMaterializationProfile } from "../../lib/db/postgres/runtime-profile";
import { inspectTypedDeltaSnapshot, streamTypedSnapshotDelta } from "./typed-snapshot-delta.mts";
const args = process.argv.slice(2); assert(args.length <= 1 && (args.length === 0 || args[0] === "--small" || args[0] === "--stress290"));
assert.equal(process.versions.node, "24.22.1");
const stress = args[0] === "--stress290", started = performance.now();
const check = () => assert(performance.now() - started < 300000, "Synthetic qualification deadline");
let kernelMemoryBoundVerified = false;
if (stress) {
  assert.equal(process.platform, "linux", "Large qualification requires actual Linux512MiB containment");
  assert.equal(readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim(), "536870912");
  assert.equal(readFileSync("/sys/fs/cgroup/memory.swap.max", "utf8").trim(), "0");
  assert.equal(readFileSync("/sys/fs/cgroup/pids.max", "utf8").trim(), "32");
  assert(/^NoNewPrivs:\s+1$/m.test(readFileSync("/proc/self/status", "utf8")));
  assert.equal(readFileSync("/proc/net/route", "utf8").trim().split("\n").length, 1);
  kernelMemoryBoundVerified = true;
}
let outbound = 0; globalThis.fetch = async () => { outbound++; throw Error("Synthetic delta forbids outbound HTTP"); };
const directory = mkdtempSync(join(tmpdir(), "keryx-typed-delta-qualifier-"));
const identity = { format: "keryx-storage-identity-v1" as const, authorityMode: "testnet-offline" as const, network: "eip155:5042002" as const,
  profileDigest: STORAGE_TESTNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
  enrolledAt: "2026-10-01T00:00:00.000Z", provenanceDigest: "a".repeat(64) };
function fileHash(path: string) {
  const fd = openSync(path, "r"), hash = createHash("sha256"), buffer = Buffer.alloc(1048576);
  try { for (;;) { const n = readSync(fd, buffer); if (!n) break; hash.update(buffer.subarray(0, n)); check(); } return { sha256: hash.digest("hex"), bytes: Number(fstatSync(fd).size) }; }
  finally { closeSync(fd); }
}
try {
  const count = stress ? 1100 : 12, payload = Buffer.alloc(stress ? 262144 : 32, 255);
  const make = (after: boolean) => {
    const path = join(directory, after ? "after.sqlite" : "before.sqlite"), db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA journal_mode=DELETE; PRAGMA cache_size=-1024; PRAGMA synchronous=FULL;"); insertStorageIdentity(db, validateStorageIdentity(identity));
      db.exec("CREATE TABLE synthetic_delta(id INTEGER PRIMARY KEY,raw TEXT,payload BLOB); BEGIN IMMEDIATE;");
      const insert = db.prepare("INSERT INTO synthetic_delta VALUES(?,?,?)");
      for (let i = 1; i <= count; i++) {
        check(); if (after && i === count) continue;
        insert.run(i, i === 1 && after ? ' {"raw":"changed"} ' : ' {"raw":"\\u0000","raw":"\\ud800"} ', payload);
      }
      if (after) insert.run(count + 1, "Synthetic added\0row", payload); db.exec("COMMIT;");
    } finally { db.close(); }
    chmodSync(path, 0o600); const observed = fileHash(path); return { descriptor: { path, sha256: observed.sha256 }, bytes: observed.bytes };
  };
  const before = make(false), after = make(true), inventory = await inspectTypedDeltaSnapshot(before.descriptor);
  const prior = { format: "keryx-native-held-data-baseline-metadata-v1", profileMode: "development-current510-data-only",
    catalogSha256: nativeMaterializationProfile("development-current510-data-only").catalogSha256, targetState: "held", sequence: 0,
    snapshotSha256: inventory.snapshotSha256, schemaSha256: inventory.schemaSha256, identityDigest: inventory.identityDigest, dataDigest: inventory.dataDigest };
  const wire = canonicalJson(prior), expectedSha256 = createHash("sha256").update(wire).digest("hex");
  const stream = streamTypedSnapshotDelta({ before: before.descriptor, after: after.descriptor, priorTarget: { wire, expectedSha256 } });
  const consume = async () => {
    let batches = 0;
    for (;;) { const part = await stream.next(); if (part.done) return { summary: part.value, batches };
      assert.equal(part.value.provisional, true); batches++; check(); /* Never log private row contents. */ }
  };
  const { summary, batches } = await consume();
 assert.equal(summary.changes, 3); assert.equal(summary.inserts, 1); assert.equal(summary.updates, 1); assert.equal(summary.deletes, 1);
  assert.equal(summary.targetVerified, false); assert.equal(summary.applicationAuthority, false); assert.equal(summary.targetWrites, 0);
  assert.equal(fileHash(before.descriptor.path).sha256, before.descriptor.sha256); assert.equal(fileHash(after.descriptor.path).sha256, after.descriptor.sha256);
  assert.equal(outbound, 0); check();
  console.log(JSON.stringify({ format: "keryx-typed-snapshot-delta-synthetic-qualification-v1", passed: true, syntheticOnly: true,
    mode: stress ? "stress290" : "small", beforeBytes: before.bytes, afterBytes: after.bytes, rowsPerInput: count + 1,
    changes: summary.changes, batches, schemaSha256: summary.schemaSha256, deltaDigest: summary.deltaDigest,
    deltaBytes: summary.deltaBytes, inputsUnchanged: true, kernelMemoryBoundVerified, elapsedMs: Math.round(performance.now() - started),
    targetVerified: false, applicationAuthority: false, nativeFactoryQualified: false, targetWrites: 0, outbound }));
} finally {
  const allowed = new Set(["before.sqlite", "after.sqlite", "before.sqlite-journal", "after.sqlite-journal"]);
  for (const file of readdirSync(directory)) { assert(allowed.has(file), "Unowned synthetic cleanup file"); unlinkSync(join(directory, file)); }
  rmdirSync(directory);
}

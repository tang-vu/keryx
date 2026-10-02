import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { inspectStorageProvenance, OFFLINE_SNAPSHOT_LIMITS } from "../lib/db/storage-provenance.ts";

// Actual Linux kernel containment acceptance. Synthetic files only, no environment or runtime adapters.
assert.equal(process.platform, "linux");
assert.equal(process.getuid?.(), 0, "invoke explicitly as privileged operator; no auto-sudo");
const directory = mkdtempSync(join(tmpdir(), "keryx-capacity-acceptance-"));
function fixture(name: string, sql: string) {
  const file = join(directory, `${name}.sqlite`), db = new DatabaseSync(file);
  try { db.exec(sql); } finally { db.close(); }
  return file;
}
async function digest(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
const inspect = (file: string, limits = {}) => inspectStorageProvenance(file, limits, "offline_snapshot");
const units = () => execFileSync("/usr/bin/systemctl", ["list-units", "--all", "--plain", "--no-legend", "keryx-provenance-*.service"], { encoding: "utf8" }).trim();
const beforeUnits = units();
try {
  const sql = "CREATE TABLE payment_events(network TEXT); INSERT INTO payment_events VALUES('eip155:5042002'); CREATE TABLE paid_content(payload BLOB);";
  const small = fixture("small", sql), large = fixture("large", `${sql} INSERT INTO paid_content VALUES(zeroblob(178257920));`);
  assert.ok(statSync(large).size > 64 * 1024 * 1024);
  const before = await digest(large);
  assert.equal((await inspectStorageProvenance(large)).reason, "file_limit");
  const reference = await inspect(small), report = await inspect(large);
  assert.equal(reference.status, "intake_only"); assert.equal(report.status, "intake_only");
  assert.equal(report.evidence?.selectedAuthoritySha256, reference.evidence?.selectedAuthoritySha256);
  assert.equal(report.evidence?.schemaSha256, reference.evidence?.schemaSha256);
  assert.equal(report.evidence?.scannedRows, 1); assert.equal(report.origin, "unknown_legacy");
  assert.equal(report.enrollmentAuthorized, false); assert.equal(report.modeIdentityAccepted, false);
  assert.equal(await digest(large), before);
  assert.deepEqual(readdirSync(directory).sort(), ["large.sqlite", "small.sqlite"]);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    writeFileSync(`${small}${suffix}`, "synthetic");
    assert.equal((await inspect(small)).reason, "snapshot_sidecar"); rmSync(`${small}${suffix}`);
  }
  const foreign = fixture("foreign", "CREATE TABLE payment_events(network TEXT); INSERT INTO payment_events VALUES('eip155:1');");
  assert.equal((await inspect(foreign)).reason, "foreign_authority");
  const malformed = fixture("malformed", "CREATE TABLE private_research_intents(data TEXT); INSERT INTO private_research_intents VALUES('{bad');");
  assert.equal((await inspect(malformed)).reason, "malformed_authority");
  const rows = fixture("rows", "CREATE TABLE payment_events(network TEXT); INSERT INTO payment_events VALUES('eip155:5042002'),('eip155:5042002');");
  for (const [limits, reason] of [[{ rows: 1 }, "row_limit"], [{ fieldBytes: 4 }, "field_limit"], [{ selectedBytes: 4 }, "byte_limit"],
    [{ deadlineMs: 1 }, "deadline_exceeded"], [{ fileBytes: OFFLINE_SNAPSHOT_LIMITS.fileBytes + 1 }, "invalid_limits"]] as const) {
    const refused = await inspect(rows, limits); assert.equal(refused.reason, reason); assert.equal(refused.snapshotComplete, false);
  }
  // Size-aware SQL must read this large TEXT cell internally. Kernel containment must kill that
  // native pressure without returning private bytes or completed evidence.
  const pressure = fixture("pressure", "CREATE TABLE payment_events(network TEXT); INSERT INTO payment_events VALUES(printf('%.*c',314572800,'x'));");
  assert.ok(statSync(pressure).size < OFFLINE_SNAPSHOT_LIMITS.fileBytes);
  const pressured = await inspect(pressure);
  assert.equal(pressured.status, "refused"); assert.equal(pressured.reason, "native_resource_limit");
  assert.equal(pressured.evidence, undefined); assert.equal(pressured.snapshotComplete, false);
  assert.ok(!JSON.stringify(pressured).includes(directory));
  assert.equal(units(), beforeUnits, "all captured transient services must be cleaned up");
  console.log("PASS: Linux contained snapshot capacity, authority equivalence, default/authority limits, actual native OOM kill, and unit cleanup (synthetic only).");
} finally { rmSync(directory, { recursive: true, force: true }); }

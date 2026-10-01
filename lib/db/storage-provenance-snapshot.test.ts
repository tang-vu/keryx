import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { appendFileSync, closeSync, fstatSync, mkdtempSync, openSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { inspectStorageProvenance, OFFLINE_SNAPSHOT_LIMITS, validatedProvenanceLimits } from "./storage-provenance";
import { checkSnapshotSidecars, checkSnapshotUnchanged, validateSnapshotHeader, verifySnapshotContainment } from "./storage-provenance-snapshot";
import { scanStorageProvenance } from "./storage-provenance-scan";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "keryx-offline-provenance-")); directories.push(directory);
  const file = join(directory, "synthetic.sqlite");
  const db = new DatabaseSync(file); db.exec("CREATE TABLE payment_events(network TEXT);"); db.close();
  return { directory, file };
}
function checkHeader(file: string) {
  const descriptor = openSync(file, "r");
  try { validateSnapshotHeader(descriptor); } finally { closeSync(descriptor); }
}
describe("offline snapshot boundaries without privileged service creation", () => {
  it("refuses uncontained direct scans before opening a target", () => {
    expect(() => verifySnapshotContainment()).toThrow("native_limits_unavailable");
    const report = scanStorageProvenance("not-even-an-absolute-path", OFFLINE_SNAPSHOT_LIMITS, "offline_snapshot");
    expect(report).toMatchObject({ status: "refused", reason: "native_limits_unavailable", snapshotComplete: false });
    expect(report.evidence).toBeUndefined();
  });
  it.skipIf(process.platform === "linux")("refuses unsupported platforms explicitly without opening the target", async () => {
    expect(await inspectStorageProvenance("not-even-an-absolute-path", {}, "offline_snapshot"))
      .toMatchObject({ reason: "native_limits_unavailable", inspectionMode: "offline_snapshot" });
  });
  it.each(["-wal", "-shm", "-journal"])("rejects a %s sidecar", suffix => {
    const f = fixture(); writeFileSync(`${f.file}${suffix}`, "synthetic");
    expect(() => checkSnapshotSidecars(f.file)).toThrow("snapshot_sidecar");
  });
  it.each(["size", "mtime", "sidecar"])("detects %s mutation while retaining the original descriptor", kind => {
    const f = fixture(), descriptor = openSync(f.file, "r"), before = fstatSync(descriptor, { bigint: true });
    try {
      checkSnapshotUnchanged(f.file, descriptor, before.size, before.mtimeNs);
      if (kind === "size") appendFileSync(f.file, "synthetic");
      else if (kind === "mtime") utimesSync(f.file, new Date(), new Date(Date.now() + 10000));
      else writeFileSync(`${f.file}-journal`, "synthetic");
      expect(() => checkSnapshotUnchanged(f.file, descriptor, before.size, before.mtimeNs))
        .toThrow(kind === "sidecar" ? "snapshot_sidecar" : "snapshot_changed");
    } finally { closeSync(descriptor); }
  });
  it("requires finalized rollback-journal header geometry without overlooking detached WAL", () => {
    const f = fixture(); expect(() => checkHeader(f.file)).not.toThrow();
    const db = new DatabaseSync(f.file); db.exec("PRAGMA journal_mode=WAL"); db.close();
    expect(readdirSync(f.directory)).toEqual(["synthetic.sqlite"]);
    expect(() => checkHeader(f.file)).toThrow("snapshot_header");
    const header = Buffer.alloc(100); header.write("SQLite format 3\0"); header.writeUInt16BE(513, 16);
    writeFileSync(f.file, header); expect(() => checkHeader(f.file)).toThrow("snapshot_header");
  });
  it("retains exact default limits and rejects arbitrary control overrides", () => {
    expect(validatedProvenanceLimits({}, "standard")?.fileBytes).toBe(64 * 1024 * 1024);
    expect(validatedProvenanceLimits({}, "offline_snapshot")?.fileBytes).toBe(512 * 1024 * 1024);
    for (const input of [{ fileBytes: OFFLINE_SNAPSHOT_LIMITS.fileBytes + 1 }, { nativeHeapBytes: 1 },
      { processBytes: 1 }, { cacheKiB: 1025 }]) expect(validatedProvenanceLimits(input, "offline_snapshot")).toBeUndefined();
    expect(validatedProvenanceLimits({}, "untrusted")).toBeUndefined();
    expect(validatedProvenanceLimits([], "standard")).toBeUndefined();
  });
  it("requires an exact explicit CLI invocation without echoing ignored arguments", () => {
    const f = fixture();
    for (const args of [["--offline-snapshot"], ["--offline-snapshot", f.file, "secret-extra"],
      [f.file, "--offline-snapshot"], ["--unknown", f.file]]) {
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/inspect-storage-provenance.mts", ...args], { encoding: "utf8" });
      expect(result.status).toBe(2); expect(result.stdout + result.stderr).not.toContain("secret-extra");
    }
  });
});

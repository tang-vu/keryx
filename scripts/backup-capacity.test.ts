import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { admitCapture, assertCapacity, BACKUP_LIMITS, retainedByteBudget, snapshotInventory, stagingBounds, usableBytes } from "./backup-capacity";

const folders: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of folders.splice(0)) {
  if (!path.resolve(dir).startsWith(path.join(os.tmpdir(), "keryx-backup-capacity-"))) throw Error("Cleanup target");
  fs.rmSync(dir, { recursive: true });
} });
const plenty = BigInt(BACKUP_LIMITS.reserveBytes + 2 * 1024 ** 3);
it("admits conservative complete staging only above available2GiB; reserved bfree is unusable", () => {
  const bound = stagingBounds(8192, true);
  expect(bound.peakBytes).toBeGreaterThan(8192 * 4);
  expect(() => assertCapacity(BigInt(BACKUP_LIMITS.reserveBytes) + BigInt(bound.peakBytes) - BigInt(1), bound.peakBytes)).toThrow("capacity");
  expect(() => assertCapacity(BigInt(BACKUP_LIMITS.reserveBytes) + BigInt(bound.peakBytes), bound.peakBytes)).not.toThrow();
  vi.spyOn(fs, "statfsSync").mockReturnValue({ bavail: BigInt(0), bfree: plenty, bsize: BigInt(4096) } as fs.BigIntStatsFs);
  expect(usableBytes("unused synthetic path")).toBe(BigInt(0));
  expect(() => admitCapture({ bytes: 0, gzip: 0, encrypted: 0 }, 8192, true, 48, BACKUP_LIMITS.retainedBytes, usableBytes("synthetic"))).toThrow("capacity");
});
it("shares one aggregate budget across gzip/encrypted while refusing count overflow without deletion", () => {
  const upper = stagingBounds(8192, true).peakBytes;
  expect(() => admitCapture({ bytes: 500, gzip: 1, encrypted: 1 }, 8192, true, 2, upper + 500, plenty)).not.toThrow();
  expect(() => admitCapture({ bytes: 501, gzip: 1, encrypted: 1 }, 8192, true, 2, upper + 500, plenty)).toThrow("retention");
  expect(() => admitCapture({ bytes: 0, gzip: 2, encrypted: 1 }, 8192, true, 2, BACKUP_LIMITS.retainedBytes, plenty)).toThrow("retention");
  for (const value of ["0", "-1", "Infinity", "536870913", "1.5"]) expect(() => retainedByteBudget(value)).toThrow();
});
it("counts recognized mixed snapshots and preserves unrelated payment/drill/partial artifacts byte-for-byte", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-backup-capacity-")); folders.push(dir);
  const gz = "keryx-2026-10-06T10-00-00-000Z.sqlite.gz", enc = gz.replace(/gz$/, "enc");
  const files = { [gz]: "gzip", [enc]: "encrypted", "withdrawal-journal.sqlite": "financial history",
    "restore-download.enc": "unknown envelope", "keryx-2026-10-06T11-00-00-000Z.sqlite.enc.partial": "uncertain" };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content, { mode: 0o600 });
  fs.mkdirSync(path.join(dir, "restore-download"), { mode: 0o700 });
  fs.writeFileSync(path.join(dir, "restore-download", "private.sqlite"), "restored plaintext", { mode: 0o600 });
  const charged = Object.values(files).reduce((total, content) => total + Buffer.byteLength(content), Buffer.byteLength("restored plaintext"));
  expect(snapshotInventory(dir)).toEqual({ bytes: charged, gzip: 1, encrypted: 1 });
  for (const [name, content] of Object.entries(files)) expect(fs.readFileSync(path.join(dir, name), "utf8")).toBe(content);
  fs.linkSync(path.join(dir, gz), path.join(dir, "foreign-hardlink"));
  expect(() => snapshotInventory(dir)).toThrow("unsafe-file");
});

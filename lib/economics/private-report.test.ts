import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { calculateTestnetEconomics } from "./testnet-economics";
import { privateEconomicsReport, writePrivateEconomicsReport } from "./private-report";
const directories: string[] = [], linux = it.skipIf(process.platform !== "linux");
afterEach(() => { for (const path of directories.splice(0)) {
  if (dirname(resolve(path)) !== resolve(tmpdir()) || !basename(path).startsWith("keryx-private-economics-")) throw new Error("Unexpected test cleanup target");
  rmSync(path, { recursive: true, force: true });
} });
function fixture() {
  const parent = mkdtempSync(join(tmpdir(), "keryx-private-economics-")); directories.push(parent); chmodSync(parent, 0o700);
  return { parent, directory: join(parent, "report"), load: vi.fn(async () => calculateTestnetEconomics([], [], new Date("2026-09-12T00:00:00Z"), [])) };
}
describe("private operator economics", () => {
  it("reads an existing SQLite schema without initialization or creating a missing database", async () => {
    const { SqliteAdapter } = await import("../db/sqlite-adapter"), f = fixture();
    const absent = join(f.parent, "missing", "database.sqlite");
    expect(() => new SqliteAdapter(absent, { readOnly: true })).toThrow(); expect(existsSync(join(f.parent, "missing"))).toBe(false);
    const path = join(f.parent, "existing.sqlite"), setup = new DatabaseSync(path);
    setup.exec("CREATE TABLE query_runs(economics_data TEXT); CREATE TABLE payment_events(query_id TEXT,kind TEXT,amount_usdc REAL,settled INTEGER,settlement_status TEXT,grant_epoch TEXT); CREATE TABLE a2a_orders(query_id TEXT,creator_budget_usdc REAL,service_fee_usdc REAL,status TEXT,response_data TEXT);"); setup.close();
    const before = readFileSync(path), db = new SqliteAdapter(path, { readOnly: true });
    try {
      expect((await db.economics()).sampledRuns).toBe(0);
      await expect(db.init()).rejects.toThrow();
    } finally { db.close(); }
    expect(readFileSync(path)).toEqual(before);
  });
  it("keeps accounting unknown and excludes unexpected source fields", () => {
    const snapshot = calculateTestnetEconomics([], [], new Date("2026-09-12T00:00:00Z"), []);
    const report = privateEconomicsReport({ ...snapshot, operatorSecret: "must-not-copy" } as typeof snapshot);
    expect(report.accounting).toEqual({ status: "unreconciled", providerInvoiceUsd: null, fixedOperatingCostUsd: null, realizedProfitUsd: null });
    expect(JSON.stringify(report)).not.toContain("must-not-copy");
    expect(report.scope).toContain("Not complete business accounting");
  });
  linux("writes private read-back-verified output once, even with racing callers", async () => {
    const f = fixture();
    const results = await Promise.allSettled([writePrivateEconomicsReport(f.directory, f.load), writePrivateEconomicsReport(f.directory, f.load)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(f.load).toHaveBeenCalledOnce();
    const path = join(f.directory, "economics.json"), before = readFileSync(path);
    expect(statSync(f.directory).mode & 0o777).toBe(0o700); expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(before.toString()).visibility).toBe("operator-only");
    await expect(writePrivateEconomicsReport(f.directory, f.load)).rejects.toThrow(); expect(readFileSync(path)).toEqual(before);
  });
  linux("rejects public parents and symlink destinations before reading operational data", async () => {
    const f = fixture(); chmodSync(f.parent, 0o755);
    await expect(writePrivateEconomicsReport(f.directory, f.load)).rejects.toThrow(); expect(f.load).not.toHaveBeenCalled();
    expect(existsSync(f.directory)).toBe(false); chmodSync(f.parent, 0o700); symlinkSync(f.parent, f.directory);
    await expect(writePrivateEconomicsReport(f.directory, f.load)).rejects.toThrow(); expect(f.load).not.toHaveBeenCalled();
  });
  linux("retains failed output locations and redacts provider errors", async () => {
    const f = fixture(); f.load.mockRejectedValue(new Error("private-provider-detail"));
    await expect(writePrivateEconomicsReport(f.directory, f.load)).rejects.toThrow("No private details emitted");
    expect(existsSync(f.directory)).toBe(true);
    await expect(writePrivateEconomicsReport(f.directory, f.load)).rejects.toThrow(); expect(f.load).toHaveBeenCalledOnce();
  });
  it.skipIf(process.platform === "linux")("does not treat Windows mode bits as access control", async () => {
    const f = fixture(); await expect(writePrivateEconomicsReport(f.directory, f.load)).rejects.toThrow(); expect(f.load).not.toHaveBeenCalled();
  });
});

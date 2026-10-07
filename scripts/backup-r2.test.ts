import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadR2Backup, parseR2Listing, reserveR2Budget, r2Config, r2Limits, uploadR2Backup } from "./backup-r2";
import { withBackupLock } from "./backup-files";

const directories: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-r2-test-")); directories.push(directory);
  const ledger = path.join(directory, "r2-budget.json");
  fs.writeFileSync(ledger, JSON.stringify({ version: 1, month: new Date().toISOString().slice(0, 7), reservedRequests: 0, lastUploadDay: null }));
  return { directory, ledger };
}
const config = r2Config({ KERYX_R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`, KERYX_R2_BUCKET: "test-backups",
  KERYX_R2_ACCESS_KEY_ID: "test-id", KERYX_R2_SECRET_ACCESS_KEY: "test-secret" });
const name = "keryx-2026-09-30T01-00-00-000Z.sqlite.enc";
const listing = (objects: string[] = [], truncated = "false") => `<ListBucketResult><IsTruncated>${truncated}</IsTruncated>${objects.join("")}</ListBucketResult>`;
const object = (key = name, size = 100) => `<Contents><Key>${key}</Key><Size>${size}</Size></Contents>`;

describe("R2 job safety", () => {
  it("rejects incomplete, foreign, duplicate and oversized inventories instead of traversing", () => {
    expect(parseR2Listing(listing([object()]))).toEqual([{ key: name, size: 100 }]);
    for (const xml of [listing([], "true"), listing([object("unknown")]), listing([object(name, r2Limits.objectBytes + 1)]),
      listing([object(), object()]), "<Error>denied</Error>"]) expect(() => parseR2Listing(xml)).toThrow();
  });
  it("reserves persistently before requests, blocks same-day retries, and rolls only into a new month", () => {
    const { ledger } = setup();
    const now = new Date();
    expect(reserveR2Budget(ledger, 32, true, now)).toBe(true);
    expect(reserveR2Budget(ledger, 32, true, now)).toBe(false);
    expect(JSON.parse(fs.readFileSync(ledger, "utf8")).reservedRequests).toBe(32);
    expect(() => reserveR2Budget(ledger, 1000, false, now)).toThrow();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    expect(reserveR2Budget(ledger, 32, true, nextMonth)).toBe(true);
    expect(JSON.parse(fs.readFileSync(ledger, "utf8")).reservedRequests).toBe(32);
    expect(() => reserveR2Budget(ledger, 1, false, now)).toThrow();
    fs.unlinkSync(ledger);
    expect(() => reserveR2Budget(ledger, 32, true)).toThrow();
  });
  it("makes one failed network attempt and retains its budget across retries", async () => {
    const { directory, ledger } = setup(); const source = path.join(directory, name); fs.writeFileSync(source, Buffer.alloc(100));
    const network = vi.fn().mockRejectedValue(new Error("secret upstream diagnostic")); vi.stubGlobal("fetch", network);
    await expect(uploadR2Backup(source, directory, config)).rejects.toThrow();
    expect(network).toHaveBeenCalledTimes(1);
    expect(await uploadR2Backup(source, directory, config)).toBe("daily-limit");
    expect(network).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(ledger, "utf8")).reservedRequests).toBe(32);
  });
  it("holds full or historical ambiguous remote inventory without PUT or deletion and retains the consumed day", async () => {
    const { directory } = setup(); const source = path.join(directory, name); fs.writeFileSync(source, Buffer.alloc(100));
    const existing = Array.from({ length: 24 }, (_, index) => object(`keryx-2026-09-${String(index + 1).padStart(2, "0")}T01-00-00-000Z.sqlite.enc`));
    const network = vi.fn().mockResolvedValueOnce(new Response(listing(existing))).mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", network);
    expect(await uploadR2Backup(source, directory, config)).toBe("retention-limit");
    expect(network.mock.calls.map((call) => call[1].method)).toEqual(["GET"]);
    expect(String(network.mock.calls[0][0])).toContain("max-keys=26");
    expect(await uploadR2Backup(source, directory, config)).toBe("daily-limit");
    expect(network).toHaveBeenCalledTimes(1);
    const next = setup(), nextSource = path.join(next.directory, name); fs.writeFileSync(nextSource, Buffer.alloc(100));
    network.mockReset().mockResolvedValueOnce(new Response(listing([...existing, object("keryx-2026-09-25T01-00-00-000Z.sqlite.enc")])));
    expect(await uploadR2Backup(nextSource, next.directory, config)).toBe("retention-limit");
    expect(network.mock.calls.map((call) => call[1].method)).toEqual(["GET"]);
  });
  it("does not delete good backups or retry when PUT fails with spare remote capacity", async () => {
    const { directory } = setup(); const source = path.join(directory, name); fs.writeFileSync(source, Buffer.alloc(100));
    const existing = Array.from({ length: 23 }, (_, index) => object(`keryx-2026-09-${String(index + 1).padStart(2, "0")}T01-00-00-000Z.sqlite.enc`));
    const network = vi.fn().mockResolvedValueOnce(new Response(listing(existing))).mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", network);
    await expect(uploadR2Backup(source, directory, config)).rejects.toThrow();
    expect(network.mock.calls.map((call) => call[1].method)).toEqual(["GET", "PUT"]);
    expect(await uploadR2Backup(source, directory, config)).toBe("daily-limit");
    expect(network).toHaveBeenCalledTimes(2);
  });
  it("does not PUT after truncated listing and bounds downloaded bytes", async () => {
    const { directory } = setup(); const source = path.join(directory, name); fs.writeFileSync(source, Buffer.alloc(100));
    const network = vi.fn().mockResolvedValue(new Response(listing([], "true"))); vi.stubGlobal("fetch", network);
    await expect(uploadR2Backup(source, directory, config)).rejects.toThrow(); expect(network).toHaveBeenCalledTimes(1);
    network.mockResolvedValue(new Response(Buffer.alloc(r2Limits.objectBytes + 1)));
    await expect(downloadR2Backup(name, path.join(directory, "download"), directory, config)).rejects.toThrow();
  });
  it("serializes asynchronous jobs and never steals locks", async () => {
    const { directory } = setup();
    await withBackupLock(directory, async () => {
      await expect(withBackupLock(directory, async () => undefined)).rejects.toThrow();
      expect(fs.existsSync(path.join(directory, ".backup.lock"))).toBe(true);
    });
    expect(fs.existsSync(path.join(directory, ".backup.lock"))).toBe(false);
  });
});

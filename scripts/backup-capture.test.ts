import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { captureBackup } from "./backup-capture";
import { prepareBackupSource } from "./backup-source";
import { readBackupStatus } from "./backup-status";
import { publishPrivate, exclusivePrivate, digest, assertProtectedAncestors } from "./backup-persistence";
import { BACKUP_LIMITS } from "./backup-capacity";
import { decryptBackup } from "./backup-encryption";
import { canonicalJson } from "../lib/canonical-json";
import { STORAGE_TESTNET_PROFILE_DIGEST, validateStorageIdentity, type StorageIdentity } from "../lib/db/storage-identity";
import { insertStorageIdentity, installStorageFences } from "../lib/db/storage-identity-sqlite";

const folders: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const dir of folders.splice(0)) {
  if (!path.resolve(dir).startsWith(path.join(os.tmpdir(), "keryx-backup-capture-"))) throw Error("Cleanup target");
  fs.rmSync(dir, { recursive: true });
} });
function fixture(enrolled = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-backup-capture-")); folders.push(dir);
  const file = path.join(dir, "live.sqlite"), database = new DatabaseSync(file);
  database.exec("CREATE TABLE sources(id TEXT PRIMARY KEY); INSERT INTO sources VALUES('retained-source');");
  const env: Record<string, string> = { KERYX_SQLITE_PATH: file, KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
    KERYX_FORCE_OFFLINE: "1", KERYX_R2_UPLOAD: "0" };
  if (enrolled) {
    const identity: StorageIdentity = { format: "keryx-storage-identity-v1", authorityMode: "testnet-offline", network: "eip155:5042002",
      profileDigest: STORAGE_TESTNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
      enrolledAt: new Date().toISOString(), provenanceDigest: "11".repeat(32) };
    insertStorageIdentity(database, validateStorageIdentity(identity)); installStorageFences(database, identity);
    env.KERYX_STORAGE_MANIFEST = path.join(dir, "manifest.json");
    fs.writeFileSync(env.KERYX_STORAGE_MANIFEST, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
      backend: { kind: "sqlite", databasePath: file } }) + "\n", { mode: 0o600 });
  }
  database.close(); fs.chmodSync(file, 0o600);
  vi.spyOn(fs, "statfsSync").mockReturnValue({ bavail: BigInt(BACKUP_LIMITS.reserveBytes + 1024 ** 3), bsize: BigInt(1) } as fs.BigIntStatsFs);
  return { dir, file, env, backups: path.join(dir, "backups"), before: fs.readFileSync(file) };
}
it("refuses capacity before any snapshot/intent and records held without inventing successful freshness", async () => {
  const f = fixture(); vi.mocked(fs.statfsSync).mockReturnValue({ bavail: BigInt(BACKUP_LIMITS.reserveBytes), bsize: BigInt(1) } as fs.BigIntStatsFs);
  await expect(captureBackup(f.env)).rejects.toThrow("capacity");
  expect(fs.readdirSync(f.backups)).toEqual(["backup-status.json"]);
  expect(readBackupStatus(f.backups)).toMatchObject({ state: "held", reason: "capacity", lastSuccessfulCapture: null, offhostVerified: false });
  expect(fs.readFileSync(f.file)).toEqual(f.before);
});
it("captures encrypted/plain verified local recovery, then holds count boundary preserving all history and freshness", async () => {
  const f = fixture(); f.env.KERYX_BACKUP_ENCRYPTION_KEY = "07".repeat(32); f.env.KERYX_BACKUP_KEEP = "1";
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  const captured = await captureBackup(f.env), before = fs.readdirSync(f.backups).map(name => [name, fs.readFileSync(path.join(f.backups, name))] as const);
  const envelope = captured.lastSuccessfulCapture!.files.find(file => file.name.endsWith(".enc"))!;
  const decoded = decryptBackup(fs.readFileSync(path.join(f.backups, envelope.name)), Buffer.alloc(32, 7));
  expect(digest(decoded)).toBe(captured.lastSuccessfulCapture!.databaseSha256);
  const inspectedFile = path.join(f.dir, "offline-verified.sqlite"); fs.writeFileSync(inspectedFile, decoded, { mode: 0o600 });
  const inspected = new DatabaseSync(inspectedFile, { readOnly: true });
  try { expect(inspected.prepare("SELECT id FROM sources").all()).toEqual([{ id: "retained-source" }]); } finally { inspected.close(); }
  await expect(captureBackup(f.env)).rejects.toThrow("retention");
  expect(readBackupStatus(f.backups)).toMatchObject({ state: "held", lastSuccessfulCapture: captured.lastSuccessfulCapture });
  for (const [name, bytes] of before.filter(([name]) => name !== "backup-status.json")) expect(fs.readFileSync(path.join(f.backups, name))).toEqual(bytes);
  expect(network).not.toHaveBeenCalled(); expect(fs.readFileSync(f.file)).toEqual(f.before);
});
it("retains interrupted capture intent and partial snapshot; refuses another capture", async () => {
  const f = fixture(), original = fs.linkSync.bind(fs);
  vi.spyOn(fs, "linkSync").mockImplementation((source, target) => { if (String(target).endsWith(".gz")) throw Error("synthetic publication interruption"); return original(source, target); });
  await expect(captureBackup(f.env)).rejects.toThrow("synthetic publication interruption");
  const names = fs.readdirSync(f.backups); expect(names).toContain("backup-capture.pending.json"); expect(names.some(name => name.endsWith(".partial"))).toBe(true);
  const pending = fs.readFileSync(path.join(f.backups, "backup-capture.pending.json"));
  await expect(captureBackup(f.env)).rejects.toThrow("interrupted");
  expect(fs.readFileSync(path.join(f.backups, "backup-capture.pending.json"))).toEqual(pending);
  expect(fs.readdirSync(f.backups).filter(name => name.includes(".sqlite"))).toEqual(names.filter(name => name.includes(".sqlite")));
});
it("publication refuses existing target bytes and never promotes a partial status replacement", () => {
  const f = fixture(), staged = path.join(f.dir, "staged"), target = path.join(f.dir, "target");
  exclusivePrivate(staged, "new snapshot"); exclusivePrivate(target, "original history");
  expect(() => publishPrivate(staged, target)).toThrow(); expect(fs.readFileSync(target, "utf8")).toBe("original history");
  expect(fs.readFileSync(staged, "utf8")).toBe("new snapshot");
});
it("mixed byte budget refuses before capture and partial metadata is retained without another snapshot", async () => {
  const f = fixture(); fs.mkdirSync(f.backups, { mode: 0o700 });
  const gz = "keryx-2026-10-06T10-00-00-000Z.sqlite.gz", enc = gz.replace(/gz$/, "enc");
  fs.writeFileSync(path.join(f.backups, gz), Buffer.alloc(50), { mode: 0o600 }); fs.writeFileSync(path.join(f.backups, enc), Buffer.alloc(50), { mode: 0o600 });
  f.env.KERYX_BACKUP_MAX_BYTES = "100";
  await expect(captureBackup(f.env)).rejects.toThrow("retention");
  expect(fs.readdirSync(f.backups).filter(name => name.includes(".sqlite"))).toEqual([enc, gz]);
  const pending = path.join(f.backups, "backup-status.json.pending"); exclusivePrivate(pending, "uncertain metadata");
  await expect(captureBackup(f.env)).rejects.toThrow("interrupted");
  expect(fs.readFileSync(pending, "utf8")).toBe("uncertain metadata"); expect(fs.existsSync(path.join(f.backups, "backup-capture.pending.json"))).toBe(false);
});
it("source target replacement refuses before snapshot and manifest change refuses before enrolled output", async () => {
  const f = fixture(true), source = prepareBackupSource(f.env), output = path.join(f.dir, "unadmitted.sqlite");
  try {
    const manifest = JSON.parse(fs.readFileSync(f.env.KERYX_STORAGE_MANIFEST, "utf8")); manifest.identity.deploymentId = randomUUID();
    fs.writeFileSync(f.env.KERYX_STORAGE_MANIFEST, canonicalJson(manifest) + "\n");
    await expect(source.capture(output)).rejects.toThrow("selection"); expect(fs.existsSync(output)).toBe(false);
  } finally { source.close(); }
  const legacy = fixture(), selected = prepareBackupSource(legacy.env);
  try {
    // Windows prevents replacing an open native DB. Descriptor identity still
    // detects replacement where POSIX allows it; no production guard is mocked.
    if (process.platform !== "win32") {
      fs.renameSync(legacy.file, legacy.file + ".original"); fs.writeFileSync(legacy.file, legacy.before, { mode: 0o600 });
      expect(() => selected.verify()).toThrow("target_replaced");
    }
  } finally { selected.close(); }
});
it("enrolled readonly snapshot validates identity/fences and target provenance without initializing or mutating the store", async () => {
  const f = fixture(true), captured = await captureBackup(f.env);
  expect(captured.lastSuccessfulCapture?.enrolledReceipt).toMatchObject({ format: "keryx-storage-backup-receipt-v1", signingResumeAuthorized: false });
  expect(fs.readFileSync(f.file)).toEqual(f.before);
  const selection = prepareBackupSource(f.env); selection.close();
  expect(() => prepareBackupSource({ ...f.env, KERYX_FORCE_OFFLINE: "invalid" })).toThrow("selection");
  expect(() => prepareBackupSource({ ...f.env, KERYX_STORAGE_MANIFEST: "" })).toThrow("selection");
  expect(() => prepareBackupSource({ ...f.env, KERYX_SQLITE_PATH: path.join(f.dir, "foreign.sqlite") })).toThrow("selection");
  const manifest = JSON.parse(fs.readFileSync(f.env.KERYX_STORAGE_MANIFEST, "utf8")); manifest.identity.storageId = randomUUID();
  fs.writeFileSync(f.env.KERYX_STORAGE_MANIFEST, canonicalJson(manifest) + "\n");
  expect(() => prepareBackupSource(f.env)).toThrow("identity_mismatch");
});
it("rejects hardlinked manifests before any snapshot and rejects unsafe POSIX permissions/ancestors", () => {
  const f = fixture(true), extra = path.join(f.dir, "manifest-linked.json");
  fs.linkSync(f.env.KERYX_STORAGE_MANIFEST, extra);
  expect(() => prepareBackupSource(f.env)).toThrow("unsafe-file");
  expect(fs.existsSync(f.backups)).toBe(false);
  if (process.platform !== "win32") {
    const p = fixture(true); fs.chmodSync(p.env.KERYX_STORAGE_MANIFEST, 0o640);
    expect(() => prepareBackupSource(p.env)).toThrow("unsafe-file");
    fs.chmodSync(p.env.KERYX_STORAGE_MANIFEST, 0o600); fs.chmodSync(p.dir, 0o777);
    expect(() => assertProtectedAncestors(p.env.KERYX_STORAGE_MANIFEST)).toThrow("unsafe-file");
  }
});
it("mainnet never falls back to a legacy or offline target; explicit legacy offline selectors are required", () => {
  const f = fixture();
  for (const env of [{ ...f.env, KERYX_NETWORK: "arc", NEXT_PUBLIC_KERYX_NETWORK: "arc" },
    { ...f.env, KERYX_FORCE_OFFLINE: "0" }, { ...f.env, NEXT_PUBLIC_KERYX_NETWORK: "arc" }]) expect(() => prepareBackupSource(env)).toThrow("selection");
  expect(fs.existsSync(f.backups)).toBe(false);
});
it("PUT acknowledgement stays unverified and same-day held request accounting is never retried", async () => {
  const f = fixture(); Object.assign(f.env, { KERYX_BACKUP_ENCRYPTION_KEY: "07".repeat(32), KERYX_R2_UPLOAD: "1",
    KERYX_R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`, KERYX_R2_BUCKET: "fixture-backups",
    KERYX_R2_ACCESS_KEY_ID: "fixture-key", KERYX_R2_SECRET_ACCESS_KEY: "fixture-secret" });
  fs.mkdirSync(f.backups, { mode: 0o700 });
  exclusivePrivate(path.join(f.backups, "r2-budget.json"), JSON.stringify({ version: 1, month: new Date().toISOString().slice(0, 7), reservedRequests: 0, lastUploadDay: null }));
  const network = vi.fn().mockResolvedValueOnce(new Response("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"))
    .mockResolvedValueOnce(new Response(null, { status: 200 })); vi.stubGlobal("fetch", network);
  const first = await captureBackup(f.env); expect(first).toMatchObject({ remote: "put-acknowledged", offhostVerified: false, automaticPruning: false });
  const accounting = fs.readFileSync(path.join(f.backups, "r2-budget.json"));
  const second = await captureBackup(f.env); expect(second.remote).toBe("daily-limit");
  expect(network).toHaveBeenCalledTimes(2); expect(fs.readFileSync(path.join(f.backups, "r2-budget.json"))).toEqual(accounting);
  for (const file of first.lastSuccessfulCapture!.files) expect(fs.existsSync(path.join(f.backups, file.name))).toBe(true);
});
it("a full remote catalog holds without PUT/DELETE while preserving the newly verified local recovery", async () => {
  const f = fixture(); Object.assign(f.env, { KERYX_BACKUP_ENCRYPTION_KEY: "07".repeat(32), KERYX_R2_UPLOAD: "1",
    KERYX_R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`, KERYX_R2_BUCKET: "fixture-backups",
    KERYX_R2_ACCESS_KEY_ID: "fixture-key", KERYX_R2_SECRET_ACCESS_KEY: "fixture-secret" });
  fs.mkdirSync(f.backups, { mode: 0o700 });
  exclusivePrivate(path.join(f.backups, "r2-budget.json"), JSON.stringify({ version: 1, month: new Date().toISOString().slice(0, 7), reservedRequests: 0, lastUploadDay: null }));
  const objects = Array.from({ length: 24 }, (_, index) => `<Contents><Key>keryx-2026-09-${String(index + 1).padStart(2, "0")}T01-00-00-000Z.sqlite.enc</Key><Size>100</Size></Contents>`).join("");
  const network = vi.fn().mockResolvedValue(new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${objects}</ListBucketResult>`)); vi.stubGlobal("fetch", network);
  await expect(captureBackup(f.env)).rejects.toThrow("retention");
  const held = readBackupStatus(f.backups)!;
  expect(held).toMatchObject({ state: "held", reason: "retention", remote: "retention-limit", offhostVerified: false, automaticPruning: false });
  expect(held.lastSuccessfulCapture!.files).toHaveLength(2);
  for (const file of held.lastSuccessfulCapture!.files) expect(fs.existsSync(path.join(f.backups, file.name))).toBe(true);
  expect(fs.existsSync(path.join(f.backups, "backup-capture.pending.json"))).toBe(false);
  expect(network.mock.calls.map(call => call[1].method)).toEqual(["GET"]);
  expect(JSON.parse(fs.readFileSync(path.join(f.backups, "r2-budget.json"), "utf8"))).toMatchObject({ reservedRequests: 32, lastUploadDay: new Date().toISOString().slice(0, 10) });
});
it("snapshot transactions end before compression/network and clock rollback cannot refresh history", async () => {
  const f = fixture(true), admitted = prepareBackupSource(f.env), writer = new DatabaseSync(f.file);
  try { writer.exec("PRAGMA busy_timeout=1; BEGIN EXCLUSIVE; ROLLBACK"); } finally { writer.close(); admitted.close(); }
  const legacy = fixture(), selected = prepareBackupSource(legacy.env);
  try {
    await selected.capture(path.join(legacy.dir, "captured.sqlite"));
    const write = new DatabaseSync(legacy.file); try { write.exec("PRAGMA busy_timeout=1; BEGIN EXCLUSIVE; ROLLBACK"); } finally { write.close(); }
  } finally { selected.close(); }
  const captured = await captureBackup(legacy.env), status = { ...captured, attemptedAt: new Date(Date.now() + 3600000).toISOString() };
  fs.writeFileSync(path.join(legacy.backups, "backup-status.json"), JSON.stringify(status));
  const files = fs.readdirSync(legacy.backups), original = fs.readFileSync(path.join(legacy.backups, "backup-status.json"));
  await expect(captureBackup(legacy.env)).rejects.toThrow("failed");
  expect(fs.readdirSync(legacy.backups)).toEqual(files); expect(fs.readFileSync(path.join(legacy.backups, "backup-status.json"))).toEqual(original);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { decryptBackup, encryptBackup, readBackupKey } from "./backup-encryption";
import { provisionSyntheticStorage } from "../lib/db/storage-identity-fixture";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import { canonicalJson } from "../lib/canonical-json";

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
const key = Buffer.alloc(32, 7);

describe("authenticated backups", () => {
  it("randomizes ciphertext and rejects every unauthenticated variant", () => {
    const plain = Buffer.from("private source and payment records");
    const envelope = encryptBackup(plain, key);
    expect(decryptBackup(envelope, key)).toEqual(plain);
    expect(encryptBackup(plain, key)).not.toEqual(envelope);
    expect(envelope.includes(plain)).toBe(false);
    for (const offset of [0, 8, 20, 36, envelope.length - 1]) {
      const modified = Buffer.from(envelope); modified[offset] ^= 1;
      expect(() => decryptBackup(modified, key)).toThrow();
    }
    expect(() => decryptBackup(envelope.subarray(0, -1), key)).toThrow();
    expect(() => decryptBackup(envelope, Buffer.alloc(32, 8))).toThrow();
    for (const invalid of [undefined, "", "a".repeat(63), "g".repeat(64)]) expect(() => readBackupKey(invalid)).toThrow();
  });

  it("backs up and restores SQLite in separate CLI processes, preserving source and refusing overwrite/wrong-key", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-backup-test-")); temporary.push(directory);
    const source = path.join(directory, "live.sqlite");
    const identity = await provisionSyntheticStorage(source, "testnet-offline");
    const db = new SqliteAdapter(source, { expectedIdentity: identity });
    await db.init(); db.close();
    const manifest = path.join(directory, "manifest.json");
    fs.writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
      backend: { kind: "sqlite", databasePath: source } }));
    const before = fs.readFileSync(source);
    const env = { ...process.env, KERYX_STORAGE_MANIFEST: manifest, KERYX_SQLITE_PATH: source, KERYX_BACKUP_ENCRYPTION_KEY: key.toString("hex"),
      KERYX_BACKUP_KEEP: "2", KERYX_BACKUP_REMOTE: "", KERYX_R2_UPLOAD: "0" };
    const run = (script: string, args: string[] = [], overrides = {}) => spawnSync(process.execPath,
      ["--import", "tsx", "--no-warnings", script, ...args], { cwd: process.cwd(), env: { ...env, ...overrides }, encoding: "utf8", timeout: 30_000 });
    const backup = run("scripts/backup-db.mts");
    expect(backup.status, backup.stderr).toBe(0);
    const staged = fs.readdirSync(path.join(directory, "backups")).find((file) => file.endsWith(".enc"))!;
    const envelope = path.join(directory, "backups", staged);
    const target = path.join(directory, "verified-restore");
    const restored = run("scripts/restore-backup.mts", [envelope, target]);
    expect(restored.status, restored.stderr).toBe(0);
    const restoredDb = new DatabaseSync(path.join(target, "keryx.sqlite"), { readOnly: true });
    expect(restoredDb.prepare("SELECT COUNT(*) AS count FROM query_runs").get()?.count).toBe(0); restoredDb.close();
    expect(JSON.parse(fs.readFileSync(path.join(target, "restore-receipt.json"), "utf8"))).toMatchObject({
      authenticationVerified: true, integrityVerified: true, signingResumeAuthorized: false, fullServiceRecoveryVerified: false });
    expect(run("scripts/restore-backup.mts", [envelope, target]).status).toBe(1);
    const rejected = path.join(directory, "wrong-key");
    expect(run("scripts/restore-backup.mts", [envelope, rejected], { KERYX_BACKUP_ENCRYPTION_KEY: "08".repeat(32) }).status).toBe(1);
    expect(fs.existsSync(path.join(rejected, "restore-receipt.json"))).toBe(false);
    expect(fs.existsSync(path.join(rejected, "keryx.sqlite"))).toBe(false);
    const corruptedPath = path.join(directory, "corrupt.enc");
    const corrupted = fs.readFileSync(envelope); corrupted[corrupted.length - 1] ^= 1;
    fs.writeFileSync(corruptedPath, corrupted);
    const corruptTarget = path.join(directory, "corrupt-restore");
    expect(run("scripts/restore-backup.mts", [corruptedPath, corruptTarget]).status).toBe(1);
    expect(fs.existsSync(path.join(corruptTarget, "restore-receipt.json"))).toBe(false);
    expect(fs.existsSync(path.join(corruptTarget, "keryx.sqlite"))).toBe(false);
    expect(fs.readFileSync(source)).toEqual(before);
    expect(run("scripts/backup-db.mts", [], { KERYX_BACKUP_REMOTE: "r2:legacy" }).status).toBe(1);
    expect(fs.readdirSync(path.join(directory, "backups")).filter((file) => file.endsWith(".gz"))).toHaveLength(2);
  });
});

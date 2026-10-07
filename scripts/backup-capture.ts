import fs from "node:fs";
import path from "node:path";
import { backupKeep, withBackupLock } from "./backup-files";
import { compressSnapshot, encryptSnapshot, fileDigest, readBackupKey } from "./backup-encryption";
import { admitCapture, assertCapacity, BackupHeld, retainedByteBudget, snapshotInventory, usableBytes } from "./backup-capacity";
import { assertPrivateDirectory, exclusivePrivate, holdPrivateFile, publishPrivate, removeOwned, syncDirectory } from "./backup-persistence";
import { prepareBackupSource } from "./backup-source";
import { readBackupStatus, writeBackupStatus, type BackupStatus, type CaptureReceipt } from "./backup-status";
import { r2Config, uploadR2Backup } from "./backup-r2";

/** No verified-copy receipt is currently implemented. Count/byte limits are
 * admission fences, never permission to delete prior recovery evidence. */
export async function captureBackup(configured: Readonly<Record<string, string | undefined>>): Promise<BackupStatus> {
  const env = Object.freeze({ ...configured });
  const source = prepareBackupSource(env), directory = path.join(path.dirname(source.file), "backups");
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); assertPrivateDirectory(directory);
    syncDirectory(path.dirname(directory)); // Persist a newly created backups/ entry before its capture intent.
    return await withBackupLock(directory, async () => {
      const previous = readBackupStatus(directory), attemptedAt = new Date().toISOString();
      if (previous && Date.parse(attemptedAt) < Date.parse(previous.attemptedAt)) throw new BackupHeld("failed");
      let receipt = previous?.lastSuccessfulCapture ?? null, remote: BackupStatus["remote"] = "disabled";
      const status = (state: BackupStatus["state"], reason: string | null): BackupStatus => ({ format: "keryx-backup-status-v1", attemptedAt,
        state, reason, lastSuccessfulCapture: receipt, remote, offhostVerified: false, automaticPruning: false,
        directoryDurability: process.platform === "win32" ? "offline-files-only" : "posix-fsynced" });
      const intent = path.join(directory, "backup-capture.pending.json");
      try {
        if (fs.existsSync(intent) || fs.existsSync(path.join(directory, "backup-status.json.pending"))) throw new BackupHeld("interrupted");
        const key = env.KERYX_BACKUP_ENCRYPTION_KEY === undefined ? null : readBackupKey(env.KERYX_BACKUP_ENCRYPTION_KEY);
        const inventory = snapshotInventory(directory), budget = retainedByteBudget(env.KERYX_BACKUP_MAX_BYTES);
        admitCapture(inventory, source.plainBytes, !!key, backupKeep(env.KERYX_BACKUP_KEEP), budget, usableBytes(directory));
        const base = `keryx-${attemptedAt.replace(/[:.]/g, "-")}.sqlite`, snapshot = path.join(directory, base + ".partial");
        exclusivePrivate(intent, JSON.stringify({ format: "keryx-backup-capture-intent-v1", attemptedAt, base,
          sourceTargetDigest: source.sourceTargetDigest, storageManifestSha256: source.storageManifestSha256, maximumSnapshotBytes: source.plainBytes, budgetBytes: budget,
          automaticPruning: false, offhostVerified: false }) + "\n");
        source.verify(); const enrolledReceipt = await source.capture(snapshot); syncDirectory(directory);
        const guard = () => { source.verify(); assertCapacity(usableBytes(directory)); };
        const held = holdPrivateFile(snapshot);
        const files: CaptureReceipt["files"] = [];
        try {
          guard(); held.verify(); await compressSnapshot(snapshot, snapshot + ".gz", guard); held.verify();
          publishPrivate(snapshot + ".gz", path.join(directory, base + ".gz"));
          if (key) {
            guard(); await encryptSnapshot(snapshot, snapshot + ".enc", key, guard); held.verify();
            publishPrivate(snapshot + ".enc", path.join(directory, base + ".enc"));
          }
          for (const name of [base + ".gz", ...(key ? [base + ".enc"] : [])]) {
            const file = path.join(directory, name), handle = holdPrivateFile(file);
            try { const bytes = fs.fstatSync(handle.fd).size, sha256 = await fileDigest(file); handle.verify(); files.push({ name, bytes, sha256 }); }
            finally { handle.close(); }
          }
          if (snapshotInventory(directory).bytes > budget) throw new BackupHeld("retention");
          const captured: CaptureReceipt = { capturedAt: attemptedAt, databaseSha256: await fileDigest(snapshot), files, enrolledReceipt,
            storageManifestSha256: source.storageManifestSha256, sourceTargetDigest: source.sourceTargetDigest, offhostVerified: false };
          held.verify(); guard();
          exclusivePrivate(path.join(directory, base + ".receipt.json"), JSON.stringify(captured) + "\n");
          receipt = captured;
          writeBackupStatus(directory, status("captured-local", null));
        } finally { held.close(); }
        // Only newly owned staging is removed, after durable local publication.
        removeOwned(snapshot); removeOwned(intent);
        if ((env.KERYX_BACKUP_REMOTE ?? "").trim() || env.KERYX_R2_UPLOAD !== undefined && !["0", "1"].includes(env.KERYX_R2_UPLOAD)) throw new BackupHeld("selection");
        if (env.KERYX_R2_UPLOAD === "1") {
          if (!key) throw new BackupHeld("selection");
          try { const uploaded = await uploadR2Backup(path.join(directory, base + ".enc"), directory, r2Config({ ...env }));
            if (uploaded === "retention-limit") { remote = "retention-limit"; throw new BackupHeld("retention"); }
            remote = uploaded === "uploaded" ? "put-acknowledged" : "daily-limit"; }
          catch (error) { if (remote !== "retention-limit") remote = "failed"; throw error; }
          writeBackupStatus(directory, status("captured-local", null));
        }
        return status("captured-local", null);
      } catch (error) {
        const held = status("held", error instanceof BackupHeld ? error.reason : "failed");
        // A partial metadata transition is evidence, not replaceable scratch.
        if (!fs.existsSync(path.join(directory, "backup-status.json.pending"))) writeBackupStatus(directory, held);
        throw error;
      }
    });
  } finally { source.close(); }
}

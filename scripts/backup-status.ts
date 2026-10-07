import fs from "node:fs";
import path from "node:path";
import { BackupHeld } from "./backup-capacity";
import { SNAPSHOT_NAME } from "./backup-capacity";
import { digest, exclusivePrivate, readPrivate, syncDirectory } from "./backup-persistence";

export type CaptureReceipt = { capturedAt: string; databaseSha256: string; files: { name: string; sha256: string; bytes: number }[];
  enrolledReceipt: unknown; storageManifestSha256: string | null; sourceTargetDigest: string; offhostVerified: false };
export type BackupStatus = { format: "keryx-backup-status-v1"; attemptedAt: string; state: "held" | "captured-local";
  reason: string | null; lastSuccessfulCapture: CaptureReceipt | null; remote: "disabled" | "daily-limit" | "put-acknowledged" | "retention-limit" | "failed";
  offhostVerified: false; automaticPruning: false; directoryDurability: "posix-fsynced" | "offline-files-only" };
function validateReceipt(receipt: CaptureReceipt, attemptedAt: string) {
  if (!receipt || Object.keys(receipt).sort().join(",") !== "capturedAt,databaseSha256,enrolledReceipt,files,offhostVerified,sourceTargetDigest,storageManifestSha256" ||
      receipt.offhostVerified !== false || new Date(receipt.capturedAt).toISOString() !== receipt.capturedAt ||
      Date.parse(receipt.capturedAt) > Date.parse(attemptedAt) || !/^[a-f0-9]{64}$/.test(receipt.databaseSha256) ||
      !/^[a-f0-9]{64}$/.test(receipt.sourceTargetDigest) || !Array.isArray(receipt.files) || ![1, 2].includes(receipt.files.length)) throw new BackupHeld("unsafe-file");
  const base = `keryx-${receipt.capturedAt.replace(/[:.]/g, "-")}.sqlite`;
  receipt.files.forEach((file, index) => {
    if (!file || Object.keys(file).sort().join(",") !== "bytes,name,sha256" || !SNAPSHOT_NAME.test(file.name) ||
        file.name !== base + (index === 0 ? ".gz" : ".enc") || !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 257 * 1024 ** 2) throw new BackupHeld("unsafe-file");
  });
  const enrolled = receipt.enrolledReceipt;
  if (enrolled === null ? receipt.storageManifestSha256 !== null : typeof receipt.storageManifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(receipt.storageManifestSha256)) throw new BackupHeld("unsafe-file");
  if (enrolled !== null) {
    if (!enrolled || typeof enrolled !== "object" || Object.keys(enrolled).sort().join(",") !== "format,identityDigest,outputTargetDigest,schemaDigest,signingResumeAuthorized,snapshotDigest,sourceTargetDigest") throw new BackupHeld("unsafe-file");
    const value = enrolled as Record<string, unknown>;
    if (value.format !== "keryx-storage-backup-receipt-v1" || value.signingResumeAuthorized !== false ||
        ["identityDigest", "outputTargetDigest", "schemaDigest", "snapshotDigest", "sourceTargetDigest"].some(key => typeof value[key] !== "string" || !/^[a-f0-9]{64}$/.test(value[key] as string)) ||
        value.sourceTargetDigest !== receipt.sourceTargetDigest) throw new BackupHeld("unsafe-file");
  }
}
export function readBackupStatus(directory: string): BackupStatus | null {
  const file = path.join(directory, "backup-status.json");
  if (!fs.existsSync(file)) return null;
  return validateBackupStatus(JSON.parse(readPrivate(file).toString()) as BackupStatus);
}
function validateBackupStatus(value: BackupStatus): BackupStatus {
  if (Object.keys(value).sort().join(",") !== "attemptedAt,automaticPruning,directoryDurability,format,lastSuccessfulCapture,offhostVerified,reason,remote,state" ||
      value.format !== "keryx-backup-status-v1" || !["held", "captured-local"].includes(value.state) || value.offhostVerified !== false ||
      value.automaticPruning !== false || !["disabled", "daily-limit", "put-acknowledged", "retention-limit", "failed"].includes(value.remote) ||
      !["posix-fsynced", "offline-files-only"].includes(value.directoryDurability) || new Date(value.attemptedAt).toISOString() !== value.attemptedAt ||
      value.state === "captured-local" && value.reason !== null || value.state === "held" && !["capacity", "retention", "source-size", "interrupted", "unsafe-file", "selection", "failed"].includes(value.reason ?? "")) throw new BackupHeld("unsafe-file");
  if (value.lastSuccessfulCapture !== null) validateReceipt(value.lastSuccessfulCapture, value.attemptedAt);
  return value;
}
/** Administrative metadata only. Held attempts never refresh capturedAt. A
 * partial status replacement blocks further capture instead of being reset. */
export function writeBackupStatus(directory: string, value: BackupStatus): void {
  validateBackupStatus(value);
  const file = path.join(directory, "backup-status.json"), pending = `${file}.pending`;
  const previous = fs.existsSync(file) ? readPrivate(file) : null;
  if (previous) readBackupStatus(directory);
  exclusivePrivate(pending, JSON.stringify(value) + "\n");
  if (previous ? digest(readPrivate(file)) !== digest(previous) : fs.existsSync(file)) throw new BackupHeld("unsafe-file");
  fs.renameSync(pending, file); syncDirectory(directory);
  if (digest(readPrivate(file)) !== digest(JSON.stringify(value) + "\n")) throw new BackupHeld("unsafe-file");
}

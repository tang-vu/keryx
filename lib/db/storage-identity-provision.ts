import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { StorageIdentityRefused, refuseStorage, validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { STORAGE_SNAPSHOT_LIMITS, type StorageSnapshot } from "./storage-identity-snapshot";

export interface StorageEnrollmentInspection extends StorageSnapshot {
  format: "keryx-storage-enrollment-inspection-v1";
  targetIdentityDigest: string;
  expectedIdentityDigest: string;
}
export interface ReviewedStorageEnrollment {
  format: "keryx-reviewed-storage-enrollment-v1";
  inspection: StorageEnrollmentInspection;
  provenanceDocumentDigest: string;
  unknownClassAttestation: string[];
}
export interface StorageProvisionReceipt {
  format: "keryx-storage-provision-receipt-v1";
  status: "created" | "enrolled" | "already_enrolled";
  identityDigest: string;
}
export interface StorageBackupReceipt {
  format: "keryx-storage-backup-receipt-v1";
  identityDigest: string; sourceTargetDigest: string; outputTargetDigest: string;
  schemaDigest: string; snapshotDigest: string; signingResumeAuthorized: false;
}
async function operation(mode: "inspect" | "create" | "enroll" | "backup", file: string, expected: StorageIdentity,
  reviewed?: ReviewedStorageEnrollment, freshOutput?: string): Promise<StorageEnrollmentInspection | StorageProvisionReceipt | StorageBackupReceipt> {
  try {
  const identity = validateStorageIdentity(expected);
  const request = JSON.stringify({ mode, file, identity, reviewed, freshOutput });
  if (Buffer.byteLength(request) > 128 * 1024) refuseStorage("request_limit");
  const require = createRequire(import.meta.url);
  const child = spawn(process.execPath, ["--max-old-space-size=128", "--import", pathToFileURL(require.resolve("tsx")).href,
    fileURLToPath(new URL("./storage-identity-provision-child.ts", import.meta.url))],
    { windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env: process.platform === "win32"
      ? { NODE_ENV: "production", SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } : { NODE_ENV: "production" } });
  child.stdin.end(request);
  return await new Promise<StorageEnrollmentInspection | StorageProvisionReceipt | StorageBackupReceipt>((resolve, reject) => {
    let output = "", failure: string | undefined;
    // A deadline may follow COMMIT: callers must inspect/repeat the same identity, never relabel.
    const timer = setTimeout(() => { failure = "operation_deadline_uncertain_ack"; child.kill("SIGKILL"); }, STORAGE_SNAPSHOT_LIMITS.deadlineMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(output) + chunk.length > 128 * 1024) { failure = "output_limit"; child.kill("SIGKILL"); }
      else output += chunk.toString("utf8");
    });
    child.once("error", () => { clearTimeout(timer); reject(new StorageIdentityRefused("operation_unavailable")); });
    child.once("close", code => {
      clearTimeout(timer);
      if (failure || code !== 0) { reject(new StorageIdentityRefused(failure ?? "operation_unavailable")); return; }
      try {
        const result = JSON.parse(output);
        if (typeof result.refusal === "string" && /^[a-z_]+$/.test(result.refusal)) { reject(new StorageIdentityRefused(result.refusal)); return; }
        resolve(result);
      } catch { reject(new StorageIdentityRefused("operation_unavailable")); }
    });
    child.stdin.once("error", () => { /* close/error determines the result */ });
  });
  } catch (error) {
    if (error instanceof StorageIdentityRefused) throw error;
    return refuseStorage("operation_unavailable");
  }
}
export async function createSqliteStorage(file: string, identity: StorageIdentity): Promise<StorageProvisionReceipt> {
  return await operation("create", file, identity) as StorageProvisionReceipt;
}
export async function inspectSqliteEnrollment(file: string, expected: StorageIdentity): Promise<StorageEnrollmentInspection> {
  return await operation("inspect", file, expected) as StorageEnrollmentInspection;
}
export async function enrollSqliteStorage(file: string, identity: StorageIdentity, reviewed: ReviewedStorageEnrollment): Promise<StorageProvisionReceipt> {
  return await operation("enroll", file, identity, reviewed) as StorageProvisionReceipt;
}
/** Distinct readonly snapshot capability; never grants generic application ATTACH/DDL access. */
export async function backupVerifiedSqliteStorage(source: string, expected: StorageIdentity, freshOutput: string): Promise<StorageBackupReceipt> {
  return await operation("backup", source, expected, undefined, freshOutput) as StorageBackupReceipt;
}

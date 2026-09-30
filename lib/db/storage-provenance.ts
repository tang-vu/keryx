import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const STORAGE_PROVENANCE_LIMITS = Object.freeze({ deadlineMs: 10_000, fileBytes: 64 * 1024 * 1024,
  rows: 20_000, fieldBytes: 16_384, selectedBytes: 8 * 1024 * 1024, schemaObjects: 512, columns: 128 });
export type ProvenanceLimits = { -readonly [K in keyof typeof STORAGE_PROVENANCE_LIMITS]: number };
export interface StorageProvenanceReport {
  format: "keryx-storage-provenance-intake-v1";
  backend: "sqlite";
  status: "intake_only" | "refused";
  reason?: string;
  origin: "unknown_legacy";
  enrollmentAuthorized: false;
  modeIdentityAccepted: false;
  snapshotComplete: boolean;
  evidence?: {
    schemaSha256: string;
    selectedAuthoritySha256: string;
    scannedRows: number;
    selectedBytes: number;
    uninspectedTables: number;
    tables: Record<string, { rows: number; missingSelectedColumns: number }>;
    classifications: Record<string, number>;
    journalActivation: "absent" | "inactive" | "active" | "malformed";
    sidecars: { walBefore: boolean; shmBefore: boolean; walAfter: boolean; shmAfter: boolean };
  };
}
export function refusedProvenance(reason: string): StorageProvenanceReport {
  return { format: "keryx-storage-provenance-intake-v1", backend: "sqlite", status: "refused", reason,
    origin: "unknown_legacy", enrollmentAuthorized: false, modeIdentityAccepted: false, snapshotComplete: false };
}

/** Fixed upper bounds; callers may lower them for a smaller intake only. No environment/config input. */
export async function inspectStorageProvenance(target: string, lowerLimits: Partial<ProvenanceLimits> = {}): Promise<StorageProvenanceReport> {
  const limits: ProvenanceLimits = { ...STORAGE_PROVENANCE_LIMITS };
  for (const [key, value] of Object.entries(lowerLimits)) {
    if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value) || value! < 1 || value! > limits[key as keyof ProvenanceLimits]) return refusedProvenance("invalid_limits");
    limits[key as keyof ProvenanceLimits] = value!;
  }
  // Native SQLite cannot be interrupted by a JS elapsed-time check. Kill an isolated child at the deadline.
  try {
    const require = createRequire(import.meta.url);
    const child = spawn(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href,
      fileURLToPath(new URL("./storage-provenance-child.ts", import.meta.url)), target, JSON.stringify(limits)],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env: process.platform === "win32"
        ? { NODE_ENV: "production", SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } : { NODE_ENV: "production" } });
    return await new Promise<StorageProvenanceReport>(resolve => {
      let output = "", failed: string | undefined;
      const timer = setTimeout(() => { failed = "deadline_exceeded"; child.kill("SIGKILL"); }, limits.deadlineMs);
      child.stdout.on("data", (chunk: Buffer) => {
        if (Buffer.byteLength(output) + chunk.length > 64 * 1024) { failed = "output_limit"; child.kill("SIGKILL"); }
        else output += chunk.toString("utf8");
      });
      child.once("error", () => { clearTimeout(timer); resolve(refusedProvenance("inspection_unavailable")); });
      child.once("close", code => {
        clearTimeout(timer);
        if (failed || code !== 0) { resolve(refusedProvenance(failed ?? "inspection_unavailable")); return; }
        try { resolve(JSON.parse(output) as StorageProvenanceReport); }
        catch { resolve(refusedProvenance("inspection_unavailable")); }
      });
    });
  } catch { return refusedProvenance("inspection_unavailable"); }
}

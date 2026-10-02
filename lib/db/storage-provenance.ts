import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanupSnapshotUnit, launchContainedSnapshot } from "./storage-provenance-containment";

export const STORAGE_PROVENANCE_LIMITS = Object.freeze({ deadlineMs: 10_000, fileBytes: 64 * 1024 * 1024,
  rows: 20_000, fieldBytes: 16_384, selectedBytes: 8 * 1024 * 1024, schemaObjects: 512, columns: 128 });
export const OFFLINE_SNAPSHOT_LIMITS = Object.freeze({ ...STORAGE_PROVENANCE_LIMITS, fileBytes: 512 * 1024 * 1024,
  cacheKiB: 1024 });
export type ProvenanceMode = "standard" | "offline_snapshot";
export type ProvenanceLimits = { -readonly [K in keyof typeof STORAGE_PROVENANCE_LIMITS]: number }
  & { cacheKiB?: number };
export function validatedProvenanceLimits(lowerLimits: unknown, mode: unknown): ProvenanceLimits | undefined {
  if (mode !== "standard" && mode !== "offline_snapshot") return;
  if (!lowerLimits || typeof lowerLimits !== "object" || Array.isArray(lowerLimits)) return;
  const limits: ProvenanceLimits = { ...(mode === "offline_snapshot" ? OFFLINE_SNAPSHOT_LIMITS : STORAGE_PROVENANCE_LIMITS) };
  for (const [key, value] of Object.entries(lowerLimits)) {
    const maximum = limits[key as keyof ProvenanceLimits];
    if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value) || value < 1 || maximum === undefined || value > maximum) return;
    limits[key as keyof ProvenanceLimits] = value;
  }
  return limits;
}
export interface StorageProvenanceReport {
  format: "keryx-storage-provenance-intake-v1";
  backend: "sqlite";
  status: "intake_only" | "refused";
  reason?: string;
  origin: "unknown_legacy";
  enrollmentAuthorized: false;
  modeIdentityAccepted: false;
  snapshotComplete: boolean;
  inspectionMode?: "offline_snapshot";
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
export async function inspectStorageProvenance(target: string, lowerLimits: Partial<ProvenanceLimits> = {}, mode: ProvenanceMode = "standard"): Promise<StorageProvenanceReport> {
  const limits = validatedProvenanceLimits(lowerLimits, mode);
  if (!limits) return refusedProvenance("invalid_limits");
  if (mode === "offline_snapshot" && process.platform !== "linux") return { ...refusedProvenance("native_limits_unavailable"), inspectionMode: "offline_snapshot" };
  // Native SQLite cannot be interrupted by a JS elapsed-time check. Kill an isolated child at the deadline.
  try {
    const require = createRequire(import.meta.url);
    const script = fileURLToPath(new URL("./storage-provenance-child.ts", import.meta.url));
    const loader = require.resolve("tsx");
    const contained = mode === "offline_snapshot" ? launchContainedSnapshot(process.execPath, loader, script, target, limits) : undefined;
    const child = contained?.child ?? spawn(process.execPath, ["--import", pathToFileURL(loader).href,
      script, target, JSON.stringify(limits), mode],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env: process.platform === "win32"
        ? { NODE_ENV: "production", SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } : { NODE_ENV: "production" } });
    return await new Promise<StorageProvenanceReport>(resolve => {
      let output = "", failed: string | undefined;
      const timer = setTimeout(() => { failed = "deadline_exceeded"; child.kill("SIGKILL"); }, limits.deadlineMs);
      child.stdout.on("data", (chunk: Buffer) => {
        if (Buffer.byteLength(output) + chunk.length > 64 * 1024) { failed = "output_limit"; child.kill("SIGKILL"); }
        else output += chunk.toString("utf8");
      });
      let finalizing = false;
      const finalize = async (code: number | null) => {
        if (finalizing) return;
        finalizing = true;
        clearTimeout(timer);
        const cleanup = contained ? await cleanupSnapshotUnit(contained.unit) : undefined;
        if (cleanup && !cleanup.cleaned) { resolve(refusedProvenance("containment_cleanup_unavailable")); return; }
        if (failed || code !== 0) { resolve(refusedProvenance(failed ?? (cleanup?.oom ? "native_resource_limit" : "inspection_unavailable"))); return; }
        try { resolve(JSON.parse(output) as StorageProvenanceReport); }
        catch { resolve(refusedProvenance("inspection_unavailable")); }
      };
      child.once("error", () => { failed = "inspection_unavailable"; child.kill("SIGKILL"); void finalize(null); });
      child.once("close", code => { void finalize(code); });
    });
  } catch { return refusedProvenance("inspection_unavailable"); }
}

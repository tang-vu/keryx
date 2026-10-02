/**
 * Pure snapshot-rotation rule for backup-db.mts. Kept in its own `.ts` module so the unit test can
 * import it directly (the `.mts` script itself is an executable entrypoint, not tsc-checked).
 */

/** Snapshots to delete: everything past the newest `keepN` (names sort chronologically). */
export function prunable(files: string[], keepN: number): string[] {
  if (!Number.isSafeInteger(keepN) || keepN < 1 || keepN > 168) throw new Error("Invalid backup retention.");
  return ["gz", "enc"].flatMap((extension) => files
    .filter((f) => new RegExp(`^keryx-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z\\.sqlite\\.${extension}$`).test(f))
    .sort().reverse().slice(keepN));
}

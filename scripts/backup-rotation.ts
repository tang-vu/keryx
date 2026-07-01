/**
 * Pure snapshot-rotation rule for backup-db.mts. Kept in its own `.ts` module so the unit test can
 * import it directly (the `.mts` script itself is an executable entrypoint, not tsc-checked).
 */

/** Snapshots to delete: everything past the newest `keepN` (names sort chronologically). */
export function prunable(files: string[], keepN: number): string[] {
  return files
    .filter((f) => /^keryx-.*\.sqlite\.gz$/.test(f))
    .sort()
    .reverse()
    .slice(keepN);
}

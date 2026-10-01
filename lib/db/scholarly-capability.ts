import type { DatabaseSync } from "node:sqlite";

/** Inspect capability without loading its signature/registry graph on ordinary/native startup. */
export function hasScholarlyRights(db: DatabaseSync): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='scholarly_enrollments'").get();
}
export function assertNoOrphanedPaperMarker(db: DatabaseSync, sourceId: string): void {
  if (db.prepare("SELECT * FROM sources WHERE id=?").get(sourceId)?.scholarly_enrolled === 1)
    throw new Error("Scholarly history unavailable");
}

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { archiveEntryFromRun, type ArchiveEntry } from "../answers-archive";
import { PrivacyError, privacyId, validatePrivacyRun, type PrivacyList } from "../run-privacy/contracts";
import type { PublicArchiveRow } from "../run-privacy/archive-page";
import { MAX_USAGE_RUNS } from "../usage/contracts";

/** Internal to the guarded privacy port. Select/order/limit metadata before
 * materializing large originals; the same statement still gates every body. */
export function selectPublicRunRows(db: DatabaseSync, query: PrivacyList) {
  const take = z.number().int().min(1).max(2500).parse(query.take);
  const args: (string | number)[] = [];
  let filter = "";
  if (query.before) {
    privacyId.parse(query.before.id);
    filter += " AND (q.created_at<? OR (q.created_at=? AND q.id<?))";
    args.push(query.before.createdAt, query.before.createdAt, query.before.id);
  }
  if (query.parentId) { filter += " AND q.parent_id=?"; args.push(privacyId.parse(query.parentId)); }
  if (query.ids) {
    filter += " AND q.id IN (SELECT value FROM json_each(?))";
    args.push(JSON.stringify(z.array(privacyId).max(MAX_USAGE_RUNS).parse(query.ids)));
  }
  args.push(take);
  return db.prepare(`WITH chosen AS MATERIALIZED (
    SELECT q.id,q.created_at FROM query_runs q JOIN run_privacy p ON p.run_id=q.id
    WHERE p.visibility='public' AND p.erased=0${filter}
    ORDER BY q.created_at DESC,q.id DESC LIMIT ?)
    SELECT q.id,q.created_at,q.data FROM chosen c JOIN query_runs q ON q.id=c.id
    ORDER BY c.created_at DESC,c.id DESC`).all(...args);
}

/** One bounded derived-card cache per privacy port/connection. This is never a
 * publication grant: callers must supply freshly filtered originals every time.
 * No full JSON or run/trace graph is retained. No TTL or publication revision substitutes for comparing the actual original bytes. */
export function createPublicArchiveReader(db: DatabaseSync) {
  const cache = new Map<string, { digest: string; createdAt: string; card: string; bytes: number }>();
  let bytes = 0;
  const project = (row: ReturnType<typeof selectPublicRunRows>[number]): PublicArchiveRow => {
    const id = privacyId.parse(row.id), createdAt = String(row.created_at), original = String(row.data);
    const digest = createHash("sha256").update(original).digest("hex");
    let value = cache.get(id);
    if (!value || value.digest !== digest || value.createdAt !== createdAt) {
      const run = validatePrivacyRun(JSON.parse(original), id);
      if (run.createdAt !== createdAt) throw new PrivacyError("privacy_unavailable");
      // Retain owned, bounded card bytes. Slices of an answer or parsed strings
      // must not keep a much larger original backing string alive in the cache.
      const card = JSON.stringify(archiveEntryFromRun(run));
      value = { digest, createdAt, card, bytes: Buffer.byteLength(card) + id.length + createdAt.length + 128 };
      const previous = cache.get(id);
      if (previous) { bytes -= previous.bytes; cache.delete(id); }
      // Oversized cards remain valid, but are revalidated rather than retained.
      if (value.bytes <= 64 * 1024) {
        while (cache.size && (cache.size >= 4000 || bytes + value.bytes > 8 * 1024 * 1024)) {
          const oldest = cache.keys().next().value!;
          bytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
        }
        cache.set(id, value); bytes += value.bytes;
      }
    }
    // A caller cannot poison later public reads by mutating a returned card.
    return { id, createdAt, entry: JSON.parse(value.card) as ArchiveEntry | null };
  };
  return (query: PrivacyList): PublicArchiveRow[] => {
    z.number().int().min(1).max(32).parse(query.take);
    return selectPublicRunRows(db, query).map(row => project(row));
  };
}

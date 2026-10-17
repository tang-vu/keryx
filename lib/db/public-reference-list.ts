import type { DatabaseSync } from "node:sqlite";
import { publicReferenceSchema, type PublicReference } from "../public-references/catalog";
import { hasPublicReferenceArchive, publicReferenceArchiveTransaction } from "./public-reference-archive";

/** Fresh listing and lifetime counts in one read snapshot. Keep statement guards;
 * avoid a separate archive probe and count statement for every publisher. */
export function listSqlitePublicReferences(db: DatabaseSync): PublicReference[] {
  return publicReferenceArchiveTransaction(db, () => {
    const archive = hasPublicReferenceArchive(db);
    const rows = db.prepare(`SELECT p.id,p.active,p.rss_url,p.snapshot${archive
      ? ",(SELECT count(*) FROM public_reference_articles a WHERE a.reference_id=p.id) AS archived_item_count" : ""}
      FROM public_references p WHERE p.active=1 ORDER BY p.id`).all();
    return rows.map(row => {
      const value = publicReferenceSchema.parse(JSON.parse(String(row.snapshot)));
      if (row.id !== value.id || row.active !== Number(value.active) || row.rss_url !== value.rssUrl)
        throw new Error("Public publisher snapshot identity differs");
      return { ...value, items: value.items.slice(0, 10),
        ...(archive ? { archivedItemCount: Number(row.archived_item_count) } : {}) };
    });
  });
}

import type { KeryxDB } from "../db/keryx-db";
import { APPROVED_PUBLIC_REFERENCES } from "./approved-catalog";
import { fetchPublicReferenceFeed, referenceSnapshot } from "./catalog";

/** Explicit one-time onboarding, independent of the consumed recurring hourly journal. */
export async function importPublicReferenceCatalog(
  db: Pick<KeryxDB, "getSource" | "getPublicReference" | "upsertPublicReference">,
  ingest = fetchPublicReferenceFeed,
) {
  if (!db.getPublicReference || !db.upsertPublicReference) throw new Error("Public reference catalog unsupported");
  const results: { name: string; items: number; ok: boolean }[] = [];
  for (const approved of APPROVED_PUBLIC_REFERENCES) {
    try {
      if (await db.getSource(approved.id)) throw new Error("Reserved public ID collides with a paid source");
      const existing = await db.getPublicReference(approved.id);
      // Preserve explicit operator deactivation; onboarding never silently re-enables a source.
      const reference = { ...approved, active: existing?.active ?? approved.active };
      const snapshot = referenceSnapshot(reference, await ingest(approved.rssUrl));
      if (!snapshot.items.length) throw new Error("Feed has no usable linked content");
      await db.upsertPublicReference(snapshot);
      results.push({ name: reference.name, items: snapshot.items.length, ok: true });
    } catch { results.push({ name: approved.name, items: 0, ok: false }); }
  }
  return results;
}

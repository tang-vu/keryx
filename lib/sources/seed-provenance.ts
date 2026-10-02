import type { DatabaseSync } from "node:sqlite";
import { SEED_SOURCES } from "./seed-data";
import { contentBodyHash } from "./content-receipt";

/** Strong corpus match: article metadata AND exact plaintext/hash, never a display name/ID/domain. */
export function seedProvenanceBackfillSql(): string {
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const predicates = SEED_SOURCES.flatMap(source => source.items ?? []).map(item =>
    `(title=${literal(item.title)} AND summary=${literal(item.summary)} AND link=${literal(item.link)} AND
      (content=${literal(item.content)} OR body_hash=${literal(contentBodyHash(item.content))}))`);
  return `UPDATE source_items SET evidence_provenance='synthetic-demo'
    WHERE evidence_provenance IS NULL AND (${predicates.join(" OR\n")});
    UPDATE sources SET evidence_provenance='synthetic-demo' WHERE evidence_provenance IS NULL
      AND EXISTS (SELECT 1 FROM source_items i WHERE i.source_id=sources.id)
      AND NOT EXISTS (SELECT 1 FROM source_items i WHERE i.source_id=sources.id AND
        (i.evidence_provenance IS NULL OR i.evidence_provenance<>'synthetic-demo'));`;
}

export function backfillSqliteSeedProvenance(db: DatabaseSync): void {
  db.exec(seedProvenanceBackfillSql());
}

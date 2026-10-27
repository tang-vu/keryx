import type { QueryRun } from "../types";
import { englishMessages } from "../i18n/messages";
import { buildEvidenceMatrix } from "../research/evidence-matrix";

/** The complete thirteen-column CSV committed by early native V1/V2 responses.
 * This constructs an expected presentation from an already validated native run.
 * It never parses, truncates, upgrades or removes fields from a stored receipt. */
export function historicalNativeEvidenceCsv(run: QueryRun): string {
  const rows: (string | number)[][] = [["claim_index", "claim", "inspection_status", "source_marker", "source_id",
    "publication", "article_title", "article_url", "published_at", "item_id", "content_version", "exact_excerpt", "evidence_provenance"]];
  for (const row of buildEvidenceMatrix(run)) {
    if (!row.evidence.length) rows.push([row.claimIndex, row.claim, row.status, "", "", "", "", "", "", "", "", "", ""]);
    for (const item of row.evidence) rows.push([row.claimIndex, row.claim, row.status, item.marker, item.sourceId,
      item.sourceName, item.itemTitle ?? englishMessages["evidenceMatrix.notRecorded"], item.itemUrl ?? englishMessages["evidenceMatrix.notRecorded"],
      item.itemPublishedAt ?? englishMessages["evidenceMatrix.notRecorded"], item.itemId ?? englishMessages["evidenceMatrix.notRecorded"],
      item.contentVersion ?? englishMessages["evidenceMatrix.notRecorded"], item.quote,
      item.evidenceProvenance === "synthetic-demo" ? englishMessages["evidenceMatrix.syntheticExport"] : englishMessages["evidenceMatrix.unclassifiedExport"]]);
  }
  // Freeze the historical cell encoding as well as its columns.
  const cell = (value: string | number) => {
    const raw = String(value), safe = /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(raw) ? "'" + raw : raw;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  return rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

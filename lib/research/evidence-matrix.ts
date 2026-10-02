import type { EvidenceRecord, QueryRun } from "../types";

export type EvidenceMatrixInput = Pick<QueryRun, "subClaims" | "citations" | "evidence" | "claimCoverage">;
export interface EvidenceMatrixRow {
  claimIndex: number;
  claim: string;
  status: "Illustrative demo excerpt" | "Recorded excerpt" | "No inspectable excerpt recorded" | "Evidence ledger unavailable";
  evidence: EvidenceRecord[];
}

/** Uses only persisted ledger excerpts already eligible for the citation evidence UI.
 * Missing excerpts are an inspection gap, never a factual verdict on a claim. */
export function buildEvidenceMatrix(run: EvidenceMatrixInput): EvidenceMatrixRow[] {
  const claims = new Map<number, string>();
  // Historical/minimal saved runs may lack the optional presentation ledger.
  // Retain any recorded coverage/evidence below; never invent missing claims.
  (Array.isArray(run.subClaims) ? run.subClaims : []).forEach((claim, index) => claims.set(index, claim));
  for (const record of run.claimCoverage ?? []) {
    if (Number.isInteger(record.claimIndex) && record.claimIndex >= 0 && !claims.has(record.claimIndex)) {
      claims.set(record.claimIndex, record.claim);
    }
  }
  for (const record of run.evidence ?? []) {
    if (Number.isInteger(record.claimIndex) && record.claimIndex >= 0 && !claims.has(record.claimIndex)) {
      claims.set(record.claimIndex, record.claim);
    }
  }
  return [...claims].sort(([a], [b]) => a - b).map(([claimIndex, claim]) => {
    const evidence = (run.evidence ?? []).filter((item) =>
      item.claimIndex === claimIndex && item.claim === claim && ((item.qualifiesForAnswer ?? item.qualifiesForReward) || item.evidenceProvenance === "synthetic-demo") &&
      item.quote.trim().length > 0 && item.quote.length <= 240 &&
      run.citations.some((citation) => citation.marker === item.marker && citation.sourceId === item.sourceId &&
        citation.itemId === item.itemId && citation.contentVersion === item.contentVersion),
    );
    return { claimIndex, claim, evidence, status: evidence.length ? evidence.every(item => item.evidenceProvenance === "synthetic-demo") ? "Illustrative demo excerpt" : "Recorded excerpt" :
      run.evidence === undefined ? "Evidence ledger unavailable" : "No inspectable excerpt recorded" };
  });
}

/** Quote every cell; neutralize spreadsheet formulas even after invisible prefixes. */
export function evidenceCsvCell(value: string | number): string {
  const raw = String(value);
  const safe = /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function evidenceMatrixCsv(run: EvidenceMatrixInput): string {
  const rows: (string | number)[][] = [["claim_index", "claim", "inspection_status", "source_marker", "source_id",
    "publication", "article_title", "article_url", "published_at", "item_id", "content_version", "exact_excerpt", "evidence_provenance"]];
  for (const row of buildEvidenceMatrix(run)) {
    if (!row.evidence.length) rows.push([row.claimIndex, row.claim, row.status, "", "", "", "", "", "", "", "", "", ""]);
    for (const item of row.evidence) rows.push([row.claimIndex, row.claim, row.status, item.marker, item.sourceId,
      item.sourceName, item.itemTitle ?? "Not recorded", item.itemUrl ?? "Not recorded",
      item.itemPublishedAt ?? "Not recorded", item.itemId ?? "Not recorded", item.contentVersion ?? "Not recorded", item.quote, item.evidenceProvenance === "synthetic-demo" ? "Synthetic demo; illustrative only, not factual evidence" : "Not classified as synthetic"]);
  }
  return rows.map((row) => row.map(evidenceCsvCell).join(",")).join("\r\n") + "\r\n";
}

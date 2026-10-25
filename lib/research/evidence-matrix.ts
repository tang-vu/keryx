import type { EvidenceRecord, QueryRun } from "../types";
import { englishMessages } from "../i18n/messages";
import { evidenceReadScope, evidenceReadScopeColumns } from "./evidence-matrix-read-scope";

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
        citation.itemId === item.itemId && citation.itemUrl === item.itemUrl && citation.contentVersion === item.contentVersion),
    );
    // These historical status values also appear in CSV. Use fixed English source
    // literals, never a selected translation or a changed machine status union.
    return { claimIndex, claim, evidence, status: evidence.length ? evidence.every(item => item.evidenceProvenance === "synthetic-demo") ? englishMessages["evidenceMatrix.statusIllustrative"] : englishMessages["evidenceMatrix.statusRecorded"] :
      run.evidence === undefined ? englishMessages["evidenceMatrix.statusUnavailable"] : englishMessages["evidenceMatrix.statusMissing"] };
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
    "publication", "article_title", "article_url", "published_at", "item_id", "content_version", "exact_excerpt", "evidence_provenance",
    ...evidenceReadScopeColumns.map(([key]) => key)]];
  for (const row of buildEvidenceMatrix(run)) {
    if (!row.evidence.length) rows.push([row.claimIndex, row.claim, row.status, "", "", "", "", "", "", "", "", "", "",
      ...evidenceReadScopeColumns.map(() => "")]);
    for (const item of row.evidence) {
      const scope = evidenceReadScope(item);
      rows.push([row.claimIndex, row.claim, row.status, item.marker, item.sourceId,
      item.sourceName, item.itemTitle ?? englishMessages["evidenceMatrix.notRecorded"], item.itemUrl ?? englishMessages["evidenceMatrix.notRecorded"],
      item.itemPublishedAt ?? englishMessages["evidenceMatrix.notRecorded"], item.itemId ?? englishMessages["evidenceMatrix.notRecorded"], item.contentVersion ?? englishMessages["evidenceMatrix.notRecorded"], item.quote, item.evidenceProvenance === "synthetic-demo" ? englishMessages["evidenceMatrix.syntheticExport"] : englishMessages["evidenceMatrix.unclassifiedExport"],
      ...evidenceReadScopeColumns.map(([key]) => scope[key])]);
    }
  }
  return rows.map((row) => row.map(evidenceCsvCell).join(",")).join("\r\n") + "\r\n";
}

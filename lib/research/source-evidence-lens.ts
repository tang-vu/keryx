import type { EvidenceRecord } from "../types";
import { buildEvidenceMatrix, type EvidenceMatrixInput } from "./evidence-matrix";
import { hasKnownSyntheticFingerprint } from "./evidence-provenance";

export interface SourceEvidenceLensRow {
  claimIndex: number;
  claim: string;
  originalExcerpts: number;
  remaining: EvidenceRecord[];
  state: "unavailable" | "already-missing" | "lost-last-excerpt" | "retained";
}

export interface SourceEvidenceLensModel {
  available: boolean;
  sources: { sourceId: string; sourceName: string }[];
  omittedSourceId: string | null;
  newlyMissingTargets: number;
  alreadyMissingTargets: number;
  rows: SourceEvidenceLensRow[];
}

/** A local inspection of the original excerpt ledger, never an alternative
 * answer, entailment grade, independent-source count or payment calculation. */
export function buildSourceEvidenceLens(run: EvidenceMatrixInput, omitSourceId: string | null = null): SourceEvidenceLensModel {
  const available = Array.isArray(run.evidence);
  const isDemo = (item: EvidenceMatrixInput["citations"][number] | EvidenceRecord) =>
    item.evidenceProvenance === "synthetic-demo" || hasKnownSyntheticFingerprint(item);
  // Match the public provenance demotion: a synthetic marker cannot acquire
  // factual authority through another record using the same marker.
  const demoMarkers = new Set([
    ...run.citations.filter(isDemo).map(item => item.marker),
    ...(run.evidence ?? []).filter(isDemo).map(item => item.marker),
  ]);
  const matrix = buildEvidenceMatrix({ ...run,
    citations: run.citations.filter(item => !demoMarkers.has(item.marker)),
    evidence: available ? run.evidence!.filter(item => !demoMarkers.has(item.marker)) : undefined,
  });
  const sourceNames = new Map<string, string>();
  const originalRows = matrix.map(row => {
    const unique = new Map<string, EvidenceRecord>();
    for (const item of row.evidence) {
      if (!item.sourceId.trim() || !item.marker.trim()) continue;
      const key = JSON.stringify([item.sourceId, item.itemId ?? null, item.contentVersion ?? null, item.quote]);
      if (!unique.has(key)) unique.set(key, item);
      if (!sourceNames.has(item.sourceId)) sourceNames.set(item.sourceId, item.sourceName.trim() || item.sourceId);
    }
    return { ...row, evidence: [...unique.values()] };
  });
  const omittedSourceId = omitSourceId !== null && sourceNames.has(omitSourceId) ? omitSourceId : null;
  const rows: SourceEvidenceLensRow[] = originalRows.map(row => {
    const remaining = row.evidence.filter(item => item.sourceId !== omittedSourceId);
    return { claimIndex: row.claimIndex, claim: row.claim, originalExcerpts: row.evidence.length, remaining,
      state: !available ? "unavailable" : row.evidence.length === 0 ? "already-missing" :
        remaining.length === 0 ? "lost-last-excerpt" : "retained" };
  });
  return { available, sources: [...sourceNames].map(([sourceId, sourceName]) => ({ sourceId, sourceName })),
    omittedSourceId, rows,
    newlyMissingTargets: rows.filter(row => row.state === "lost-last-excerpt").length,
    alreadyMissingTargets: rows.filter(row => row.state === "already-missing").length };
}

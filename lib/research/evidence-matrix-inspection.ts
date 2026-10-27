import { normalizeSearchText } from "../normalize-search-text";
import type { EvidenceMatrixRow } from "./evidence-matrix";
import type { QueryRun } from "../types";

type Source = QueryRun["citations"][number];
type Identity = Pick<Source, "marker" | "sourceId" | "itemId" | "itemUrl" | "contentVersion">;
export type MatrixInspectionState = "all" | "with-excerpts" | "without-excerpts";
export interface MatrixInspectionFilters {
  query: string;
  source: string;
  state: MatrixInspectionState;
}

/** A marker or publisher alone cannot identify separately retained article versions. */
export function matrixSourceIdentity(source: Identity): string {
  return JSON.stringify({ marker: source.marker, sourceId: source.sourceId, itemId: source.itemId,
    itemUrl: source.itemUrl, contentVersion: source.contentVersion });
}

/** Filters the existing presentation ledger; never qualifies evidence or changes its status. */
export function inspectEvidenceMatrix(rows: EvidenceMatrixRow[], filters: MatrixInspectionFilters): EvidenceMatrixRow[] {
  const tokens = normalizeSearchText(filters.query).trim().split(/\s+/u).filter(Boolean);
  return rows.filter(row => {
    if (filters.state === "with-excerpts" && row.evidence.length === 0) return false;
    if (filters.state === "without-excerpts" && row.evidence.length > 0) return false;
    const excerpts = filters.source ? row.evidence.filter(item => matrixSourceIdentity(item) === filters.source) : row.evidence;
    if (filters.source && excerpts.length === 0) return false;
    if (!tokens.length) return true;
    const text = normalizeSearchText([row.claim, ...excerpts.flatMap(item => [item.quote, item.marker, item.sourceName,
      item.itemTitle ?? "", item.itemUrl ?? "", item.contentVersion ?? "", item.itemId ?? "", item.itemPublishedAt ?? ""])].join("\n"));
    return tokens.every(token => text.includes(token));
  });
}

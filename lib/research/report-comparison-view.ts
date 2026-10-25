import type { ComparedTarget, ReportComparison } from "./report-comparison";

export const COMPARISON_FILTERS = ["all", "changes", "gaps", "unmatched"] as const;
export type ComparisonFilter = typeof COMPARISON_FILTERS[number];
export interface IndexedComparisonTarget {
  target: ComparedTarget;
  /** Position in the full comparison, never the filtered position. */
  index: number;
  fields: string[];
}

const searchable = (text: string) => text.normalize("NFC").toLowerCase();

/** Only already-inspected, retained fields enter the local index. No source fetch
 * or semantic matching, and no changes to the receipt or comparison artifact. */
export function indexComparisonTargets(comparison: ReportComparison): IndexedComparisonTarget[] {
  return comparison.targets.map((target, index) => ({ target, index,
    fields: [target.before, target.after].flatMap(side => side ? [side.claim,
      ...side.excerpts.flatMap(row => [row.marker, row.sourceId, row.sourceName, row.itemId,
        row.itemTitle, row.itemUrl, row.contentVersion, row.quote].filter((value): value is string => typeof value === "string")),
    ] : []).map(searchable),
  }));
}

export function matchesComparisonFilter(target: ComparedTarget, filter: ComparisonFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "changes": return target.state === "recorded-excerpts-changed" || target.state === "read-context-changed";
    // An absent paired target is unmatched, not evidence that a report lost a
    // source. An existing target with no inspectable rows is an evidence gap.
    case "gaps": return target.state === "comparison-unavailable"
      || [target.before, target.after].some(side => side !== null && (!side.ledgerAvailable || side.excerpts.length === 0));
    case "unmatched": return target.before === null || target.after === null;
  }
}

export function filterComparisonTargets(index: IndexedComparisonTarget[], filter: ComparisonFilter, query: string): IndexedComparisonTarget[] {
  const needle = searchable(query.trim());
  return index.filter(row => matchesComparisonFilter(row.target, filter)
    && (!needle || row.fields.some(field => field.includes(needle))));
}

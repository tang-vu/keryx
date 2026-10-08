import type { CitedStatement } from "./cited-statements";
import type { EvidenceLedger } from "./evidence-ledger";

/** Presentation only: retain each sentence/excerpt pair and connect source-bound rows.
 * A shared target or literal nested excerpt permits one item without adding a
 * relationship between statements. Different sources/versions stay separate.
 */
export function compactStatementGroups(summary: CitedStatement[], qualifying: EvidenceLedger["evidence"]): CitedStatement[][] | undefined {
  const bindings = summary.map(statement => {
    const rows = qualifying.filter(item => item.claimIndex === statement.claimIndex &&
      item.marker === statement.marker && item.quote === statement.quote);
    if (!rows.length || rows.some(item => !item.sourceId)) return undefined;
    const identities = new Set(rows.map(item => JSON.stringify([item.sourceId, item.itemId ?? null,
      item.itemUrl ?? null, item.contentVersion ?? null])));
    return identities.size === 1 ? [...identities][0] : undefined;
  });
  if (bindings.some(binding => binding === undefined)) return undefined;
  const parents = summary.map((_, index) => index);
  const root = (index: number): number => {
    while (parents[index] !== index) index = parents[index];
    return index;
  };
  for (let left = 0; left < summary.length; left++) {
    for (let right = left + 1; right < summary.length; right++) {
      const a = summary[left], b = summary[right];
      if (a.marker === b.marker && bindings[left] === bindings[right] &&
          (a.claimIndex === b.claimIndex || a.quote.includes(b.quote) || b.quote.includes(a.quote))) {
        const first = root(left), second = root(right);
        parents[Math.max(first, second)] = Math.min(first, second);
      }
    }
  }
  const groups = new Map<number, CitedStatement[]>();
  summary.forEach((statement, index) => {
    const key = root(index), group = groups.get(key) ?? [];
    group.push(statement);
    groups.set(key, group);
  });
  return [...groups.values()];
}

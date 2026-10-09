import type { CitedStatement } from "./cited-statements";
import type { EvidenceLedger } from "./evidence-ledger";
import { statementPresentationItem } from "../llm/quote-presentation-item";

/** Presentation only: retain each sentence/excerpt pair and connect source-bound rows.
 * A shared target or literal nested excerpt permits one item without adding a
 * relationship between statements. Different sources/versions stay separate.
 * A process-local exact short-item observation can also link separate quotes;
 * its structural grouping is not semantic entailment or restored receipt authority.
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
  const items = summary.map(statement => statementPresentationItem(statement, qualifying));
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
  // Preserve existing groups first. A new item edge may join only components
  // whose every member belongs to that exact item; shared-target transitivity
  // must not pull in another block or a sentence without its own observation.
  const componentItems = new Map<number, string | undefined>();
  summary.forEach((_, index) => {
    const component = root(index), item = items[index];
    if (!componentItems.has(component)) componentItems.set(component, item);
    else if (componentItems.get(component) !== item) componentItems.set(component, undefined);
  });
  const itemRoots = new Map<string, number>();
  for (const [component, item] of componentItems) {
    if (item === undefined) continue;
    const previous = itemRoots.get(item);
    if (previous === undefined) itemRoots.set(item, component);
    else {
      const first = root(previous), second = root(component);
      parents[Math.max(first, second)] = Math.min(first, second);
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

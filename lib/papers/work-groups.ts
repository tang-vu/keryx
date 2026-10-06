import { createHash } from "node:crypto";
import type { PaperGroup, PaperRecord } from "./types";

/** Observed identifiers only; titles/author similarities never establish one work. */
export function groupPaperWorks(records: readonly PaperRecord[]): PaperGroup[] {
  const parents = records.map((_, index) => index), keys = new Map<string, number>();
  const root = (value: number): number => parents[value] === value ? value : (parents[value] = root(parents[value]));
  records.forEach((record, index) => {
    const identities = [`url:${record.url}`, ...(record.doi ? [`doi:${record.doi}`] : []),
      ...(record.arxivId ? [`arxiv:${record.arxivId.replace(/v\d+$/, "")}`] : [])];
    for (const key of identities) {
      const previous = keys.get(key);
      if (previous !== undefined) parents[root(index)] = root(previous);
      else keys.set(key, index);
    }
  });
  const groups = new Map<number, PaperRecord[]>();
  records.forEach((record, index) => {
    const key = root(index), group = groups.get(key) ?? [];
    // Distinct observed versions/metadata remain inspectable; exact duplicate input is redundant.
    if (!group.some(existing => JSON.stringify(existing) === JSON.stringify(record))) group.push(record);
    groups.set(key, group);
  });
  return [...groups.values()].map(group => ({
    id: `paper:${createHash("sha256").update([...new Set(group.map(record => record.doi ?? record.arxivId?.replace(/v\d+$/, "") ?? record.url))].sort().join("\n")).digest("hex")}`,
    record: group[0], records: group,
  }));
}

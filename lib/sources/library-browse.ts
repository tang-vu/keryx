import { getDomain } from "tldts";
import { EXPLORE_SOURCE_TOPICS } from "../public-references/explore-catalog";

export const LIBRARY_TOPICS = {
  ...EXPLORE_SOURCE_TOPICS,
  other: "Other topics",
} as const;
export const LIBRARY_KINDS = {
  explore: "Publisher directory",
  feed: "Retained feeds",
  cited: "Cited documents",
  creator: "Creator listings",
} as const;
export type LibraryTopic = keyof typeof LIBRARY_TOPICS;
export type LibraryKind = keyof typeof LIBRARY_KINDS;
export interface LibraryFilters {
  q: string;
  topic: LibraryTopic | "all";
  kind: LibraryKind | "all";
  sort: "default" | "name" | "recent";
}
export interface LibraryRecord {
  id: string;
  name: string;
  url: string;
  description?: string;
  tags?: readonly string[];
  itemTitles?: readonly string[];
  topic?: LibraryTopic;
  kind: LibraryKind;
  observedAt?: string;
}

/** Presentation hints from titles/tags only; never evidence or publisher authority. */
const TOPIC_HINTS: Record<Exclude<LibraryTopic, "other">, RegExp> = {
  "ai-agents": /\b(ai|agents?|llms?|models?|machine learning|neural|inference|evaluation|prompt|anthropic|openai|hugging face)\b/i,
  "data-infrastructure": /\b(data|database|sqlite|postgres\w*|sql|infra\w*|cloud|workers?|queues?|sqs|retry|retries|idempoten\w*|node\.?js|systemd|security|ssrf|owasp|kubernetes|linux|server|engineering|distributed|storage|backup|wal|observability|network)\b/i,
  payments: /\b(payments?|pay|usdc|stablecoins?|circle|arc|gateway|x402|stripe|wallets?|fintech|settlement|commerce)\b/i,
  "creator-research": /\b(creators?|publish\w*|writing|research|scholar\w*|papers?|arxiv|crossref|youtube|children|songs|education|open access|copyright)\b/i,
};

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : value?.[0] ?? "";
}
export function parseLibraryFilters(params: Record<string, string | string[] | undefined>): LibraryFilters {
  const topic = first(params.topic), kind = first(params.kind), sort = first(params.sort);
  return {
    q: first(params.q).trim().slice(0, 120),
    topic: Object.hasOwn(LIBRARY_TOPICS, topic) ? topic as LibraryTopic : "all",
    kind: Object.hasOwn(LIBRARY_KINDS, kind) ? kind as LibraryKind : "all",
    sort: sort === "name" || sort === "recent" ? sort : "default",
  };
}

export function libraryTopicHints(record: LibraryRecord): LibraryTopic[] {
  if (record.topic) return [record.topic];
  const text = [record.name, record.url, record.description, ...record.tags ?? []].join(" ");
  const topics = (Object.keys(TOPIC_HINTS) as Exclude<LibraryTopic, "other">[]).filter(topic => TOPIC_HINTS[topic].test(text));
  return topics.length ? topics : ["other"];
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}
/** Literal AND-token matching, bounded and independent of regex syntax supplied by a visitor. */
export function librarySearchMatches(record: LibraryRecord, query: string): boolean {
  const text = normalize([record.name, record.url, record.description, ...record.tags ?? []].join(" "));
  const terms = normalize(query).split(/\s+/u).filter(Boolean);
  const matches = (candidate: string) => terms.every(term => candidate.includes(term));
  return matches(text) || !!record.itemTitles?.some(title => matches(`${text} ${normalize(title)}`));
}

export function browseLibrary<T extends LibraryRecord>(records: readonly T[], filters: LibraryFilters): T[] {
  const selected = records.filter(record => (filters.kind === "all" || record.kind === filters.kind)
    && (filters.topic === "all" || libraryTopicHints(record).includes(filters.topic))
    && librarySearchMatches(record, filters.q));
  if (filters.sort === "name") selected.sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id));
  if (filters.sort === "recent") selected.sort((a, b) => observationTime(b) - observationTime(a)
    || a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id));
  return selected;
}

/** Show each directory topic near the top without changing order within a topic. */
export function spreadLibraryTopics<T extends LibraryRecord>(records: readonly T[]): T[] {
  const groups = new Map<LibraryTopic, T[]>();
  for (const record of records) {
    const topic = record.topic ?? "other";
    const group = groups.get(topic) ?? [];
    group.push(record);
    groups.set(topic, group);
  }
  const result: T[] = [];
  for (let index = 0; index < Math.max(0, ...[...groups.values()].map(group => group.length)); index++) {
    for (const group of groups.values()) if (group[index]) result.push(group[index]);
  }
  return result;
}
function observationTime(record: LibraryRecord): number {
  const value = Date.parse(record.observedAt ?? "");
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

/** Domain groups describe breadth, not independently verified publishers or ownership. */
export function libraryPublisherGroups(records: readonly LibraryRecord[]): number {
  const groups = new Set<string>();
  for (const record of records) {
    try {
      const url = new URL(record.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
      groups.add(getDomain(url.hostname, { allowPrivateDomains: true }) ?? url.hostname.toLowerCase());
    } catch { /* Listings without a public URL do not imply a publisher. */ }
  }
  return groups.size;
}

export function libraryBrowseHref(filters: LibraryFilters, changes: Partial<LibraryFilters> = {}): string {
  const next = { ...filters, ...changes }, params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.topic !== "all") params.set("topic", next.topic);
  if (next.kind !== "all") params.set("kind", next.kind);
  if (next.sort !== "default") params.set("sort", next.sort);
  return `/sources${params.size ? `?${params}` : ""}#browse-sources`;
}

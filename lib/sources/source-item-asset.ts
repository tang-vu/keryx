import { createHash } from "node:crypto";

import type { SourceItem, SourceItemIdentity } from "../types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? [],
  );
}

function overlapScore(needle: Set<string>, haystack: string): number {
  const candidateTokens = tokens(haystack);
  let matches = 0;
  for (const token of needle) {
    if (candidateTokens.has(token)) matches += 1;
  }
  return matches;
}

/** Candidate id shown to the reasoning engine; payout authority still uses sourceId. */
export function sourceItemAssetId(itemId: string): string {
  return `item:${itemId}`;
}

/** Immutable version for receipts and cache invalidation. IPFS CIDs already address content. */
export function sourceItemContentVersion(item: SourceItem): string {
  if (item.ipfsCid) return `ipfs:${item.ipfsCid}`;
  return `sha256:${sha256(
    JSON.stringify([
      item.id,
      item.sourceId,
      item.title,
      item.link,
      item.publishedAt ?? "",
      item.summary,
      item.content,
    ]),
  )}`;
}

export function sourceItemIdentity(item: SourceItem): SourceItemIdentity {
  return {
    itemId: item.id,
    itemTitle: item.title,
    itemUrl: item.link,
    contentVersion: sourceItemContentVersion(item),
    ...(item.publishedAt ? { itemPublishedAt: item.publishedAt } : {}),
  };
}

/** Paid delivery must echo the exact identity selected before signing. */
export function matchesSourceItemIdentity(
  value: unknown,
  expected: SourceItemIdentity,
): boolean {
  if (!value || typeof value !== "object") return false;
  const actual = value as Partial<SourceItemIdentity>;
  return (
    actual.itemId === expected.itemId &&
    actual.itemTitle === expected.itemTitle &&
    actual.itemUrl === expected.itemUrl &&
    actual.contentVersion === expected.contentVersion &&
    actual.itemPublishedAt === expected.itemPublishedAt
  );
}

export function sourceItemCacheKey(sourceId: string, item: SourceItem): string {
  return `article:${sha256(
    `${sourceId}\0${item.id}\0${sourceItemContentVersion(item)}`,
  )}`;
}

/**
 * Pick one article per publication using only free discovery metadata. getItems() is newest-first,
 * so equal scores deliberately keep the newest article.
 */
export function selectRelevantSourceItem(
  question: string,
  subClaims: string[],
  sourceTags: string[],
  items: SourceItem[],
): SourceItem | null {
  if (items.length === 0) return null;

  const queryTokens = tokens([question, ...subClaims, ...sourceTags].join(" "));
  let best = items[0];
  let bestScore = -1;

  for (const item of items) {
    const score =
      overlapScore(queryTokens, item.title) * 4 +
      overlapScore(queryTokens, item.summary) * 1.5;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return best;
}

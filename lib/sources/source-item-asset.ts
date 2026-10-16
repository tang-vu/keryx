import { createHash } from "node:crypto";

import type { SourceItem, SourceItemIdentity } from "../types";
import { canonicalUrl } from "../web-research/url-identity";
import { contentReceipt } from "./content-receipt";

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
    ...(item.evidenceProvenance ? { evidenceProvenance: item.evidenceProvenance } : {}),
    itemId: item.id,
    itemTitle: item.title,
    itemUrl: item.link,
    contentVersion: sourceItemContentVersion(item),
    ...(item.publishedAt ? { itemPublishedAt: item.publishedAt } : {}),
    contentReceipt: contentReceipt(item),
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
    actual.itemPublishedAt === expected.itemPublishedAt &&
    (!expected.contentReceipt ||
      JSON.stringify(actual.contentReceipt) === JSON.stringify(expected.contentReceipt))
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

/**
 * Keep the existing overall choice, then offer at most two complementary articles.
 * Extra choices must improve a target's metadata score and add a previously unmatched
 * target term. Publisher tags and paid bodies cannot earn an additional slot.
 */
export function selectRelevantSourceItems(
  question: string,
  subClaims: string[],
  sourceTags: string[],
  items: SourceItem[],
): SourceItem[] {
  const best = selectRelevantSourceItem(question, subClaims, sourceTags, items);
  if (!best) return [];

  const targets = subClaims.map(tokens);
  const ranked = items.map(item => ({
    item,
    document: canonicalUrl(item.link) ?? item.link,
    metadata: tokens(`${item.title} ${item.summary}`),
    scores: targets.map(target => overlapScore(target, item.title) * 4 + overlapScore(target, item.summary) * 1.5),
  }));
  const selected = [ranked.find(candidate => candidate.item === best)!];
  while (selected.length < 3) {
    const coveredTerms = new Set(selected.flatMap(candidate => [...candidate.metadata]));
    const coveredScores = targets.map((_, index) => Math.max(...selected.map(candidate => candidate.scores[index])));
    let next: typeof ranked[number] | undefined;
    let bestGain = 0;
    for (const candidate of ranked) {
      if (selected.some(existing => existing.item.id === candidate.item.id || existing.document === candidate.document)) continue;
      const gain = targets.reduce((total, target, index) => {
        const addsTerm = [...target].some(token => candidate.metadata.has(token) && !coveredTerms.has(token));
        return total + (addsTerm ? Math.max(0, candidate.scores[index] - coveredScores[index]) : 0);
      }, 0);
      // Equal scores retain the catalog's newest-first ordering.
      if (gain > bestGain) { next = candidate; bestGain = gain; }
    }
    if (!next) break;
    selected.push(next);
  }
  return selected.map(candidate => candidate.item);
}

import type { PublicReference } from "./catalog";

export type PublicReferenceItem = PublicReference["items"][number];
export type PublicReferenceCollectionKind = "feed" | "article";
export interface PublicReferenceArticle extends PublicReferenceItem {
  referenceId: string;
  firstCollectedAt: string;
  lastCollectedAt: string;
  collectionKind: PublicReferenceCollectionKind;
  contentVersion: string;
}
export interface PublicReferenceQuery {
  referenceId?: string;
  query?: string;
  cursor?: string;
  limit?: number;
  match?: "all" | "any";
  sort?: "recent" | "oldest" | "relevance";
}
export interface PublicReferencePage {
  items: PublicReferenceArticle[];
  total: number;
  nextCursor?: string;
}
export interface PublicReferenceArchiveStats {
  articles: number;
  publishers: number;
  oldestPublishedAt?: string;
  newestPublishedAt?: string;
}
export interface PublicReferenceArchiveDb {
  queryPublicReferenceItems?(options: PublicReferenceQuery): Promise<PublicReferencePage>;
  publicReferenceArchiveStats?(): Promise<PublicReferenceArchiveStats>;
  archivePublicReferenceItems?(referenceId: string, items: PublicReferenceItem[],
    kind: PublicReferenceCollectionKind, observedAt?: string): Promise<{ added: number; updated: number }>;
}

const STOP_WORDS = new Set("a an and are as at be by for from how in is it of on or that the this to what when where which who why with một những các của và là về cho có được này như để thì trong khi".split(" "));
/** Literal normalized words, never executable MATCH/regex syntax from a caller. */
export function archiveSearchTerms(value: string): string[] {
  return [...new Set(value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)
    ?.filter(term => term.length > 1 && term.length <= 100 && !STOP_WORDS.has(term)) ?? [])];
}

export function publicArticleAssetId(referenceId: string, itemId: string): string {
  return `${referenceId}:article:${itemId.replace(/^public-item:/, "")}`;
}

import type { KeryxDB } from "../db/keryx-db";
import type { ArticleOffer, SourceItemIdentity } from "../types";
import { sourceFetchTerms } from "../registry/source-fetch-payto";
import { normalizePreviewDepth, previewSummary } from "../sources/preview-depth";
import { sourceItemAssetId, sourceItemIdentity } from "../sources/source-item-asset";
import { serializableArticleOfferTypedData } from "./article-offer";
import { articlePaidPath, resolveValidArticleOffer } from "./resolve-article-offer";

export interface ArticleMarketEntry extends SourceItemIdentity {
  assetId: string;
  sourceId: string;
  sourceName: string;
  sourceDescription: string;
  sourceTags: string[];
  summary?: string;
  priceUsdc: number;
  listPriceUsdc: number;
  savingsUsdc: number;
  savingsPercent: number;
  paidPath: string;
  offer?: ArticleOffer & {
    typedData: ReturnType<typeof serializableArticleOfferTypedData>;
  };
}

function words(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((w) => w.length > 1) ?? [];
}

function relevance(query: string, entry: ArticleMarketEntry): number {
  if (!query.trim()) return 0;
  const haystack = new Set(words([
    entry.sourceName,
    entry.itemTitle,
    entry.summary ?? "",
    ...entry.sourceTags,
  ].join(" ")));
  return words(query).reduce((score, word) => score + (haystack.has(word) ? 1 : 0), 0);
}

/** Public, payment-safe article listings. Never reads or returns paid content. */
export async function listArticleMarket(
  db: KeryxDB,
  options: { query?: string; limit?: number } = {},
): Promise<ArticleMarketEntry[]> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const sources = (await db.listSources()).filter(
    (source) => source.verified !== false && source.active !== false,
  );
  const entries: ArticleMarketEntry[] = [];

  for (const source of sources) {
    const terms = await sourceFetchTerms(source);
    if (!terms.active) continue;
    const depth = normalizePreviewDepth(source.previewDepth);
    const items = (await db.getItems(source.id)).slice(0, 5);
    for (const item of items) {
      const identity = sourceItemIdentity(item);
      const resolved = await resolveValidArticleOffer(db, source, item, terms);
      const priceUsdc = resolved?.ref.priceUsdc ?? terms.listPriceUsdc;
      const savingsUsdc = Math.max(0, terms.listPriceUsdc - priceUsdc);
      const summary = previewSummary(item.summary, depth);
      entries.push({
        assetId: sourceItemAssetId(item.id),
        sourceId: source.id,
        sourceName: source.name,
        sourceDescription: source.description,
        sourceTags: source.tags,
        ...identity,
        ...(summary ? { summary } : {}),
        priceUsdc,
        listPriceUsdc: terms.listPriceUsdc,
        savingsUsdc,
        savingsPercent:
          terms.listPriceUsdc > 0
            ? Math.round((savingsUsdc / terms.listPriceUsdc) * 10_000) / 100
            : 0,
        paidPath: articlePaidPath({
          sourceId: source.id,
          itemId: item.id,
          contentVersion: identity.contentVersion,
          offerId: resolved?.offer.id,
          listPriceUsdc: resolved?.ref.listPriceUsdc,
        }),
        ...(resolved
          ? {
              offer: {
                ...resolved.offer,
                typedData: serializableArticleOfferTypedData({
                  sourceId: resolved.offer.sourceId,
                  itemId: resolved.offer.itemId,
                  contentVersion: resolved.offer.contentVersion,
                  priceUsdc6: resolved.offer.priceUsdc6,
                  expiresAt: resolved.offer.expiresAt,
                  nonce: resolved.offer.nonce as `0x${string}`,
                }),
              },
            }
          : {}),
      });
    }
  }

  const query = options.query?.trim() ?? "";
  return entries
    .map((entry) => ({ entry, score: relevance(query, entry) }))
    .filter(({ score }) => !query || score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.entry.savingsPercent !== b.entry.savingsPercent) {
        return b.entry.savingsPercent - a.entry.savingsPercent;
      }
      return (b.entry.itemPublishedAt ?? "").localeCompare(a.entry.itemPublishedAt ?? "");
    })
    .slice(0, limit)
    .map(({ entry }) => entry);
}

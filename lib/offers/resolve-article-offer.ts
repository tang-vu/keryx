import type { KeryxDB } from "../db/keryx-db";
import type {
  ArticleOffer,
  ArticleOfferRef,
  Source,
  SourceItem,
} from "../types";
import type { SourceFetchTerms } from "../registry/source-fetch-payto";
import { validateArticleOffer } from "./article-offer";

export interface ResolvedArticleOffer {
  offer: ArticleOffer;
  ref: ArticleOfferRef;
}

/** Invalid, expired, stale-version, or tampered offers silently fall back to list price. */
export async function resolveValidArticleOffer(
  db: KeryxDB,
  source: Source,
  item: SourceItem,
  terms: SourceFetchTerms,
): Promise<ResolvedArticleOffer | null> {
  // A handful of isolated/custom KeryxDB implementations predate the additive offer methods.
  // They remain list-price-only rather than breaking the core reading path during rollout.
  if (typeof db.getArticleOffer !== "function") return null;
  // A signed discount changes the exact amount. Unlike the historical list-price liveness
  // fallback, it must not activate while an on-chain creator/ceiling cannot be established.
  if (source.onchainId && (terms.authority !== "onchain" || terms.stale)) return null;
  const offer = await db.getArticleOffer(source.id, item.id);
  if (!offer) return null;
  const validity = await validateArticleOffer({
    offer,
    item,
    sourceId: source.id,
    expectedSigner: terms.creator,
    listPriceUsdc: terms.listPriceUsdc,
  });
  return validity.valid ? { offer, ref: validity.ref } : null;
}

export function articlePaidPath(args: {
  sourceId: string;
  itemId: string;
  contentVersion: string;
  offerId?: string;
  listPriceUsdc?: number;
}): string {
  const path = `/api/source/${args.sourceId}/item/${encodeURIComponent(args.itemId)}`;
  const params = new URLSearchParams({ version: args.contentVersion });
  if (args.offerId) {
    params.set("offer", args.offerId);
    if (args.listPriceUsdc !== undefined) {
      params.set("listPriceUsdc6", String(Math.round(args.listPriceUsdc * 1_000_000)));
    }
  }
  return `${path}?${params.toString()}`;
}

export * from "./article-offer-proof";
import {
  validateArticleOfferProof,
  type ArticleOfferValidity,
} from "./article-offer-proof";
import { sourceItemContentVersion } from "../sources/source-item-asset";
import type { ArticleOffer, SourceItem } from "../types";
export async function validateArticleOffer(args: {
  offer: ArticleOffer;
  item: SourceItem;
  sourceId: string;
  expectedSigner: string;
  listPriceUsdc: number;
  nowSeconds?: number;
}): Promise<ArticleOfferValidity> {
  return validateArticleOfferProof({
    offer: args.offer,
    sourceId: args.sourceId,
    itemId: args.item.id,
    contentVersion: sourceItemContentVersion(args.item),
    expectedSigner: args.expectedSigner,
    listPriceUsdc: args.listPriceUsdc,
    nowSeconds: args.nowSeconds,
  });
}

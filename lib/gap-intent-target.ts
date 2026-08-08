/** Revalidate creator authority and immutable article coordination before treasury spend. */

import type { KeryxDB } from "./db/keryx-db";
import { resolveValidArticleOffer } from "./offers/resolve-article-offer";
import { sourceFetchTerms } from "./registry/source-fetch-payto";
import { sourceItemContentVersion } from "./sources/source-item-asset";
import type { GapIntent } from "./types";

export interface GapIntentTarget {
  sourceId: string;
  itemId: string;
  contentVersion: string;
  articleOfferId?: string;
}

export class StaleGapIntentTargetError extends Error {}

export async function validateGapIntentTarget(
  db: Pick<KeryxDB, "getSource" | "getItem" | "getArticleOffer">,
  intent: GapIntent,
): Promise<GapIntentTarget | undefined> {
  const source = await db.getSource(intent.sourceId);
  if (!source || source.active === false || source.verified === false) {
    throw new StaleGapIntentTargetError("The offered source is no longer active and verified.");
  }

  // Legacy registration-era rows carried only a source URL and used its payout wallet as owner.
  if (!intent.itemId || !intent.contentVersion) {
    if (source.walletAddress.toLowerCase() !== intent.ownerWallet.toLowerCase()) {
      throw new StaleGapIntentTargetError("Legacy offer owner no longer matches its source wallet.");
    }
    return undefined;
  }

  const terms = await sourceFetchTerms(source, { refresh: true });
  if (source.onchainId && (terms.authority !== "onchain" || terms.stale)) {
    throw new Error("SourceRegistry creator authority is temporarily unavailable.");
  }
  if (!terms.active || terms.creator.toLowerCase() !== intent.ownerWallet.toLowerCase()) {
    throw new StaleGapIntentTargetError("Registry creator or active state changed after admission.");
  }

  const item = await db.getItem(source.id, intent.itemId);
  if (!item || sourceItemContentVersion(item) !== intent.contentVersion) {
    throw new StaleGapIntentTargetError("The offered article version changed or disappeared.");
  }
  if (intent.articleOfferId) {
    const offer = await resolveValidArticleOffer(db, source, item, terms);
    if (offer?.offer.id !== intent.articleOfferId) {
      throw new StaleGapIntentTargetError("The signed article offer expired or was replaced.");
    }
  }

  return {
    sourceId: source.id,
    itemId: item.id,
    contentVersion: intent.contentVersion,
    ...(intent.articleOfferId ? { articleOfferId: intent.articleOfferId } : {}),
  };
}

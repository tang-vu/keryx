/**
 * Free preview for discovery — titles + summaries only (no payment).
 * GET /api/source/[id]/preview
 */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { resolveValidArticleOffer, articlePaidPath } from "@/lib/offers/resolve-article-offer";
import { sourceFetchTerms } from "@/lib/registry/source-fetch-payto";
import { normalizePreviewDepth, previewSummary } from "@/lib/sources/preview-depth";
import {
  sourceItemAssetId,
  sourceItemIdentity,
} from "@/lib/sources/source-item-asset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) return Response.json({ error: "source not found" }, { status: 404 });
  const items = await db.getItems(id);
  const terms = await sourceFetchTerms(source);
  // The creator's preview-depth choice decides how much of each item this free surface reveals.
  const depth = normalizePreviewDepth(source.previewDepth);
  return Response.json({
    id: source.id,
    name: source.name,
    description: source.description,
    fetchPrice: terms.listPriceUsdc,
    tags: source.tags,
    previewDepth: depth,
    preview: await Promise.all(items.slice(0, 5).map(async (i) => {
      const summary = previewSummary(i.summary, depth);
      const identity = sourceItemIdentity(i);
      const offer = await resolveValidArticleOffer(db, source, i, terms);
      const metadata = {
        assetId: sourceItemAssetId(i.id),
        ...identity,
        // Compatibility alias for clients that already render preview[].title.
        title: i.title,
        priceUsdc: offer?.ref.priceUsdc ?? terms.listPriceUsdc,
        listPriceUsdc: terms.listPriceUsdc,
        ...(offer
          ? {
              offer: {
                id: offer.offer.id,
                priceUsdc: offer.ref.priceUsdc,
                listPriceUsdc: offer.ref.listPriceUsdc,
                expiresAt: offer.ref.expiresAt,
                signer: offer.offer.signer,
                nonce: offer.offer.nonce,
                signature: offer.offer.signature,
              },
            }
          : {}),
        paidPath: articlePaidPath({
          sourceId: source.id,
          itemId: i.id,
          contentVersion: identity.contentVersion,
          offerId: offer?.offer.id,
          listPriceUsdc: offer?.ref.listPriceUsdc,
        }),
      };
      // "locked" yields an empty summary — omit the field so the shape reads as title-only.
      return summary ? { ...metadata, summary } : metadata;
    })),
  });
}

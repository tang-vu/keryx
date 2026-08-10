/** x402-protected immutable article asset. Registry source owns price and payout authority. */
import { NextRequest } from "next/server";

import { getDb } from "@/lib/db";
import { sourceFetchTerms } from "@/lib/registry/source-fetch-payto";
import { articlePaidPath, resolveValidArticleOffer } from "@/lib/offers/resolve-article-offer";
import {
  sourceItemCacheKey,
  sourceItemIdentity,
} from "@/lib/sources/source-item-asset";
import { resolveSourceItemContent } from "@/lib/sources/resolve-source-item-content";
import { settleThenServe } from "@/lib/x402-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await ctx.params;
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) return Response.json({ error: "source not found" }, { status: 404 });

  const item = await db.getItem(id, itemId);
  if (!item) return Response.json({ error: "article not found" }, { status: 404 });

  const identity = sourceItemIdentity(item);
  const requestedVersion = req.nextUrl.searchParams.get("version");
  if (!requestedVersion || requestedVersion !== identity.contentVersion) {
    return Response.json(
      { error: "article version changed; rediscover before paying" },
      { status: 409 },
    );
  }
  const terms = await sourceFetchTerms(source, { refresh: true });
  if (!terms.active || source.active === false || source.verified === false) {
    return Response.json({ error: "source is not active on the earning rail" }, { status: 410 });
  }
  const requestedOfferId = req.nextUrl.searchParams.get("offer");
  const resolvedOffer = await resolveValidArticleOffer(db, source, item, terms);
  if (requestedOfferId && resolvedOffer?.offer.id !== requestedOfferId) {
    return Response.json(
      { error: "article offer changed or expired; rediscover before paying" },
      { status: 409 },
    );
  }
  if (
    requestedOfferId &&
    req.nextUrl.searchParams.get("listPriceUsdc6") !==
      String(Math.round(terms.listPriceUsdc * 1_000_000))
  ) {
    return Response.json(
      { error: "source list price changed; rediscover before paying" },
      { status: 409 },
    );
  }
  const offer = requestedOfferId ? resolvedOffer : null;
  const priceUsdc = offer?.ref.priceUsdc ?? terms.listPriceUsdc;
  const cacheKey = sourceItemCacheKey(id, item);
  const endpoint = articlePaidPath({
    sourceId: id,
    itemId,
    contentVersion: identity.contentVersion,
    offerId: offer?.offer.id,
    listPriceUsdc: offer?.ref.listPriceUsdc,
  });

  return settleThenServe(
    req,
    {
      priceUsdc,
      payTo: terms.payTo,
      endpoint,
      description: `${source.name} — ${item.title}`,
    },
    async (settle) => {
      const cached = await db.getCached(cacheKey);
      const content =
        cached ??
        (await resolveSourceItemContent(item, settle, {
          allowSummaryFallback: false,
          expectedManifestSigner: terms.creator,
        }));
      if (!cached) await db.setCached(cacheKey, content);

      return {
        content,
        name: source.name,
        item: identity,
        pricing: {
          offerId: offer?.offer.id ?? null,
          priceUsdc,
          listPriceUsdc: terms.listPriceUsdc,
        },
      };
    },
  );
}

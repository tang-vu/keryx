import { isPublicReferenceId } from "@/lib/public-references/catalog";
import { paperPaidGate } from "@/lib/scholarly/paid-gate";
/** x402-protected immutable article asset. Registry source owns price and payout authority. */
import { NextRequest } from "next/server";

import { getDb } from "@/lib/db";
import { sourceFetchTerms } from "@/lib/registry/source-fetch-payto";
import { articlePaidPath, resolveValidArticleOffer } from "@/lib/offers/resolve-article-offer";
import {
  sourceItemCacheKey,
  sourceItemIdentity,
} from "@/lib/sources/source-item-asset";
import { resolveSourceItemContent, resolveFreeSourceItemContent } from "@/lib/sources/resolve-source-item-content";
import { sourceClaimAccess } from "@/lib/sources/source-claim-access";
import { assertSourceClaimRequest, sourceClaimPath } from "@/lib/sources/source-claim-request";
import { settleThenServe } from "@/lib/x402-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await ctx.params;
  if (isPublicReferenceId(id)) return Response.json({ error: "Public references are free and have no payout authority" }, { status: 410 });
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
  if (await db.getPaperState?.(source.id) && requestedOfferId)
    return Response.json({ error: "Scholarly pilot does not support discounted offers" }, { status: 409 });
  const rightsDenied = await paperPaidGate(db, source, req, { kind: "fetch", item, payee: terms.payTo, amountMicros: Math.round(priceUsdc * 1e6) });
  if (rightsDenied) return rightsDenied;
  let claimAccess;
  try { claimAccess = await sourceClaimAccess(db, source, terms); }
  catch { return Response.json({ error: "Current source claim authority is unavailable" }, { status: 503 }); }
  if (!claimAccess.readAllowed) return Response.json({ error: "This creator has not enabled access at the current price" }, { status: 410 });
  if (priceUsdc > 0 || req.nextUrl.searchParams.has("claimId") || req.nextUrl.searchParams.has("claimRevision")) {
    try { assertSourceClaimRequest(req.nextUrl.searchParams, claimAccess.snapshot); }
    catch { return Response.json({ error: "Source policy changed; rediscover before paying" }, { status: 409 }); }
  }
  if (priceUsdc === 0) {
    try {
      const content = await resolveFreeSourceItemContent(db, source, item, claimAccess.snapshot ?? null);
      return Response.json({ content, name: source.name,
        item: { ...identity, accessKind: "creator-free", ...(claimAccess.snapshot ? { sourceClaim: claimAccess.snapshot } : {}) },
        access: "creator-free", creatorRewardsEnabled: claimAccess.rewardAllowed,
        pricing: { offerId: null, priceUsdc: 0, listPriceUsdc: 0 } }, { headers: { "Cache-Control": "no-store" } });
    } catch { return Response.json({ error: "The exact free article is unavailable" }, { status: 503 }); }
  }
  const cacheKey = sourceItemCacheKey(id, item);
  const endpoint = sourceClaimPath(articlePaidPath({
    sourceId: id,
    itemId,
    contentVersion: identity.contentVersion,
    offerId: offer?.offer.id,
    listPriceUsdc: offer?.ref.listPriceUsdc,
  }), claimAccess.snapshot);

  return settleThenServe(
    req,
    {
      priceUsdc,
      payTo: terms.payTo,
      endpoint,
      resourceSourceId: id,
      resourceKind: "fetch",
      ...(claimAccess.snapshot ? { sourceClaim: { sourceId: id, receipt: claimAccess.snapshot, kind: "fetch" as const } } : {}),
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

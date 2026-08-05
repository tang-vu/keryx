import { NextRequest } from "next/server";
import type { Hex } from "viem";

import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  articleOfferId,
  MAX_ARTICLE_OFFER_TTL_SECONDS,
  MIN_ARTICLE_OFFER_TTL_SECONDS,
  MIN_ARTICLE_OFFER_USDC6,
  validateArticleOffer,
} from "@/lib/offers/article-offer";
import { sourceFetchTerms } from "@/lib/registry/source-fetch-payto";
import { sourceItemIdentity } from "@/lib/sources/source-item-asset";
import type { ArticleOffer } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadPricingOwner(id: string) {
  const session = await getSession();
  if (!session) return { response: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) return { response: Response.json({ error: "source not found" }, { status: 404 }) };
  const terms = await sourceFetchTerms(source, { refresh: true });
  if (source.onchainId && (terms.authority !== "onchain" || terms.stale)) {
    return {
      response: Response.json(
        { error: "registry unavailable; article pricing authority cannot be verified" },
        { status: 503 },
      ),
    };
  }
  if (session.address.toLowerCase() !== terms.creator.toLowerCase()) {
    return { response: Response.json({ error: "only the source creator can price articles" }, { status: 403 }) };
  }
  return { db, source, terms, session };
}

function publicOffer(offer: ArticleOffer | null) {
  return offer
    ? {
        ...offer,
        priceUsdc: offer.priceUsdc6 / 1_000_000,
        expiresAtIso: new Date(offer.expiresAt * 1_000).toISOString(),
      }
    : null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const owned = await loadPricingOwner(id);
  if ("response" in owned) return owned.response;
  const { db, source, terms } = owned;
  const [items, offers] = await Promise.all([
    db.getItems(source.id),
    db.listArticleOffers(source.id),
  ]);
  const offerByItem = new Map(offers.map((offer) => [offer.itemId, offer]));
  const pricedItems = await Promise.all(
    items.slice(0, 20).map(async (item) => {
      const candidate = offerByItem.get(item.id) ?? null;
      const validity = candidate
        ? await validateArticleOffer({
            offer: candidate,
            item,
            sourceId: source.id,
            expectedSigner: terms.creator,
            listPriceUsdc: terms.listPriceUsdc,
          })
        : null;
      return {
        ...sourceItemIdentity(item),
        offer: validity?.valid ? publicOffer(candidate) : null,
      };
    }),
  );
  return Response.json({
    sourceId: source.id,
    sourceName: source.name,
    creator: terms.creator,
    active: terms.active && source.active !== false,
    verified: source.verified !== false,
    listPriceUsdc: terms.listPriceUsdc,
    minPriceUsdc: MIN_ARTICLE_OFFER_USDC6 / 1_000_000,
    maxTtlSeconds: MAX_ARTICLE_OFFER_TTL_SECONDS,
    items: pricedItems,
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const owned = await loadPricingOwner(id);
  if ("response" in owned) return owned.response;
  const { db, source, terms, session } = owned;
  if (!terms.active || source.active === false || source.verified === false) {
    return Response.json({ error: "source must be active and verified" }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  const item = itemId ? await db.getItem(source.id, itemId) : null;
  if (!item) return Response.json({ error: "article not found" }, { status: 404 });
  const identity = sourceItemIdentity(item);
  if (body.contentVersion !== identity.contentVersion) {
    return Response.json({ error: "article version changed; refresh before signing" }, { status: 409 });
  }

  const priceUsdc6 = Number(body.priceUsdc6);
  const expiresAt = Number(body.expiresAt);
  const now = Math.floor(Date.now() / 1_000);
  const maxPriceUsdc6 = Math.round(terms.listPriceUsdc * 1_000_000);
  if (
    !Number.isSafeInteger(priceUsdc6) ||
    priceUsdc6 < MIN_ARTICLE_OFFER_USDC6 ||
    priceUsdc6 > maxPriceUsdc6
  ) {
    return Response.json(
      { error: `offer price must be between ${MIN_ARTICLE_OFFER_USDC6} and ${maxPriceUsdc6} micro-USDC` },
      { status: 400 },
    );
  }
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < now + MIN_ARTICLE_OFFER_TTL_SECONDS ||
    expiresAt > now + MAX_ARTICLE_OFFER_TTL_SECONDS
  ) {
    return Response.json({ error: "offer expiry must be 5 minutes to 30 days from now" }, { status: 400 });
  }
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(nonce) ||
    !/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(signature)
  ) {
    return Response.json({ error: "invalid offer nonce or signature" }, { status: 400 });
  }

  const offer: ArticleOffer = {
    id: articleOfferId(signature as Hex),
    sourceId: source.id,
    itemId: item.id,
    contentVersion: identity.contentVersion,
    priceUsdc6,
    expiresAt,
    signer: session.address,
    nonce,
    signature,
    createdAt: new Date().toISOString(),
  };
  const validity = await validateArticleOffer({
    offer,
    item,
    sourceId: source.id,
    expectedSigner: terms.creator,
    listPriceUsdc: terms.listPriceUsdc,
    nowSeconds: now,
  });
  if (!validity.valid) {
    return Response.json({ error: validity.reason }, { status: 400 });
  }
  await db.setArticleOffer(offer);
  return Response.json({ offer: publicOffer(offer), terms: validity.ref }, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const owned = await loadPricingOwner(id);
  if ("response" in owned) return owned.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (!itemId || !(await owned.db.getItem(owned.source.id, itemId))) {
    return Response.json({ error: "article not found" }, { status: 404 });
  }
  await owned.db.deleteArticleOffer(owned.source.id, itemId);
  return Response.json({ revoked: true, itemId });
}

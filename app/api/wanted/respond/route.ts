/**
 * Existing creators answer a live wanted claim with one exact, already-indexed article.
 *
 * The response is coordination, not spend authority. Admission refreshes SourceRegistry creator
 * and article pricing; the worker repeats those checks before leasing treasury spend. The LLM then
 * receives the exact asset as a candidate and remains free to BUY or SKIP it.
 */

import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { GapOfferError, queueGapOffer, resolveExistingArticleGapOffer } from "@/lib/demand-intent";
import { matchFeedToGaps } from "@/lib/demand-match";
import { buildBoard, findDemandGap } from "@/lib/demand-signal";
import { resolveValidArticleOffer } from "@/lib/offers/resolve-article-offer";
import { consumePoint } from "@/lib/rate-limit-store";
import { sourceFetchTerms } from "@/lib/registry/source-fetch-payto";
import { sourceItemIdentity } from "@/lib/sources/source-item-asset";
import { WANTED_DETAIL_LIMIT, WANTED_WINDOW_RUNS } from "@/lib/wanted-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GAP_OFFERS_PER_WALLET_PER_DAY = 5;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function liveGap(db: Awaited<ReturnType<typeof getDb>>, rawId: unknown) {
  return findDemandGap(
    buildBoard(await db.listRecentQueries(WANTED_WINDOW_RUNS), {
      limit: WANTED_DETAIL_LIMIT,
    }).open,
    rawId,
  );
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const db = await getDb();
  const gap = await liveGap(db, req.nextUrl.searchParams.get("gapId"));
  if (!gap) return Response.json({ error: "wanted claim unavailable" }, { status: 404 });

  const owned = [];
  for (const source of await db.listAllSources()) {
    if (source.active === false || source.verified === false) continue;
    try {
      const terms = await sourceFetchTerms(source);
      if (
        !terms.active ||
        terms.stale ||
        (source.onchainId && terms.authority !== "onchain") ||
        session.address.toLowerCase() !== terms.creator.toLowerCase()
      ) continue;
      const items = await db.getItems(source.id);
      const match = matchFeedToGaps([gap], items, { limit: 1 })[0];
      if (!match) continue;
      const item = items.find((candidate) => candidate.id === (match.post as { id?: string }).id)
        ?? items.find((candidate) => candidate.link === match.post.link);
      if (!item) continue;
      const resolvedOffer = await resolveValidArticleOffer(db, source, item, terms);
      owned.push({
        sourceId: source.id,
        sourceName: source.name,
        creator: terms.creator,
        listPriceUsdc: terms.listPriceUsdc,
        minPriceUsdc: 0.0001,
        article: {
          ...sourceItemIdentity(item),
          summary: item.summary,
          priceUsdc: resolvedOffer?.ref.priceUsdc ?? terms.listPriceUsdc,
          offerId: resolvedOffer?.offer.id,
          offerExpiresAt: resolvedOffer?.offer.expiresAt,
        },
      });
    } catch {
      // One unreadable registry/source cannot hide other creator-owned responses.
    }
  }

  return Response.json({ gap: { id: gap.id, claim: gap.claim }, sources: owned });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (!sourceId || !itemId) {
    return Response.json({ error: "sourceId and itemId are required" }, { status: 400 });
  }

  const db = await getDb();
  const source = await db.getSource(sourceId);
  if (!source) return Response.json({ error: "source not found" }, { status: 404 });
  if (source.active === false || source.verified === false) {
    return Response.json({ error: "source must be active and verified" }, { status: 409 });
  }
  const terms = await sourceFetchTerms(source, { refresh: true });
  if (source.onchainId && (terms.authority !== "onchain" || terms.stale)) {
    return Response.json(
      { error: "registry unavailable; creator authority cannot be verified" },
      { status: 503 },
    );
  }
  if (session.address.toLowerCase() !== terms.creator.toLowerCase()) {
    return Response.json({ error: "only the registry creator can respond" }, { status: 403 });
  }

  const item = await db.getItem(source.id, itemId);
  if (!item) return Response.json({ error: "article not found" }, { status: 404 });
  const currentOffer = await resolveValidArticleOffer(db, source, item, terms);
  const requestedOfferId = typeof body.articleOfferId === "string" ? body.articleOfferId : undefined;
  if (requestedOfferId && currentOffer?.offer.id !== requestedOfferId) {
    return Response.json({ error: "article offer expired or was replaced" }, { status: 409 });
  }

  let offer;
  try {
    offer = await resolveExistingArticleGapOffer(
      db,
      body.gapId,
      item,
      body.contentVersion,
      currentOffer?.offer.id,
    );
  } catch (error) {
    if (error instanceof GapOfferError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  const admitted = await consumePoint(
    session.address.toLowerCase(),
    "gap-offer",
    GAP_OFFERS_PER_WALLET_PER_DAY,
    ONE_DAY_MS,
  );
  if (!admitted.allowed) {
    const retryAfter = Math.max(1, Math.ceil(admitted.msBeforeNext / 1000));
    return Response.json(
      { error: "A wallet may submit at most five treasury-retry offers per day." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const intent = await queueGapOffer(db, offer, source.id, terms.creator);
  revalidatePath("/wanted");
  revalidatePath(`/wanted/${offer.gapId}`);
  return Response.json({ intent }, { status: 201 });
}

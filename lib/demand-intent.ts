/**
 * Validate and snapshot one creator's offer against the current public demand board.
 *
 * The browser is allowed to carry only opaque gap/item ids. Claim text, failed question, wallet,
 * and source id are resolved server-side so this coordination row can never become payout
 * authority. The worker separately requires an active, verified source owned by the same wallet.
 */

import type { KeryxDB } from "./db/keryx-db";
import { matchFeedToGaps } from "./demand-match";
import { buildBoard } from "./demand-signal";
import type { GapIntent, SourceItem } from "./types";
import { WANTED_DETAIL_LIMIT, WANTED_WINDOW_RUNS } from "./wanted-limits";

const GAP_ID = /^[a-f0-9]{64}$/;

export interface ResolvedGapOffer {
  gapId: string;
  claim: string;
  question: string;
  failedQueryId: string;
  sourceItemLink: string;
}

export class GapOfferError extends Error {}

function canonicalLink(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

/** Resolve user-carried ids against the live board and the feed Keryx just ingested. */
export async function resolveGapOffer(
  db: KeryxDB,
  gapIdRaw: unknown,
  itemLinkRaw: unknown,
  feedItems: Omit<SourceItem, "id" | "sourceId">[],
): Promise<ResolvedGapOffer | null> {
  const gapId = typeof gapIdRaw === "string" ? gapIdRaw.trim().toLowerCase() : "";
  const itemLink =
    typeof itemLinkRaw === "string" ? canonicalLink(itemLinkRaw.trim()) : "";
  if (!gapId && !itemLink) return null;
  if (!GAP_ID.test(gapId) || !itemLink) {
    throw new GapOfferError("This wanted-claim offer link is incomplete or invalid.");
  }

  const item = feedItems.find(
    (candidate) => canonicalLink(candidate.link) === itemLink,
  );
  if (!item) {
    throw new GapOfferError(
      "The matched post is no longer present in the feed Keryx ingested.",
    );
  }

  const open = buildBoard(await db.listRecentQueries(WANTED_WINDOW_RUNS), {
    limit: WANTED_DETAIL_LIMIT,
  }).open;
  const gap = open.find((candidate) => candidate.id === gapId);
  if (!gap) {
    throw new GapOfferError(
      "That wanted claim has already been filled or moved outside the current demand window.",
    );
  }
  const verifiedMatch = matchFeedToGaps([gap], feedItems, { limit: 1 })[0];
  if (
    !verifiedMatch?.post.link ||
    canonicalLink(verifiedMatch.post.link) !== itemLink
  ) {
    throw new GapOfferError(
      "That post no longer matches this wanted claim from its public feed preview.",
    );
  }

  return {
    gapId: gap.id,
    claim: gap.claim,
    question: gap.question,
    failedQueryId: gap.queryId,
    sourceItemLink: item.link,
  };
}

/**
 * Idempotently persist a server-resolved offer once the source id is known.
 *
 * The database admits at most one offer per gap and owner wallet, even when the owner relists the
 * feed with another source id or post URL. That bound is payment authority: every admitted offer
 * can cause a treasury-funded retry, so item-level uniqueness is not sufficient.
 */
export async function queueGapOffer(
  db: KeryxDB,
  offer: ResolvedGapOffer | null,
  sourceId: string,
  ownerWallet: string,
): Promise<GapIntent | null> {
  if (!offer) return null;
  return db.createGapIntent({
    ...offer,
    sourceId,
    ownerWallet: ownerWallet.toLowerCase(),
  });
}

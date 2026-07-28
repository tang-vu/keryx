/**
 * Validate and snapshot one creator's offer against the current public demand board.
 *
 * The browser is allowed to carry only opaque gap/item ids. Claim text, failed question, wallet,
 * and source id are resolved server-side so this coordination row can never become payout
 * authority. The worker separately requires an active, verified source owned by the same wallet.
 */

import type { KeryxDB } from "./db/keryx-db";
import { buildBoard } from "./demand-signal";
import type { GapIntent, SourceItem } from "./types";

const WINDOW_RUNS = 400;
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

  const open = buildBoard(await db.listRecentQueries(WINDOW_RUNS), {
    limit: WINDOW_RUNS,
  }).open;
  const gap = open.find((candidate) => candidate.id === gapId);
  if (!gap) {
    throw new GapOfferError(
      "That wanted claim has already been filled or moved outside the current demand window.",
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

/** Idempotently persist a server-resolved offer once the source id is known. */
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

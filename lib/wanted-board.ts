/**
 * Server-side projection for the public wanted surfaces.
 *
 * The demand board is rebuilt from public query receipts on each request;
 * `gap_intents` only adds coordination status. Neither a shared URL nor an intent row can choose a
 * payee or authorize spend.
 */

import { getDb } from "./db";
import { buildBoard, findDemandGap, type DemandGap } from "./demand-signal";
import type { GapIntentStatus } from "./types";
import { WANTED_WINDOW_RUNS } from "./wanted-limits";
import { wantedMessages } from "../locales/en/wanted";

export { WANTED_DETAIL_LIMIT } from "./wanted-limits";

export interface PublicWantedOffer {
  id: string;
  gapId: string;
  sourceId: string;
  sourceName: string;
  sourceItemLink: string;
  itemId?: string;
  contentVersion?: string;
  articleOfferId?: string;
  status: GapIntentStatus;
  attempts: number;
  retryRunId?: string;
  coverage?: number;
  rewardUsdc?: number;
}

export interface PublicWantedBoard {
  open: DemandGap[];
  filled: DemandGap[];
  offers: PublicWantedOffer[];
}

export async function loadWantedBoard(limit = 20): Promise<PublicWantedBoard> {
  const db = await getDb();
  const [runs, intents, sources] = await Promise.all([
    db.listRecentQueries(WANTED_WINDOW_RUNS),
    db.runPrivacy ? db.runPrivacy.offers(200) : Promise.resolve([]),
    db.listAllSources(),
  ]);
  const board = buildBoard(runs, { limit });
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  return {
    ...board,
    // Admission and worker claim both verify the live registry creator. The public projection must
    // not confuse that creator with the (possibly different) payout wallet cached on the source.
    offers: intents.filter((intent) => sourceById.has(intent.sourceId)).map((intent) => ({
        id: intent.id,
        gapId: intent.gapId,
        sourceId: intent.sourceId,
        sourceName: sourceById.get(intent.sourceId)?.name ?? intent.sourceId,
        sourceItemLink: intent.sourceItemLink,
        itemId: intent.itemId,
        contentVersion: intent.contentVersion,
        articleOfferId: intent.articleOfferId,
        status: intent.status,
        attempts: intent.attempts,
        retryRunId: intent.retryRunId,
        coverage: intent.coverage,
        rewardUsdc: intent.rewardUsdc,
      })),
  };
}

export function findWantedBrief(
  board: PublicWantedBoard,
  rawId: unknown,
): { gap: DemandGap; state: "open" | "filled" } | undefined {
  const open = findDemandGap(board.open, rawId);
  if (open) return { gap: open, state: "open" };
  const filled = findDemandGap(board.filled, rawId);
  return filled ? { gap: filled, state: "filled" } : undefined;
}

export function wantedOfferStatus(offer: PublicWantedOffer): string {
  switch (offer.status) {
    case "pending":
      return wantedMessages["wantedBoard.pending"];
    case "running":
      return wantedMessages["wantedBoard.running"].replace("{attempt}", String(offer.attempts));
    case "filled":
      return wantedMessages["wantedBoard.settled"].replace("{reward}", (offer.rewardUsdc ?? 0).toFixed(6));
    case "unpaid":
      return wantedMessages["wantedBoard.unpaid"];
    case "missed":
      return wantedMessages["wantedBoard.missed"];
    case "stale":
      return wantedMessages["wantedBoard.stale"];
    case "failed":
      return wantedMessages["wantedBoard.failed"];
  }
}

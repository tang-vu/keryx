/**
 * Server-side projection for the public wanted surfaces.
 *
 * The demand board is rebuilt from completed query receipts every time this cache window refreshes;
 * `gap_intents` only adds coordination status. Neither a shared URL nor an intent row can choose a
 * payee or authorize spend.
 */

import { getDb } from "./db";
import { buildBoard, findDemandGap, type DemandGap } from "./demand-signal";
import type { GapIntentStatus } from "./types";

export const WANTED_WINDOW_RUNS = 400;
export const WANTED_DETAIL_LIMIT = WANTED_WINDOW_RUNS * 4;

export interface PublicWantedOffer {
  id: string;
  gapId: string;
  sourceId: string;
  sourceName: string;
  sourceItemLink: string;
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
    db.listGapIntents(200),
    db.listAllSources(),
  ]);
  const board = buildBoard(runs, { limit });
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  return {
    ...board,
    offers: intents
      .filter((intent) => {
        const source = sourceById.get(intent.sourceId);
        return source?.walletAddress.toLowerCase() === intent.ownerWallet.toLowerCase();
      })
      .map((intent) => ({
        id: intent.id,
        gapId: intent.gapId,
        sourceId: intent.sourceId,
        sourceName: sourceById.get(intent.sourceId)?.name ?? intent.sourceId,
        sourceItemLink: intent.sourceItemLink,
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
      return "queued until the source is indexed + verified";
    case "running":
      return `targeted retry running · attempt ${offer.attempts}/3`;
    case "filled":
      return `fulfilled · $${(offer.rewardUsdc ?? 0).toFixed(6)} settled`;
    case "unpaid":
      return "evidence passed, settlement did not complete";
    case "missed":
      return "retry completed, evidence still fell short";
    case "stale":
      return "closed without retry because the claim was already filled";
    case "failed":
      return "retry stopped after bounded failures";
  }
}

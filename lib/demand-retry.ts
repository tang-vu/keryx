/**
 * Re-asking what the corpus was paid for and missed.
 *
 * The demand board publishes the holes. This is the half that makes the board a promise rather than
 * a bulletin: when content arrives that might fill one, Keryx puts the original question again —
 * a full paid dispatch that buys the new material and pays whoever wrote it. A creator who lists a
 * feed against an open claim does not have to wait for a reader to happen by.
 *
 * The whole design is in the guard, because a retry costs real USDC and the naive version burns it:
 *
 *  - **Only when something new could answer it.** The failing dispatch must predate the newest
 *    content the corpus holds. Re-asking against the same shelf returns the same miss and pays for
 *    the privilege.
 *  - **Only once per arrival.** If that question has already been re-asked since that content
 *    landed, its answer is in — asking again just repeats the retry, not the experiment. The next
 *    publication makes it eligible again, which is exactly when it is worth another look.
 *  - **Never a hole already filled.** `buildBoard` resolves those out before ranking, so a claim
 *    some later dispatch covered is never bought a second time to rediscover that.
 *
 * Ranking follows the board: the most-recurring, worst-covered hole is the one most worth closing.
 */

import { buildBoard, type DemandGap } from "./demand-signal";
import type { QueryRun } from "./types";

export interface RetryCandidate {
  /** The dispatch being re-asked; recorded as `retryOf` on the new run. */
  queryId: string;
  /** Put verbatim, so the retry re-decomposes and re-scores the same question the corpus failed. */
  question: string;
  claim: string;
  coverage: number;
  seen: number;
}

export interface RetryOptions {
  threshold?: number;
  /** How deep down the wanted list to consider before giving up. */
  limit?: number;
}

/**
 * The open gap most worth re-asking, or null when nothing has changed that could answer one.
 *
 * `newestContentAt` is the publication date of the newest item in the corpus (ISO). Absent or empty
 * means nothing dated is on the shelf, so nothing can have arrived since any dispatch — no retry.
 */
export function pickGapRetry(
  runs: QueryRun[],
  newestContentAt: string | undefined,
  options: RetryOptions = {},
): RetryCandidate | null {
  if (!newestContentAt) return null;

  const { open } = buildBoard(runs, { threshold: options.threshold, limit: options.limit ?? 25 });

  for (const gap of open) {
    if (!(gap.createdAt < newestContentAt)) continue; // nothing published since this one failed
    if (retriedSince(runs, gap, newestContentAt)) continue;
    return {
      queryId: gap.queryId,
      question: gap.question,
      claim: gap.claim,
      coverage: gap.coverage,
      seen: gap.seen,
    };
  }
  return null;
}

/**
 * Has this question already been re-asked since that content arrived?
 *
 * This catches the one case the date guard above cannot. A retry that *failed* pushes the gap's own
 * date forward past the content, and a retry that *succeeded* takes the gap off the open list — so
 * either way the gap stops being eligible on its own. A retry that measured **nothing**, though —
 * the heuristic fallback, a truncated model reply — records neither, leaving the gap looking exactly
 * as it did before. Without this the engine would re-ask that question every tick, buying the same
 * sources again, for as long as the reasoning provider stayed down.
 *
 * Matched on the question text rather than the parent id on purpose: a recurring hole is reported
 * under whichever dispatch missed it worst, so its `queryId` moves as new misses land, while the
 * sentence the retry would actually put is the stable thing. Keying on the id would let one
 * question be re-asked twice for the same arrival under two different ids.
 */
function retriedSince(runs: QueryRun[], gap: DemandGap, newestContentAt: string): boolean {
  return runs.some(
    (r) => r.retryOf && r.question === gap.question && r.createdAt > newestContentAt,
  );
}

/**
 * When the corpus last gained something, across both ways that happens.
 *
 * A new post on a listed feed shows up as a publication date. A newly listed source does not: its
 * posts carry whatever dates the author wrote them on, which for an established blog are mostly in
 * the past. Registration day is the honest arrival time for that case, and it is the case this
 * whole feature exists to serve — a creator listing a feed against an open claim would otherwise
 * never trigger the retry that pays them.
 *
 * Dates after `now` are ignored. Feeds do publish items stamped in the future, and one of those
 * would sit above every dispatch forever, making every gap permanently retryable.
 */
export function newestContent(
  itemDates: Record<string, string>,
  sources: { createdAt?: string }[] = [],
  now: string = new Date().toISOString(),
): string | undefined {
  let newest: string | undefined;
  const consider = (d: string | undefined) => {
    if (!d || d > now) return;
    if (!newest || d > newest) newest = d;
  };
  for (const d of Object.values(itemDates)) consider(d);
  for (const s of sources) consider(s.createdAt);
  return newest;
}

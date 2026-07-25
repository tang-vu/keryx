/**
 * Demand signal — what readers paid to ask that the corpus could not answer.
 *
 * Keryx knows something a search engine does not: not what people looked for, but what they **spent
 * money on and did not get**. Every dispatch breaks its question into sub-claims and then scores,
 * per claim, how well the sources it bought actually covered it. A claim that finishes a run at 20%
 * is a paying reader the corpus failed — and for anyone deciding what to publish or list, that is
 * the most valuable fact on the site: demand already proven, supply missing, with a receipt.
 *
 * The unit published here is the **claim**, not a topic label. An earlier cut of this grouped gaps
 * by keyword the way the archive groups questions, and the facets came out as "reduce", "guide",
 * "time" — sub-claims are sentences, so their tokens describe grammar as often as subject. A
 * creator can act on "the agent must learn from past spending outcomes"; nobody can act on "time".
 *
 * The honesty rules matter more here than the ranking, because this page asks people to do work on
 * the strength of it:
 *  - **Only measured gaps count.** A run carrying no coverage assessment at all (older runs, or one
 *    answered by the deterministic fallback) is skipped, never counted as a gap. Absence of
 *    measurement is not evidence of absence.
 *  - **The final assessment wins.** Coverage is re-scored as the agent reads, and the early checks
 *    legitimately read 0 because nothing has been bought yet. Taking the last word per claim is the
 *    difference between "the corpus failed this" and "the agent had not started".
 *  - **Every line keeps its receipt.** Each gap carries the dispatch that produced it, so a reader
 *    can open the trace and check the claim really was left uncovered rather than take our word.
 */

import { topicTokens } from "./answers-topics";
import type { QueryRun } from "./types";

/** A claim one dispatch finished under-covered. */
export interface ClaimGap {
  claim: string;
  coverage: number; // 0..1, that run's final assessment
  queryId: string;
  question: string;
  createdAt: string;
}

/** An under-covered claim as published: worst occurrence, plus how often it has recurred. */
export interface DemandGap extends ClaimGap {
  /** Distinct dispatches that finished this same claim under-covered. */
  seen: number;
}

export interface DemandOptions {
  /** Final coverage below this counts as a gap. Matches the orchestrator's own gap threshold. */
  threshold?: number;
  limit?: number;
}

const DEFAULTS = { threshold: 0.4, limit: 20 } satisfies Required<DemandOptions>;

/**
 * The run's last word on each of its claims, keyed by claim text. Empty when the run carries no
 * coverage assessment at all — which callers must read as "not measured", never as "not covered".
 *
 * Two trace shapes carry coverage: the sufficiency step emits `{ perClaim: [...] }`, the
 * re-evaluation step emits one step per claim as `{ claim, coverage, coveredBy }`. Both are walked
 * in trace order, so a later assessment overwrites an earlier one.
 */
export function finalCoverage(run: QueryRun): Map<string, number> {
  const out = new Map<string, number>();
  for (const step of run.trace ?? []) {
    const detail = step.detail as Record<string, unknown> | undefined;
    if (!detail || typeof detail !== "object") continue;

    const perClaim = detail.perClaim as { claim?: string; coverage?: number }[] | undefined;
    if (Array.isArray(perClaim)) {
      for (const c of perClaim) {
        if (typeof c?.claim === "string" && typeof c.coverage === "number") {
          out.set(c.claim, c.coverage);
        }
      }
      continue;
    }
    if (typeof detail.claim === "string" && typeof detail.coverage === "number") {
      out.set(detail.claim, detail.coverage);
    }
  }
  return out;
}

/**
 * Enough of a sentence to be a demand signal.
 *
 * Anyone can ask anything through the front doors, and "Hi" decomposes into a sub-claim that no
 * source covers — which is true, and meaningless. Production put exactly that on the board, twice.
 * A claim carrying fewer than two subject words describes nothing a creator could write about, so
 * it is dropped rather than published as unserved demand.
 */
function hasSubstance(claim: string): boolean {
  return topicTokens(claim).size >= 2;
}

/** Claims this dispatch finished below `threshold`. Empty for a run that measured nothing. */
export function claimGaps(run: QueryRun, threshold = DEFAULTS.threshold): ClaimGap[] {
  const gaps: ClaimGap[] = [];
  for (const [claim, coverage] of finalCoverage(run)) {
    if (coverage >= threshold || !hasSubstance(claim)) continue;
    gaps.push({ claim, coverage, queryId: run.id, question: run.question, createdAt: run.createdAt });
  }
  return gaps;
}

/**
 * Merge key for "the same hole, phrased twice".
 *
 * The engine re-decomposes every question from scratch, so one recurring gap arrives as a family of
 * near-identical sentences — production surfaced "CCTP uses a burn-and-mint mechanism to transfer
 * USDC *between* domains" and "…*across* domains" as two separate rows of the same hole. Keying on
 * the claim's significant vocabulary (`topicTokens` — stemmed, stop-worded) collapses those, because
 * the words that differ are exactly the ones that carry no subject.
 *
 * Deliberately equality on the token set, NOT a similarity threshold. "X reduces fees" and
 * "X increases fees" overlap on nearly every token and mean opposite things; a fuzzy merge would
 * fold a claim into its own negation and publish the result as one demand signal.
 */
function claimKey(claim: string): string {
  const tokens = [...topicTokens(claim)].sort();
  return tokens.length > 0 ? tokens.join(" ") : claim.trim().toLowerCase();
}

/**
 * Aggregate a run window into the published board. Claims that say the same thing collapse to one
 * line carrying the worst occurrence and the count — a hole hit by several dispatches is a
 * genuinely recurring one, worth ranking above a one-off.
 *
 * Order: recurrence first, then how badly it was missed, then recency. `runs` may arrive in any
 * order.
 */
export function buildDemand(runs: QueryRun[], options: DemandOptions = {}): DemandGap[] {
  const { threshold, limit } = { ...DEFAULTS, ...options };
  const byClaim = new Map<string, DemandGap>();

  for (const run of runs) {
    for (const gap of claimGaps(run, threshold)) {
      const key = claimKey(gap.claim);
      const existing = byClaim.get(key);
      if (!existing) {
        byClaim.set(key, { ...gap, seen: 1 });
        continue;
      }
      existing.seen += 1;
      // Keep the worst occurrence whole — its wording, its coverage and its dispatch travel
      // together, so the sentence on the board is the one the linked trace actually assessed.
      // The date is the exception: it always shows the freshest hit, because a creator needs to
      // know the hole is still open, not when it first appeared.
      if (gap.coverage < existing.coverage) {
        existing.claim = gap.claim;
        existing.coverage = gap.coverage;
        existing.queryId = gap.queryId;
        existing.question = gap.question;
      }
      if (gap.createdAt > existing.createdAt) existing.createdAt = gap.createdAt;
    }
  }

  return [...byClaim.values()]
    .sort(
      (a, b) =>
        b.seen - a.seen || a.coverage - b.coverage || b.createdAt.localeCompare(a.createdAt),
    )
    .slice(0, limit);
}

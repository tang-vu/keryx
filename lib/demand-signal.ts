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

/** Claims this dispatch finished below `threshold`. Empty for a run that measured nothing. */
export function claimGaps(run: QueryRun, threshold = DEFAULTS.threshold): ClaimGap[] {
  const gaps: ClaimGap[] = [];
  for (const [claim, coverage] of finalCoverage(run)) {
    if (coverage >= threshold) continue;
    gaps.push({ claim, coverage, queryId: run.id, question: run.question, createdAt: run.createdAt });
  }
  return gaps;
}

/**
 * Aggregate a run window into the published board. Identical claim text across dispatches collapses
 * to one line carrying the worst coverage and the count — the volume engine phrases questions
 * freshly each time, so a claim recurring verbatim is a genuinely recurring hole, worth ranking
 * above a one-off.
 *
 * Order: recurrence first, then how badly it was missed, then recency. `runs` may arrive in any
 * order.
 */
export function buildDemand(runs: QueryRun[], options: DemandOptions = {}): DemandGap[] {
  const { threshold, limit } = { ...DEFAULTS, ...options };
  const byClaim = new Map<string, DemandGap>();

  for (const run of runs) {
    for (const gap of claimGaps(run, threshold)) {
      const existing = byClaim.get(gap.claim);
      if (!existing) {
        byClaim.set(gap.claim, { ...gap, seen: 1 });
        continue;
      }
      existing.seen += 1;
      // Keep the worst occurrence as the headline, but always show the freshest date: a creator
      // needs to know the hole is still open, not when it first appeared.
      if (gap.coverage < existing.coverage) {
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

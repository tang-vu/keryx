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
 *  - **The agent's own repeats are not demand.** Keryx re-asks a failed question once the corpus
 *    gains content that might answer it (`retryOf`). That retry is a real paid dispatch and it can
 *    genuinely close a hole — but it is Keryx arriving, not a reader, so it never adds to the
 *    recurrence count. Otherwise the board would inflate the very holes it chose to re-test.
 *  - **A hole that got filled is not still open.** A claim later covered by *any* dispatch is
 *    published as filled rather than left on the wanted list, so nobody writes to a brief that has
 *    already been served. The filling run must postdate the last failure: coverage can regress, and
 *    a fill from before the most recent miss proves nothing about today.
 */

import crypto from "node:crypto";
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

/** The dispatch that finally covered a claim the corpus had been missing. */
export interface GapFill {
  queryId: string;
  question: string;
  coverage: number;
  createdAt: string;
  /** True when Keryx re-asked the failed question itself rather than a reader happening to ask. */
  byRetry: boolean;
  /** Sources this dispatch paid — the creators whose content closed the hole. */
  paid: { sourceId: string; sourceName: string; reward: number }[];
}

/** An under-covered claim as published: worst occurrence, plus how often it has recurred. */
export interface DemandGap extends ClaimGap {
  /** Stable identifier for this semantic claim family; safe to carry through registration. */
  id: string;
  /** Distinct dispatches that finished this same claim under-covered. Retries are excluded — the
   *  agent re-asking itself is not another reader hitting the hole. */
  seen: number;
  /** Set once a later dispatch covered this claim. Such a gap is reported as filled, not wanted. */
  filledBy?: GapFill;
}

export interface DemandOptions {
  /** Final coverage below this counts as a gap. Matches the orchestrator's own gap threshold. */
  threshold?: number;
  limit?: number;
}

const DEFAULTS = { threshold: 0.4, limit: 20 } satisfies Required<DemandOptions>;
const DEMAND_GAP_ID = /^[a-f0-9]{64}$/;

/**
 * The run's last word on each of its claims, keyed by claim text. Empty when the run carries no
 * coverage assessment at all — which callers must read as "not measured", never as "not covered".
 *
 * Two trace shapes carry coverage: the sufficiency step emits `{ perClaim: [...] }`, the
 * re-evaluation step emits one step per claim as `{ claim, coverage, coveredBy }`. Both are walked
 * in trace order, so a later assessment overwrites an earlier one.
 */
export function finalCoverage(run: QueryRun): Map<string, number> {
  if (run.claimCoverage?.length) {
    return new Map(
      run.claimCoverage.map((item) => [item.claim, item.coverage]),
    );
  }
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

/** Public, opaque id for carrying one open gap through feed-match and source registration. */
export function demandGapId(claim: string): string {
  return crypto
    .createHash("sha256")
    .update(`keryx-gap:v1:${claimKey(claim)}`)
    .digest("hex");
}

/**
 * Resolve an opaque public gap id against a freshly rebuilt board.
 *
 * A shared URL is coordination only: the id never carries the claim text, payout address, or
 * permission to spend. Callers must rebuild the current board and resolve it here before showing
 * or acting on a brief, so a filled/expired claim cannot be revived from stale URL state.
 */
export function findDemandGap(gaps: DemandGap[], rawId: unknown): DemandGap | undefined {
  const id = typeof rawId === "string" ? rawId.trim().toLowerCase() : "";
  if (!DEMAND_GAP_ID.test(id)) return undefined;
  return gaps.find((gap) => gap.id === id);
}

/**
 * Every claim the window under-covered, keyed by meaning, each already resolved to open or filled.
 * Both published lists are slices of this, so a claim can never appear on both.
 */
function aggregate(runs: QueryRun[], threshold: number): DemandGap[] {
  const byClaim = new Map<string, DemandGap>();
  /** Newest dispatch that covered each claim key, whether or not it ever failed there. */
  const covered = new Map<string, GapFill>();

  for (const run of runs) {
    const coverage = finalCoverage(run);
    // A retry is a real dispatch that buys and pays; it just is not another reader. It can still
    // fill a hole, so it is read for coverage — only the recurrence count ignores it.
    const isRetry = Boolean(run.retryOf);

    for (const [claim, value] of coverage) {
      if (value < threshold || !hasSubstance(claim)) continue;
      const key = claimKey(claim);
      const prior = covered.get(key);
      if (prior && prior.createdAt >= run.createdAt) continue;
      covered.set(key, {
        queryId: run.id,
        question: run.question,
        coverage: value,
        createdAt: run.createdAt,
        byRetry: isRetry,
        paid: (run.citations ?? []).map((c) => ({
          sourceId: c.sourceId,
          sourceName: c.sourceName,
          reward: c.reward,
        })),
      });
    }

    for (const gap of claimGaps(run, threshold)) {
      const key = claimKey(gap.claim);
      const existing = byClaim.get(key);
      if (!existing) {
        byClaim.set(key, {
          ...gap,
          id: demandGapId(gap.claim),
          seen: isRetry ? 0 : 1,
        });
        continue;
      }
      if (!isRetry) existing.seen += 1;
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

  for (const [key, gap] of byClaim) {
    const fill = covered.get(key);
    // Strictly after the last failure. A fill recorded before the most recent miss says the corpus
    // could answer this once and then stopped — that is a hole, not a fill.
    if (fill && fill.createdAt > gap.createdAt) gap.filledBy = fill;
  }

  return [...byClaim.values()];
}

/**
 * The wanted list: claims still open. Claims that say the same thing collapse to one line carrying
 * the worst occurrence and the count — a hole hit by several dispatches is a genuinely recurring
 * one, worth ranking above a one-off.
 *
 * Order: recurrence first, then how badly it was missed, then recency. `runs` may arrive in any
 * order.
 */
export function buildDemand(runs: QueryRun[], options: DemandOptions = {}): DemandGap[] {
  return buildBoard(runs, options).open;
}

/**
 * The other half of the board: holes that closed. Newest fill first, because the point of showing
 * these is that the loop pays out — demand published, content arrives, the agent comes back and
 * buys it — and the most recent one is the one that proves the loop still runs.
 */
export function buildFilled(runs: QueryRun[], options: DemandOptions = {}): DemandGap[] {
  return buildBoard(runs, options).filled;
}

/**
 * Both lists from one pass. Reading coverage means walking every trace in the window, so the page
 * that renders open *and* filled asks for them together rather than paying for that twice.
 */
export function buildBoard(
  runs: QueryRun[],
  options: DemandOptions = {},
): { open: DemandGap[]; filled: DemandGap[] } {
  const { threshold, limit } = { ...DEFAULTS, ...options };
  const all = aggregate(runs, threshold);
  return {
    open: all
      .filter((gap) => !gap.filledBy)
      .sort(
        (a, b) =>
          b.seen - a.seen || a.coverage - b.coverage || b.createdAt.localeCompare(a.createdAt),
      )
      .slice(0, limit),
    filled: all
      .filter((gap) => gap.filledBy)
      .sort((a, b) => b.filledBy!.createdAt.localeCompare(a.filledBy!.createdAt))
      .slice(0, limit),
  };
}

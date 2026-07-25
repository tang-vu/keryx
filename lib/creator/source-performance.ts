/**
 * How the agent sees one source — the decision feedback a creator cannot get anywhere else.
 *
 * A creator page today answers "what did I earn". It cannot answer the question every creator
 * actually asks after a quiet week: **the agent looked at my source and walked away — why?** That
 * answer already exists. Every dispatch stores a reasoned decision per candidate, with a rationale
 * in plain words ("low historical hit rate", "better sources available", "not specific to citation
 * payments"), and those traces are public on each permalink. Nobody was going to read 400 of them
 * to find their own name. This module does that reading and reports it per source.
 *
 * What it deliberately does NOT do:
 *  - **No coaching.** It reports what the agent decided and what it paid for instead; it never tells
 *    a creator to drop their price. The two dials (price, preview depth) are theirs, and the honest
 *    input to that choice is the comparison, not our advice.
 *  - **No invented denominators.** A source is only "considered" in runs whose decisions actually
 *    name it. Runs from before it was registered are silent, not zero.
 *  - **Same-run comparison only.** The price the agent paid elsewhere is drawn from the very runs
 *    where this source was skipped — the same question, the same budget, the same minute. Comparing
 *    against an all-time average would mix cheap runs with rich ones and read as a slur.
 *
 * `BUY` and `CACHE` are kept apart because they mean different things to the person being paid: BUY
 * is a fresh toll settled to their wallet, CACHE is "still worth reading, already have it" — chosen,
 * but no new fetch payment (a citation reward can still follow).
 */

import type { Decision, QueryRun } from "../types";

/** One skip, kept verbatim, with the bar it was measured against. */
export interface SkipNote {
  queryId: string;
  question: string;
  createdAt: string;
  /** The agent's own words. Never paraphrased — the rationale IS the product. */
  rationale: string;
  expectedValue: number;
  price: number;
  /** Median listed price of the sources the agent chose in that same run; null if it chose none. */
  rivalPrice: number | null;
}

/** Everything the feedback panel renders for one source. */
export interface SourcePerformance {
  /** Dispatches whose decisions name this source — the denominator for everything below. */
  considered: number;
  bought: number; // BUY — a fetch toll settled
  reused: number; // CACHE — chosen, served from cache, no new toll
  skipped: number;
  /** Dispatches that ended up citing it (a citation reward followed). */
  cited: number;
  /** cited / (bought + reused) — of the times it was chosen, how often it made the answer. */
  citeThrough: number | null;
  /** Median expected value the agent assigned when it chose it vs when it passed. */
  evChosen: number | null;
  evSkipped: number | null;
  /** Price it asked at its most recent decision (the agent's view of the listing, not the DB's). */
  price: number | null;
  /** Median listed price of the other sources chosen across the runs where this one was skipped. */
  rivalPriceOnSkip: number | null;
  recentSkips: SkipNote[]; // newest first
}

const MAX_SKIP_NOTES = 4;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median listed price across the sources one run chose — the bar a skipped source was held to.
 *
 * BUY *and* CACHE count. A cache hit settles no fresh toll, but it is still the agent electing to
 * read that source at that listed price, and on a mature corpus most reads are cache hits: counting
 * only BUY would leave this null on the majority of runs and silently delete the comparison. The
 * wording that renders it therefore says "chose", never "paid".
 */
function chosenPriceIn(run: QueryRun): number | null {
  const chosen = (run.decisions ?? [])
    .filter((d) => d.action !== "SKIP" && Number.isFinite(d.price))
    .map((d) => d.price);
  return median(chosen);
}

/** Mutable per-source tally, collapsed into a `SourcePerformance` at the end of the pass. */
interface Tally {
  considered: number;
  bought: number;
  reused: number;
  skipped: number;
  cited: number;
  evChosen: number[];
  evSkipped: number[];
  lastPrice: number | null;
  rivalPrices: number[];
  skips: SkipNote[];
}

function emptyTally(): Tally {
  return {
    considered: 0,
    bought: 0,
    reused: 0,
    skipped: 0,
    cited: 0,
    evChosen: [],
    evSkipped: [],
    lastPrice: null,
    rivalPrices: [],
    skips: [],
  };
}

function record(tally: Tally, run: QueryRun, decision: Decision, wasCited: boolean) {
  tally.considered += 1;
  if (wasCited) tally.cited += 1;
  // Runs arrive newest-first, so the first price seen is the current one.
  if (tally.lastPrice === null && Number.isFinite(decision.price)) tally.lastPrice = decision.price;

  if (decision.action === "SKIP") {
    tally.skipped += 1;
    tally.evSkipped.push(decision.expectedValue);
    const rival = chosenPriceIn(run);
    if (rival !== null) tally.rivalPrices.push(rival);
    if (tally.skips.length < MAX_SKIP_NOTES && decision.rationale) {
      tally.skips.push({
        queryId: run.id,
        question: run.question,
        createdAt: run.createdAt,
        rationale: decision.rationale,
        expectedValue: decision.expectedValue,
        price: decision.price,
        rivalPrice: rival,
      });
    }
    return;
  }

  if (decision.action === "CACHE") tally.reused += 1;
  else tally.bought += 1;
  tally.evChosen.push(decision.expectedValue);
}

function collapse(tally: Tally): SourcePerformance {
  const chosen = tally.bought + tally.reused;
  return {
    considered: tally.considered,
    bought: tally.bought,
    reused: tally.reused,
    skipped: tally.skipped,
    cited: tally.cited,
    citeThrough: chosen > 0 ? tally.cited / chosen : null,
    evChosen: median(tally.evChosen),
    evSkipped: median(tally.evSkipped),
    price: tally.lastPrice,
    rivalPriceOnSkip: median(tally.rivalPrices),
    recentSkips: tally.skips,
  };
}

/**
 * One pass over the run window produces the feedback for every source in it. Building per-source
 * on demand would re-parse the same runs once per creator page view; the index is small enough to
 * memo whole (see source-performance-cache.ts).
 *
 * `runs` must be newest-first — `listRecentQueries` already returns that order, and the skip notes
 * and current price both depend on it.
 */
export function buildPerformanceIndex(runs: QueryRun[]): Record<string, SourcePerformance> {
  const tallies = new Map<string, Tally>();

  for (const run of runs) {
    const decisions = run.decisions ?? [];
    if (decisions.length === 0) continue;
    const cited = new Set((run.citations ?? []).map((c) => c.sourceId).filter(Boolean));

    for (const decision of decisions) {
      // External marketplace endpoints are discovery-only and have no creator page to feed.
      if (!decision.sourceId || decision.external) continue;
      let tally = tallies.get(decision.sourceId);
      if (!tally) tallies.set(decision.sourceId, (tally = emptyTally()));
      record(tally, run, decision, cited.has(decision.sourceId));
    }
  }

  const index: Record<string, SourcePerformance> = {};
  for (const [sourceId, tally] of tallies) index[sourceId] = collapse(tally);
  return index;
}

/**
 * dispatch-health.ts — reads the agent's own recent output and judges whether it is still
 * doing the thing the product claims: reasoning about sources and paying the ones it uses.
 *
 * Why this exists, and why the model watchdog is not enough. `scripts/check-llm.mts` proves the
 * providers answer a prompt. It cannot prove a run *used* that answer: the day DeepSeek retired a
 * wire name, the models came back and the agent still bought nothing for hours, because the decide
 * reply had outgrown its token ceiling and truncated JSON parsed to an empty decision set. Both
 * failures shared one shape — every surface reported health while creators earned nothing. A probe
 * answers "can the provider talk?"; this answers "did the last few hours of real dispatches decide
 * and pay?", which is the question the product is actually judged on.
 *
 * Pure and injectable: it takes settled runs and a clock, so the alarm rules are unit-tested
 * against fabricated windows instead of waiting for an outage to reproduce.
 */

import type { QueryRun } from "@/lib/types";

/** sync_state key the watchdog writes its latest summary under; /api/health reads it. */
export const DISPATCH_HEALTH_STATE_KEY = "dispatchHealth";

/** Default look-back. Long enough that a quiet stretch is not an outage, short enough to page. */
export const DEFAULT_WINDOW_HOURS = 6;

/** Below this, a window is too thin to read anything into a zero — one idle hour is not a fault. */
const MIN_RUNS_FOR_SPEND_ALARM = 3;

/** Share of runs that may lose *some* step to the heuristic before the window counts as degraded. */
const DEGRADED_SHARE_ALARM = 0.5;

export type DispatchAlarmCode =
  | "silent" // nothing dispatched at all — the thing that dispatches is down
  | "unreasoned" // runs answered entirely by the deterministic fallback
  | "degraded" // most runs lost at least one step to the fallback
  | "undecided" // every run recorded zero decisions — decide is returning nothing
  | "nothing-bought"; // dispatches happened, no creator earned anything

export interface DispatchAlarm {
  code: DispatchAlarmCode;
  message: string;
}

/** Compact verdict persisted to sync_state — /status needs counts, not run bodies. */
export interface DispatchHealthSummary {
  checkedAt: string;
  windowHours: number;
  /** Dispatches that settled inside the window. */
  runs: number;
  /** Runs whose every reasoning step was answered by the model the asker picked. */
  modelReasoned: number;
  /** Runs where at least one step, but not all, fell back to the heuristic. */
  partlyHeuristic: number;
  /** Runs where nothing the model produced survived — answered by the heuristic outright. */
  heuristic: number;
  /** Runs that recorded no decision at all (the truncated-reply signature). */
  zeroDecision: number;
  /** Runs that put USDC in at least one creator's hands. */
  paying: number;
  creatorPayoutUsdc: number;
  /** Provider-attempt telemetry begins with v0.8.1; historical runs are intentionally unsampled. */
  reasoningAttemptSamples: number;
  providerFailures: number;
  circuitOpenSkips: number;
  /** Steps served by a real model below tier zero. */
  providerFailoverSteps: number;
  servedBy: Array<{ engine: string; steps: number }>;
  /** Newest dispatch known, window or not — makes "silent" legible ("last one 4h ago"). */
  lastDispatchAt: string | null;
  alarms: DispatchAlarm[];
}

export interface AssessOptions {
  now: Date;
  windowHours?: number;
  /**
   * Whether a model is supposed to be answering. False on a box with no LLM credentials, where
   * heuristic runs are the configured behaviour and alarming on them would be crying wolf.
   */
  expectReasoning: boolean;
}

/**
 * How a run was really answered, read off the label `ResilientEngine.effectiveName` earned for it:
 * `llm:…` when the pick served every step, `llm:… + heuristic on N steps` when some fell through,
 * and a leading `heuristic` when nothing the pick produced survived.
 *
 * An unlabelled run is `unknown`, never `model` — it predates per-run labelling, and counting it as
 * model-reasoned would launder exactly the runs whose reasoning cannot be vouched for. The three
 * counters therefore need not sum to `runs`; the gap is the unvouchable remainder.
 */
function classify(engine: string): "model" | "partial" | "heuristic" | "unknown" {
  const label = engine.trim().toLowerCase();
  if (label === "") return "unknown";
  if (label.startsWith("heuristic")) return "heuristic";
  return label.includes("heuristic") ? "partial" : "model";
}

/** Judges one window of dispatches. Runs may arrive in any order; only their timestamps matter. */
export function assessDispatchHealth(runs: QueryRun[], opts: AssessOptions): DispatchHealthSummary {
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS;
  const cutoff = opts.now.getTime() - windowHours * 3_600_000;

  const newest = runs.reduce<string | null>(
    (max, r) => (max === null || r.createdAt > max ? r.createdAt : max),
    null,
  );
  const recent = runs.filter((r) => new Date(r.createdAt).getTime() >= cutoff);

  const kinds = recent.map((r) => classify(r.engine ?? ""));
  const heuristic = kinds.filter((k) => k === "heuristic").length;
  const partly = kinds.filter((k) => k === "partial").length;
  const zeroDecision = recent.filter((r) => (r.decisions?.length ?? 0) === 0).length;
  const paying = recent.filter((r) => (r.totalToCreators ?? 0) > 0).length;
  const creatorPayoutUsdc = recent.reduce((sum, r) => sum + (r.totalToCreators ?? 0), 0);
  const attempts = recent.flatMap((run) => run.reasoningAttempts ?? []);
  const servedCounts = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.outcome !== "served") continue;
    servedCounts.set(attempt.engine, (servedCounts.get(attempt.engine) ?? 0) + 1);
  }
  const servedBy = [...servedCounts.entries()]
    .map(([engine, steps]) => ({ engine, steps }))
    .sort((a, b) => b.steps - a.steps || a.engine.localeCompare(b.engine));

  const alarms: DispatchAlarm[] = [];

  if (recent.length === 0) {
    // Keryx dispatches continuously; an empty window means whatever dispatches has stopped.
    alarms.push({
      code: "silent",
      message: newest
        ? `no dispatch has settled in ${windowHours}h — the last one was ${newest}`
        : `no dispatch has settled in ${windowHours}h, and none is on record at all`,
    });
  }

  if (opts.expectReasoning && heuristic > 0) {
    alarms.push({
      code: "unreasoned",
      message:
        `${heuristic}/${recent.length} dispatch${heuristic === 1 ? "" : "es"} answered entirely by the ` +
        `deterministic fallback — those buy/skip decisions were not model-reasoned`,
    });
  }

  if (
    opts.expectReasoning &&
    heuristic === 0 &&
    recent.length > 0 &&
    partly / recent.length > DEGRADED_SHARE_ALARM
  ) {
    alarms.push({
      code: "degraded",
      message:
        `${partly}/${recent.length} dispatches lost at least one reasoning step to the fallback — ` +
        `the provider is answering unreliably, not cleanly down`,
    });
  }

  // Zero decisions across the board is structural: a reply that cannot be parsed now fails loudly,
  // so this points at discovery handing decide an empty candidate list.
  if (recent.length >= MIN_RUNS_FOR_SPEND_ALARM && zeroDecision === recent.length) {
    alarms.push({
      code: "undecided",
      message:
        `${recent.length} consecutive dispatches recorded no decision at all — the agent is being ` +
        `offered no candidate sources to reason about`,
    });
  }

  // Citation rewards settle even when the content came from cache, so a window in which no creator
  // earned anything means nothing was cited — not that the agent shopped frugally.
  if (recent.length >= MIN_RUNS_FOR_SPEND_ALARM && paying === 0) {
    alarms.push({
      code: "nothing-bought",
      message:
        `${recent.length} dispatches in ${windowHours}h and no creator earned anything — ` +
        `every run cited nothing, which is the shape of a broken decide step, not a frugal one`,
    });
  }

  return {
    checkedAt: opts.now.toISOString(),
    windowHours,
    runs: recent.length,
    modelReasoned: kinds.filter((k) => k === "model").length,
    partlyHeuristic: partly,
    heuristic,
    zeroDecision,
    paying,
    creatorPayoutUsdc: Number(creatorPayoutUsdc.toFixed(6)),
    reasoningAttemptSamples: attempts.length,
    providerFailures: attempts.filter((attempt) => attempt.outcome === "failed").length,
    circuitOpenSkips: attempts.filter((attempt) => attempt.outcome === "circuit-open").length,
    providerFailoverSteps: attempts.filter(
      (attempt) =>
        attempt.outcome === "served" &&
        attempt.tier > 0 &&
        !attempt.engine.toLowerCase().startsWith("heuristic"),
    ).length,
    servedBy,
    lastDispatchAt: newest,
    alarms,
  };
}

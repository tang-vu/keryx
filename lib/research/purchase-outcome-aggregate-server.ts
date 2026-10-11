import { config } from "../config";
import { getDb } from "../db";
import type { QueryRun } from "../types";
import { privacyReadsActive, requirePrivacy } from "../run-privacy/contracts";
import { usageWindow, type PublicUsageStore, type UsageWindow } from "../usage/contracts";
import { parseDecisionBasis } from "./decision-basis";
import { publicQueryRun } from "./public-query-run";
import { aggregatePurchaseOutcomes, validatePurchaseAggregate, PURCHASE_AGGREGATE_COHORTS, PURCHASE_AGGREGATE_SAMPLE_LIMIT,
  type AggregateRun, type PurchaseOutcomeAggregate } from "./purchase-outcome-aggregate";
import { projectPurchaseOutcomes } from "./purchase-outcomes-projector";

const FILTERS = ["network", "period", "since"];
const TTL_MS = 5 * 60 * 1000, MAX_CACHED_WINDOWS = 32;
const cache = new Map<string, { at: number; value: Promise<PurchaseOutcomeAggregate> }>();

/** Same closed network/period/date filter as public usage. Unknown or repeated selectors refuse. */
export function purchaseAggregateWindow(params: URLSearchParams, now = new Date()): UsageWindow {
  if ([...params.keys()].some(key => !FILTERS.includes(key))) throw new Error("Invalid purchase-outcome filter");
  return usageWindow(params, config.profile.networkId, now);
}

function sampled(run: QueryRun, network: UsageWindow["network"]): AggregateRun {
  const decisions = Array.isArray(run.decisions) ? run.decisions : [];
  let report: AggregateRun["report"] = null;
  // The same public projection and exact-version scorer as the per-report view. A record that
  // cannot be scored is counted as unscorable; it never becomes a zero-cost success.
  try { report = projectPurchaseOutcomes({ ...publicQueryRun(run), archive: null }, network); } catch { /* counted below */ }
  return { id: run.id, createdAt: run.createdAt, recordedDecisions: decisions.length,
    decisionsWithBasis: decisions.filter(decision => parseDecisionBasis(decision?.basis) !== undefined).length, report };
}

/** One bounded pass over the existing classified public-usage window. No source, provider or payment I/O. */
export async function buildPurchaseOutcomeAggregate(window: UsageWindow, store: PublicUsageStore, privacyActive = false): Promise<PurchaseOutcomeAggregate> {
  if (privacyActive && !store.publishedHistory) throw new Error("usage_unavailable");
  const summary = privacyActive ? null : await store.summary(window);
  const cohorts = [];
  for (const cohort of PURCHASE_AGGREGATE_COHORTS) {
    const { windowRuns, runs } = privacyActive ? await store.publishedHistory!(window, cohort, PURCHASE_AGGREGATE_SAMPLE_LIMIT)
      : { windowRuns: summary!.columns.find(column => column.cohort === cohort)?.researchRuns ?? 0,
        runs: await store.history(window, cohort, PURCHASE_AGGREGATE_SAMPLE_LIMIT) };
    cohorts.push({ cohort, windowRuns,
      runs: runs.map(run => sampled(run, window.network)) });
  }
  return aggregatePurchaseOutcomes({ window, cohorts });
}

/**
 * OFF retains the short in-process cache. ON requires fresh admitted publication on each
 * read; a process-map entry (including an old OFF entry) supplies no revocation authority.
 */
export async function readPublicPurchaseAggregate(params: URLSearchParams, now = new Date()): Promise<PurchaseOutcomeAggregate> {
  const window = purchaseAggregateWindow(params, now);
  const db = await getDb();
  if (privacyReadsActive(db)) {
    // A process-local map cannot revoke old observations. Active reads never use or warm it.
    await requirePrivacy(db).list({ take: 1, ids: [] });
    if (!db.publicUsage) throw new Error("usage_unavailable");
    return buildPurchaseOutcomeAggregate(window, db.publicUsage, true);
  }
  const key = JSON.stringify([window.network, window.period, window.period === "custom" ? window.since : null]);
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at >= 0 && now.getTime() - hit.at < TTL_MS) return hit.value;
  const value = (async () => {
    if (!db.publicUsage) throw new Error("usage_unavailable");
    return buildPurchaseOutcomeAggregate(window, db.publicUsage);
  })();
  cache.delete(key);
  if (cache.size >= MAX_CACHED_WINDOWS) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: now.getTime(), value });
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}

/** JSON adapter. Errors are uniform: no private diagnostics and no figures inferred from a failure. */
export async function purchaseAggregateResponse(request: Request,
  read: (params: URLSearchParams) => Promise<unknown> = readPublicPurchaseAggregate): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  const params = new URL(request.url).searchParams;
  try { purchaseAggregateWindow(params); }
  catch { return new Response(JSON.stringify({ error: "invalid_purchase_outcome_filter" }), { status: 400, headers }); }
  try { return new Response(JSON.stringify(validatePurchaseAggregate(await read(params))), { headers }); }
  catch { return new Response(JSON.stringify({ error: "purchase_outcomes_unavailable", complete: false, figures: null }), { status: 503, headers }); }
}

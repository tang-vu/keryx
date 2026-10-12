import { z } from "zod";
import { USAGE_NETWORKS, parseRunUsage, type RunUsage } from "../research/usage-provenance";
import { parseRunProvenance } from "../research/run-provenance";
import { summarizeUsage, PUBLIC_USAGE_SUMMARY_LIMITS, type AuditUsageRun } from "../research-audit/usage-summary";
import type { QueryRun } from "../types";
import type { RunPrivacyStore } from "../run-privacy/contracts";
import { publicHistoryIncludes } from "../research-audit/usage-cohort";

export const MAX_USAGE_RUNS = PUBLIC_USAGE_SUMMARY_LIMITS.runs, MAX_USAGE_PAYMENTS = PUBLIC_USAGE_SUMMARY_LIMITS.payments,
  MAX_USAGE_BYTES = 8 * 1024 * 1024;
const utc = z.string().max(32).refine(value => { try { return new Date(value).toISOString() === value; } catch { return false; } });
export const usageWindowSchema = z.object({ network: z.enum(USAGE_NETWORKS), since: utc, until: utc,
  period: z.enum(["all", "7d", "30d", "custom"]) }).strict().refine(value => value.since < value.until)
  .refine(value => value.period === "all" ? value.since === "1970-01-01T00:00:00.000Z"
    : value.period === "custom" ? value.since.endsWith("T00:00:00.000Z")
    : Date.parse(value.until) - Date.parse(value.since) === (value.period === "7d" ? 7 : 30) * 86400000);
export type UsageWindow = z.infer<typeof usageWindowSchema>;
const id = z.string().min(1).max(256);
export const usageCorpusSchema = z.object({ complete: z.literal(true), window: usageWindowSchema,
  runs: z.array(z.object({ id, createdAt: utc, usage: z.unknown(), provenance: z.unknown(),
    actorId: z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable() }).strict()).max(MAX_USAGE_RUNS),
  payments: z.array(z.object({ id, queryId: id, network: z.string().max(64), kind: z.enum(["fetch", "citation", "inbound", "operating-fee"]),
    amountUsdc: z.union([z.number(), z.string().max(64)]), settled: z.boolean(), settlementStatus: z.string().max(64).nullable(),
    txHash: z.string().max(256).nullable(), payee: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).strict()).max(MAX_USAGE_PAYMENTS),
}).strict();
export type UsageCorpus = z.infer<typeof usageCorpusSchema>;
export class UsageUnavailable extends Error { constructor() { super("usage_unavailable"); } }
export interface PublicUsageStore {
  summary(window: UsageWindow): Promise<PublicUsageSummary>;
  history(window: UsageWindow, cohort: "default" | RunUsage["cohort"], limit: number): Promise<QueryRun[]>;
  /** Separate question population; canonical financial summary includes every visibility. */
  publishedHistory?(window: UsageWindow, cohort: "default" | RunUsage["cohort"], limit: number): Promise<{ windowRuns: number; runs: QueryRun[] }>;
}

export function usageWindow(params: URLSearchParams, network: UsageWindow["network"], now = new Date()): UsageWindow {
  for (const key of ["network", "period", "since", "cohort"]) if (params.getAll(key).length > 1) throw new Error("Invalid usage filter");
  const selected = params.get("network") ?? network, period = params.get("period") ?? "all", date = params.get("since");
  if (!["all", "7d", "30d"].includes(period)) throw new Error("Invalid usage period");
  let since = "1970-01-01T00:00:00.000Z";
  if (date) {
    if (period !== "all" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid usage date");
    since = date + "T00:00:00.000Z";
    if (new Date(since).toISOString() !== since) throw new Error("Invalid usage date");
  } else if (period !== "all") since = new Date(now.getTime() - (period === "7d" ? 7 : 30) * 86400000).toISOString();
  return usageWindowSchema.parse({ network: selected, since, until: now.toISOString(), period: date ? "custom" : period });
}
export function historyCohort(params: URLSearchParams): "default" | RunUsage["cohort"] {
  const value = params.get("cohort") ?? "default";
  if (!["default", "outside", "team", "scripted", "unknown"].includes(value)) throw new Error("Invalid history cohort");
  return value as "default" | RunUsage["cohort"];
}

/** Whole bounded metadata window, not private run bodies or a paginated recent sample. */
export function projectUsageCorpus(raw: unknown, requested: UsageWindow) {
  try {
    if (Buffer.byteLength(JSON.stringify(raw)) > MAX_USAGE_BYTES) throw new UsageUnavailable();
    const corpus = usageCorpusSchema.parse(raw);
    if (JSON.stringify(corpus.window) !== JSON.stringify(requested)) throw new UsageUnavailable();
    if (new Set(corpus.runs.map(row => row.id)).size !== corpus.runs.length || new Set(corpus.payments.map(row => row.id)).size !== corpus.payments.length)
      throw new UsageUnavailable();
    const runIds = new Set(corpus.runs.map(row => row.id));
    if (corpus.payments.some(row => !runIds.has(row.queryId))) throw new UsageUnavailable();
    const networks = new Map<string, Set<string>>();
    for (const payment of corpus.payments) {
      const set = networks.get(payment.queryId) ?? new Set<string>(); set.add(payment.network); networks.set(payment.queryId, set);
    }
    let unattributedNetworkRuns = 0;
    const runs: AuditUsageRun[] = [], classifications = new Map<string, RunUsage | undefined>();
    for (const row of corpus.runs) {
      if (row.createdAt < requested.since || row.createdAt >= requested.until) throw new UsageUnavailable();
      const usage = parseRunUsage(row.usage), known = networks.get(row.id), common = known?.size === 1 ? [...known][0] : undefined;
      const recordedNetwork = usage?.network ?? (USAGE_NETWORKS.includes(common as UsageWindow["network"]) ? common : undefined);
      if (!recordedNetwork) { unattributedNetworkRuns++; continue; }
      if (recordedNetwork !== requested.network) continue;
      const provenance = parseRunProvenance(row.provenance), owned = provenance && provenance.ownershipMethod !== "unknown";
      runs.push({ id: row.id, createdAt: row.createdAt, network: recordedNetwork,
        ...(owned && row.actorId ? { actorId: row.actorId.toLowerCase() } : {}),
        classification: usage ? { cohort: usage.cohort, payment: usage.payment } : { cohort: "unknown", payment: "unknown" } });
      classifications.set(row.id, usage);
    }
    const summary = summarizeUsage({ network: requested.network, since: requested.since, until: requested.until,
      runs, payments: corpus.payments }, "public-window");
    return { runs, classifications, summary: { ...summary, basis: "complete-bounded-database-window" as const,
      period: requested.period, complete: true as const, unattributedNetworkRuns,
      networkRule: "write-time recorded network; legacy only when all recorded payment rows agree on one canonical network; unpaid/mixed legacy unattributed",
      historicalRule: "absent or malformed cohort stays unknown; no database rewrite or actor inference",
      columns: summary.columns.map(column => ({ ...column, acceptedDeliverables: null, medianTimeToFirstAnswerMs: null })),
      acceptanceRule: "unavailable: not inferred from answer completion or feedback",
      latencyRule: "unavailable: no recorded first-answer timestamps; completion duration is not substituted",
      limits: { runs: MAX_USAGE_RUNS, payments: MAX_USAGE_PAYMENTS, bytes: MAX_USAGE_BYTES } } };
  } catch { throw new UsageUnavailable(); }
}
export type PublicUsageSummary = ReturnType<typeof projectUsageCorpus>["summary"];

/** Exhaust the existing bounded classified IDs, never a newest-page proxy for population.
 * Each public-only batch is rechecked before counting. Revocation consumes bounded work;
 * counts/sample may underfill during mutation, with no refill or atomic-snapshot claim. */
export async function publishedUsageHistory(view: Pick<ReturnType<typeof projectUsageCorpus>, "runs" | "classifications">,
  privacy: RunPrivacyStore, cohort: "default" | RunUsage["cohort"], limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new UsageUnavailable();
  await privacy.list({ take: 1, ids: [] }); // Admission is required even for an empty classified window.
  const selected = view.runs.filter(row => cohort === "default" ? publicHistoryIncludes(row.classification.cohort)
    : row.classification.cohort === cohort).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const sample: QueryRun[] = [];
  let windowRuns = 0;
  for (let start = 0; start < selected.length; start += 100) {
    const batch = selected.slice(start, start + 100), candidates = new Map(batch.map(row => [row.id, row]));
    const rows = await privacy.list({ take: batch.length, ids: batch.map(row => row.id) });
    if (rows.length > batch.length || new Set(rows.map(row => row.id)).size !== rows.length) throw new UsageUnavailable();
    for (const row of rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))) {
      if (!candidates.has(row.id)) throw new UsageUnavailable();
      const fresh = await privacy.read(row.id);
      if (!fresh.item || fresh.item.state.visibility !== "public" || fresh.item.state.erased) continue;
      const run = fresh.item.run, classified = candidates.get(row.id)!;
      if (run.id !== row.id || run.createdAt !== classified.createdAt
        || JSON.stringify(parseRunUsage(run.usage)) !== JSON.stringify(view.classifications.get(row.id))) throw new UsageUnavailable();
      windowRuns++;
      if (sample.length < limit) sample.push(run);
    }
  }
  return { windowRuns, runs: sample };
}

import type { QueryRun } from "../types";
import type { TestnetArchiveInfo } from "./testnet-archive";
import { parseRunUsage } from "../research/usage-provenance";

export function mergeQuestionHistory(current: QueryRun[], historical: QueryRun[], limit: number) {
  const records = new Map(historical.map(run => [run.id, { run, historical: true }]));
  for (const run of current) records.set(run.id, { run, historical: false });
  return [...records.values()].sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt) || b.run.id.localeCompare(a.run.id)).slice(0, limit);
}

export function questionSummary(run: QueryRun, archive?: TestnetArchiveInfo) {
  const usage = parseRunUsage(run.usage);
  return { id: run.id, question: run.question, createdAt: run.createdAt, engine: run.engine,
    totalSpent: run.totalSpent, totalToCreators: run.totalToCreators,
    citationCount: run.citations?.length ?? 0, answerSnippet: run.answer?.slice(0, 120) ?? "",
    usage: { cohort: usage?.cohort ?? "unknown", payment: usage?.payment ?? "unknown", network: archive?.network ?? usage?.network ?? "unattributed" },
    ...(archive ? { archive } : {}) };
}

export function historyBefore(params: URLSearchParams): { createdAt: string; id: string } | undefined {
  const createdAt = params.get("before"), id = params.get("beforeId");
  if (createdAt === null && id === null) return undefined;
  if (!createdAt || !id || id.length > 256 || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt)
    throw new Error("Invalid history page");
  return { createdAt, id };
}

export function historyNext(run: Pick<QueryRun, "createdAt" | "id">) {
  return new URLSearchParams({ before: run.createdAt, beforeId: run.id }).toString();
}

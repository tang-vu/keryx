import type { QueryRun } from "../types";
import { safePublicFetchDiagnostic, type PublicFetchDiagnostic } from "../net/public-fetch-diagnostic";

export interface SourceReadOutcome {
  protocol: "keryx-source-read-v1";
  assetId: string;
  kind: "public" | "cache";
  status: "succeeded" | "failed";
  failureCode?: string;
  diagnostic?: PublicFetchDiagnostic;
}
const failureCodes = ["invalid-url", "document-identity-changed", "publisher-verification-required", "transport-unavailable",
  "article-byte-limit", "html-extraction-unavailable", "pdf-extraction-unavailable", "cancelled", "web-operation-limit",
  "document-alias-already-read", "empty-or-duplicate-body", "cache-unavailable", "unavailable"];

function parseOutcome(value: unknown): SourceReadOutcome | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Object.values(fields).some(field => !("value" in field)) || Object.keys(fields).some(key =>
    !["protocol", "assetId", "kind", "status", "failureCode", "diagnostic"].includes(key))) return;
  const row = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
  if (row.protocol !== "keryx-source-read-v1" || typeof row.assetId !== "string" || !row.assetId.length || row.assetId.length > 512 ||
    /[\u0000-\u0020?#]/u.test(row.assetId) || !["public", "cache"].includes(row.kind) || !["succeeded", "failed"].includes(row.status)) return;
  if (row.failureCode !== undefined && (row.status !== "failed" || !failureCodes.includes(row.failureCode))) return;
  const diagnostic = safePublicFetchDiagnostic(row.diagnostic);
  if (row.diagnostic !== undefined && (!diagnostic || row.status !== "failed")) return;
  return { protocol: "keryx-source-read-v1", assetId: row.assetId, kind: row.kind, status: row.status,
    ...(row.failureCode === undefined ? {} : { failureCode: row.failureCode }), ...(diagnostic ? { diagnostic } : {}) };
}

/** Observational trace only: never changes selection, evidence, payment or retry authority. */
export function sourceReadDetail(assetId: string, kind: SourceReadOutcome["kind"], status: SourceReadOutcome["status"],
  failureCode?: string, diagnostic?: PublicFetchDiagnostic): { sourceRead?: SourceReadOutcome } {
  const outcome = parseOutcome({ protocol: "keryx-source-read-v1", assetId, kind, status,
    ...(status === "failed" ? { failureCode: failureCodes.includes(failureCode ?? "") ? failureCode : "unavailable",
      ...(diagnostic ? { diagnostic } : {}) } : {}) });
  return outcome ? { sourceRead: outcome } : {};
}

export function sourceReadSummary(run: Pick<QueryRun, "decisions" | "trace">) {
  const publicIds = new Set(run.decisions.filter(d => d.sourceKind === "public-reference" || d.basis?.rule === "public-read").map(d => d.assetId ?? d.sourceId));
  const selectedPublic = new Set(run.decisions.filter(d => d.action === "CACHE" && publicIds.has(d.assetId ?? d.sourceId)).map(d => d.assetId ?? d.sourceId));
  const selectedCache = new Set(run.decisions.filter(d => d.action === "CACHE" && !publicIds.has(d.assetId ?? d.sourceId)).map(d => d.assetId ?? d.sourceId));
  const ids = new Set(run.decisions.map(d => d.assetId ?? d.sourceId)), outcomes = new Map<string, SourceReadOutcome>();
  for (const step of run.trace) {
    if (step.phase !== "fetch" && step.phase !== "reevaluate" || !step.detail || typeof step.detail !== "object") continue;
    const outcome = parseOutcome(Object.getOwnPropertyDescriptor(step.detail, "sourceRead")?.value);
    if (outcome && ids.has(outcome.assetId) && (outcome.kind === "public") === publicIds.has(outcome.assetId)) outcomes.set(outcome.assetId, outcome);
  }
  const observed = [...outcomes.values()];
  return { publicReads: observed.filter(o => o.kind === "public" && o.status === "succeeded").length,
    cacheHits: observed.filter(o => o.kind === "cache" && o.status === "succeeded").length,
    failedReads: observed.filter(o => o.status === "failed").length,
    publicSelectionsWithoutOutcome: [...selectedPublic].filter(id => !outcomes.has(id)).length,
    cacheSelectionsWithoutOutcome: [...selectedCache].filter(id => !outcomes.has(id)).length };
}

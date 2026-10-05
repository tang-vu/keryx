import { demoteSyntheticEvidence } from "./evidence-provenance";
import { receiptAsset } from "../research-receipt-asset";
import { buildCitationExport } from "../research-citation-export";
import type { Citation, QueryRun } from "../types";
import { buildEvidenceMatrix, evidenceMatrixCsv, type EvidenceMatrixInput } from "./evidence-matrix";
import { z } from "zod";
import type { ReasoningAttempt, ReasoningStep } from "../llm/reasoning-engine";

const reasoningSteps = ["decompose", "decide", "sufficiency", "reevaluate", "synthesize", "attribute"] as const;
const MAX_PUBLIC_REASONING_ATTEMPTS = 256;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reasoningAttemptSchema = z.object({
  step: z.enum(reasoningSteps), engine: z.string().min(1).max(256).refine(value => !/[\r\n\0]/.test(value)),
  tier: count, attempt: count, startedAt: count, durationMs: count,
  outcome: z.enum(["served", "failed", "circuit-open"]), retryAfterMs: count.optional(),
  status: z.number().int().min(100).max(599).optional(),
  error: z.enum(["timeout", "rate_limited", "provider", "network", "invalid_request"]).optional(),
}).refine(value => value.outcome === "circuit-open" ? value.attempt === 0 : value.attempt > 0);

/** Project recorded serving metadata only. Never infer a step from the aggregate engine label,
 * expose provider bodies, or certify primary/model-only serving after omitting telemetry. */
function surfaceReasoning(run: QueryRun) {
  const recorded = run.reasoningAttempts;
  const input: unknown[] = Array.isArray(recorded) ? recorded : [];
  const attempts: ReasoningAttempt[] = [];
  for (const value of input.slice(0, MAX_PUBLIC_REASONING_ATTEMPTS)) {
    const parsed = reasoningAttemptSchema.safeParse(value);
    if (parsed.success) attempts.push(parsed.data);
  }
  const omitted = input.length - attempts.length;
  const telemetry = omitted || recorded != null && !Array.isArray(recorded) ? "incomplete" as const
    : attempts.length ? "recorded" as const : "unavailable" as const;
  const summarize = (step: ReasoningStep) => {
    const served = attempts.filter(attempt => attempt.step === step && attempt.outcome === "served");
    const servingEngines = [...new Set(served.map(attempt => attempt.engine))];
    const heuristic = servingEngines.includes("heuristic");
    const models = servingEngines.some(engine => engine.startsWith("llm:"));
    const state = telemetry !== "recorded" || !served.length || servingEngines.some(engine => engine !== "heuristic" && !engine.startsWith("llm:"))
      ? "unknown" as const : heuristic && models ? "mixed" as const : heuristic ? "heuristic" as const : "model" as const;
    return { step, state, servingEngines,
      fallbackUsed: served.some(attempt => attempt.tier > 0) ? true : telemetry === "recorded" && served.length > 0 ? false : null };
  };
  return { reasoningAttempts: attempts, reasoning: { telemetry, attemptsOmitted: omitted,
    steps: reasoningSteps.filter(step => attempts.some(attempt => attempt.step === step)).map(summarize),
    sourceSelection: summarize("decide") } };
}

/** Public recorded metadata only; no enrichment, network calls or payment authority. */
export function surfaceCitation(citation: Citation) {
  return { marker: citation.marker, sourceId: citation.sourceId, sourceName: citation.sourceName,
    source: citation.sourceName, weight: citation.weight, reward: citation.reward,
    rewardUsdc: citation.reward, rewardPlannedUsdc: citation.reward, rationale: citation.rationale, ...receiptAsset(citation) };
}

export function researchExports(run: EvidenceMatrixInput) {
  return { bibtex: buildCitationExport(run.citations, "bibtex"),
    ris: buildCitationExport(run.citations, "ris"), evidenceCsv: evidenceMatrixCsv(run) };
}

export function surfaceResearch(run: QueryRun) {
  run = demoteSyntheticEvidence(run);
  // Reuse the reading UI's exact claim/article/version and bounded-excerpt gate.
  const evidence = buildEvidenceMatrix(run).flatMap(row => row.evidence).map(item => ({
    claimIndex: item.claimIndex, claim: item.claim, marker: item.marker,
    sourceId: item.sourceId, sourceName: item.sourceName, source: item.sourceName,
    quote: item.quote, support: item.support, qualifiesForAnswer: item.qualifiesForAnswer ?? item.qualifiesForReward,
    qualifiesForReward: item.qualifiesForReward, ...receiptAsset(item),
  }));
  return { citations: run.citations.map(surfaceCitation), evidence,
    ...surfaceReasoning(run),
    creatorsPaid: null, creatorsPaidAuthority: "distinct-settled-count-unavailable" as const,
    creatorsReferenced: new Set(run.citations.map(c => c.sourceId)).size,
    creatorRewardAllocations: new Set(run.citations.filter(c => c.sourceKind !== "public-reference" && c.reward > 0).map(c => c.sourceId)).size,
    paymentMode: run.paymentMode ?? "legacy", pendingSpendUsdc: run.pendingSpendUsdc ?? null,
    subClaims: Array.isArray(run.subClaims) ? [...run.subClaims] : [], claimCoverage: run.claimCoverage ?? [],
    researchExports: researchExports(run) };
}

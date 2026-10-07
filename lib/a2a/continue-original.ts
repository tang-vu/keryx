import { config } from "../config";
import type { KeryxDB } from "../db/keryx-db";
import { OpenAICompatibleEngine } from "../llm/openai-compatible-engine";
import type { ChatJsonOptions } from "../llm/json-chat-engine";
import { ReasoningInputLimitError, ReasoningOutputValidationError, type ReasoningEngine, type SufficiencyInput } from "../llm/reasoning-engine";
import { evidenceContext } from "../llm/evidence-context";
import { buildQuoteOptions, resolveQuoteEvidence } from "../llm/quote-options";
import { buildEvidenceReviewInput } from "../llm/evidence-review-input";
import { MAX_REVIEWED_EVIDENCE } from "../llm/evidence-review";
import { ORIGINAL_FULFILLMENT_LIMITS as LIMITS } from "./failed-original-fulfillment-protocol";
import type { FulfillmentEvidenceGap } from "./original-fulfillment-answer";
import { assembleOriginalFulfillmentRun, originalFulfillmentEvidenceGaps, reasoningInput, validateOriginalFulfillmentPrompt } from "./fulfill-original";
import { assertContinuationSupplierAdmission, beginOriginalContinuation, closeContinuationCapability,
  continuationModel, continuationProviderLedger, continuationSupplierSignal, prepareContinuationResult,
  recordContinuationDiagnostic, type ContinuationCapability } from "../business-operator/fulfillment-continuation-policy";

type Stage = "sufficiency" | "synthesize" | "review";
type Phase = Stage | "assemble";
type Category = "input-limit" | "output-validation" | "transport" | "incomplete-review" | "quality" | "unknown";
class ContinuationFailure extends Error {
  constructor(readonly phase: Phase, readonly category: Category) {
    super(`Original continuation ${phase} ${category}; retain the claim and every reservation`);
  }
}
function failed(phase: Phase, category: Category): never { throw new ContinuationFailure(phase, category); }
const score = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** The finite continuation keeps the ordinary evidence semantics and full independent
 * review. Only its generation allowance differs; policy owns every dispatch/checkpoint. */
class OriginalContinuationEngine extends OpenAICompatibleEngine {
  private stageIndex = 0;
  private proposedRows = 0;
  private retainedGaps: FulfillmentEvidenceGap[] = [];
  private diagnostic?: { phase: Phase; category: Category };
  constructor(apiKey: string, private readonly capability: ContinuationCapability,
    private readonly input: SufficiencyInput, private readonly requiredTargets: readonly number[]) {
    super({ provider: "deepseek", name: "llm:deepseek:deepseek-v4-flash", model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com", apiKey, redirect: "error" });
  }
  get evidenceGaps() { return structuredClone(this.retainedGaps); }
  get failure() { return this.diagnostic; }
  protected supportsDecisionBrief(): boolean { return false; }
  protected synthesisGenerationTokens(): number { return LIMITS.maximumOutputTokens; }
  protected assertSupplierAdmission(): void { assertContinuationSupplierAdmission(this.capability); }
  protected supplierAbortSignal(): AbortSignal { return continuationSupplierSignal(this.capability, config.llmTimeoutMs); }
  protected validateChatJsonInput(_model: string, system: string, user: string, maxTokens = 2048) {
    validateOriginalFulfillmentPrompt(system, user, maxTokens);
  }
  async decompose(): Promise<string[]> { return failed("assemble", "unknown"); }
  async decide(): ReturnType<ReasoningEngine["decide"]> { return failed("assemble", "unknown"); }
  async reevaluate(): ReturnType<ReasoningEngine["reevaluate"]> { return failed("assemble", "unknown"); }
  async attribute(): ReturnType<ReasoningEngine["attribute"]> { return failed("assemble", "unknown"); }

  private validateGeneration(result: Record<string, unknown>) {
    if (typeof result.answer !== "string" || !result.answer.trim() || !Array.isArray(result.citedMarkers) ||
      result.citedMarkers.some(marker => typeof marker !== "string") || !Array.isArray(result.evidence) ||
      !result.evidence.length || result.evidence.length > MAX_REVIEWED_EVIDENCE) failed("synthesize", "output-validation");
    if (result.evidence.some(row => !row || typeof row !== "object" || !score((row as Record<string, unknown>).support)))
      failed("synthesize", "output-validation");
    const options = buildQuoteOptions(evidenceContext(this.input.question, this.input.subClaims, this.input.gathered), this.input.gathered);
    const proposals = resolveQuoteEvidence(result.evidence, options);
    const review = buildEvidenceReviewInput({ proposals, options, gathered: this.input.gathered, subClaims: this.input.subClaims });
    // Never checkpoint an invalid/partial review packet as successful generation.
    // The same exact raw proposal set must survive server binding and review bounds.
    if (review.reviewedIndexes.size !== result.evidence.length || proposals.some(row => !row.statement) ||
      this.requiredTargets.some(index => !proposals.some(row => row.claimIndex === index && row.statement)))
      failed("synthesize", "incomplete-review");
    this.proposedRows = result.evidence.length;
  }
  private validateReview(result: Record<string, unknown>, user: string) {
    const supplied = (JSON.parse(user) as { evidence: Array<{ index: number }> }).evidence;
    if (!Array.isArray(result.reviews) || result.reviews.length !== supplied.length) failed("review", "output-validation");
    const indexes = new Set<number>();
    for (const raw of result.reviews) {
      if (!raw || typeof raw !== "object") failed("review", "output-validation");
      const row = raw as Record<string, unknown>;
      if (typeof row.index !== "number" || !Number.isInteger(row.index) || indexes.has(row.index) ||
        !supplied.some(item => item.index === row.index) || typeof row.supportedFact !== "string" || !row.supportedFact.trim() ||
        !score(row.support) || !score(row.statementSupport)) failed("review", "output-validation");
      indexes.add(row.index);
    }
  }
  protected async chatJson(model: string, system: string, user: string, maxTokens = 2048, options?: ChatJsonOptions) {
    const stage = (["sufficiency", "synthesize", "review"] as const)[this.stageIndex++];
    if (!stage) return failed("assemble", "unknown");
    try {
      validateOriginalFulfillmentPrompt(system, user, maxTokens);
      if (stage === "review") {
        const rows = (JSON.parse(user) as { evidence?: unknown[] }).evidence;
        if (!Array.isArray(rows) || rows.length !== this.proposedRows) failed("review", "incomplete-review");
      }
      const validate = (result: Record<string, unknown>) => {
        if (stage === "sufficiency") {
          try { this.retainedGaps = originalFulfillmentEvidenceGaps(result, this.input.subClaims); }
          catch { failed("sufficiency", "output-validation"); }
          const rows = result.perClaim as Record<string, unknown>[];
          if (rows.some(row => typeof row.supportedAnswer !== "string" || !score(row.coverage) || !Array.isArray(row.coveredBy) ||
            row.coveredBy.some(marker => typeof marker !== "string" || !this.input.gathered.some(source => source.marker === marker))))
            failed("sufficiency", "output-validation");
        } else if (stage === "synthesize") this.validateGeneration(result);
        else this.validateReview(result, user);
        return result;
      };
      const result = await continuationModel(this.capability, stage, system, user, maxTokens,
        async () => validate(await super.chatJson(model, system, user, maxTokens, options)));
      // Replay still rebuilds private quote binding and validates all semantic rows.
      return validate(result);
    } catch (error) {
      const category = error instanceof ContinuationFailure ? error.category : error instanceof ReasoningInputLimitError
        ? "input-limit" : error instanceof ReasoningOutputValidationError ? "output-validation" : "transport";
      this.diagnostic = { phase: stage, category };
      recordContinuationDiagnostic(this.capability, this.diagnostic);
      throw new ContinuationFailure(stage, category);
    }
  }
}

/** Prepare a fully reviewed result for the existing native claim. Delivery remains a
 * separate exact-digest metadata operation; this function starts no order or payment. */
export async function completeOriginalContinuation(db: KeryxDB, authorizationFile: string, authorizationSha256: string, apiKey: string) {
  if (!apiKey.trim()) throw new Error("Original continuation requires the explicit DeepSeek credential");
  const admitted = await beginOriginalContinuation(db, authorizationFile, authorizationSha256);
  const binding = admitted.binding.original, input = reasoningInput(binding), startedAtMs = Date.now();
  const engine = new OriginalContinuationEngine(apiKey, admitted.capability, input, binding.authorization.requiredSupportedTargetIndexes);
  let phase: Phase = "sufficiency";
  try {
    const assessment = await engine.sufficiency(input);
    phase = "synthesize";
    const synthesized = await engine.synthesize(input);
    if (engine.failure) failed(engine.failure.phase, engine.failure.category);
    phase = "assemble";
    const providerLedger = continuationProviderLedger(admitted.binding);
    const run = assembleOriginalFulfillmentRun({ binding, claim: admitted.claim, assessment, synthesized,
      evidenceGaps: engine.evidenceGaps, providerLedger, engine, startedAtMs, completedAtMs: Date.now() });
    const prepared = prepareContinuationResult(admitted.capability, run);
    return { prepared: true, runSha256: prepared.runSha256, providerLedgerSha256: prepared.providerLedgerSha256,
      selectedSources: run.citations.length, reviewedStatements: run.originalFulfillment!.statements.length,
      newModelCalls: providerLedger.newModelCalls, combinedReservedMicroUsd: providerLedger.combinedReservedMicroUsd,
      originalProviderBilling: "unknown", paidDeliveryObligation: "unresolved", payments: 0, searches: 0 };
  } catch (error) {
    if (!engine.failure) recordContinuationDiagnostic(admitted.capability, { phase, category: error instanceof ContinuationFailure
      ? error.category : error instanceof ReasoningInputLimitError ? "input-limit" : phase === "assemble" ? "quality" : "unknown" });
    throw error instanceof ContinuationFailure ? error : new ContinuationFailure(phase,
      error instanceof ReasoningInputLimitError ? "input-limit" : phase === "assemble" ? "quality" : "unknown");
  } finally { closeContinuationCapability(admitted.capability); }
}

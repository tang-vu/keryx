import { config } from "../config";
import type { KeryxDB } from "../db/keryx-db";
import { OpenAICompatibleEngine } from "../llm/openai-compatible-engine";
import { JsonChatEngine, type ChatJsonOptions } from "../llm/json-chat-engine";
import { ReasoningInputLimitError, ReasoningOutputValidationError, type ReasoningEngine, type SufficiencyInput, type SynthInput } from "../llm/reasoning-engine";
import { originalFulfillmentContext } from "./original-fulfillment-context";
import { buildQuoteOptions, resolveQuoteEvidence } from "../llm/quote-options";
import { buildEvidenceReviewInput } from "../llm/evidence-review-input";
import { MAX_REVIEWED_EVIDENCE } from "../llm/evidence-review";
import { ORIGINAL_FULFILLMENT_GENERATION_GUIDANCE } from "../llm/original-fulfillment-quality";
import { buildOriginalFulfillmentQualityReviewInput } from "../llm/original-fulfillment-review-input";
import { ORIGINAL_FULFILLMENT_LIMITS as LIMITS } from "./failed-original-fulfillment-protocol";
import type { FulfillmentEvidenceGap } from "./original-fulfillment-answer";
import { supplementaryQuoteOptions, type FulfillmentSupplementContext } from "./fulfillment-supplement-evidence";
import { assembleOriginalFulfillmentRun, originalFulfillmentEvidenceGaps, reasoningInput, validateOriginalFulfillmentPrompt } from "./fulfill-original";
import { assertContinuationSupplierAdmission, beginOriginalContinuation, closeContinuationCapability,
  continuationModel, continuationProviderLedger, continuationSupplierSignal, prepareContinuationResult,
  recordContinuationDiagnostic, continuationQualityEvidenceCapability, continuationQualityEvidenceProtocol,
  type ContinuationCapability, type ContinuationQualityEvidenceCapability } from "../business-operator/fulfillment-continuation-policy";

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
  private readonly supplementalQuotes?: ReturnType<typeof supplementaryQuoteOptions>;
  constructor(apiKey: string, private readonly capability: ContinuationCapability,
    private readonly input: SufficiencyInput, private readonly requiredTargets: readonly number[], supplement?: FulfillmentSupplementContext,
    private readonly qualityEvidence?: ContinuationQualityEvidenceCapability) {
    super({ provider: "deepseek", name: "llm:deepseek:deepseek-v4-flash", model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com", apiKey, redirect: "error" });
    if (qualityEvidence) {
      if (!supplement) failed("assemble", "unknown");
      continuationQualityEvidenceProtocol(qualityEvidence, supplement.contextSha256);
    }
    this.supplementalQuotes = supplement ? supplementaryQuoteOptions(supplement, qualityEvidence) : undefined;
  }
  get evidenceGaps() { return structuredClone(this.retainedGaps); }
  get failure() { return this.diagnostic; }
  protected supportsDecisionBrief(): boolean { return false; }
  protected synthesisGenerationTokens(): number { return LIMITS.maximumOutputTokens; }
  protected synthesisGenerationGuidance(input: SynthInput): string {
    return this.qualityEvidence ? ORIGINAL_FULFILLMENT_GENERATION_GUIDANCE : super.synthesisGenerationGuidance(input);
  }
  protected evidenceSources(input: SufficiencyInput) { return originalFulfillmentContext(input); }
  protected synthesisQuoteOptions(input: SufficiencyInput, sources: ReturnType<typeof originalFulfillmentContext>) {
    return this.supplementalQuotes ? [...buildQuoteOptions(sources.filter(source => !source.sourceId.startsWith("public:fulfillment:supplement:")), input.gathered),
      ...this.supplementalQuotes.options] : super.synthesisQuoteOptions(input, sources);
  }
  protected synthesisEvidenceReviewInput(input: Parameters<typeof buildEvidenceReviewInput>[0]) {
    const bound = { ...input, supplementalCapability: this.supplementalQuotes?.capability };
    return this.qualityEvidence ? buildOriginalFulfillmentQualityReviewInput(bound) : buildEvidenceReviewInput(bound);
  }
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
    const options = this.synthesisQuoteOptions(this.input, this.evidenceSources(this.input));
    const proposals = resolveQuoteEvidence(result.evidence, options);
    const review = this.synthesisEvidenceReviewInput({ proposals, options, gathered: this.input.gathered, subClaims: this.input.subClaims });
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

class ContinuationPromptPreflight extends JsonChatEngine {
  readonly name = "continuation-readonly-preflight";
  readonly prompts: ReturnType<typeof validateOriginalFulfillmentPrompt>[] = [];
  private readonly supplementalQuotes?: ReturnType<typeof supplementaryQuoteOptions>;
  constructor(supplement?: FulfillmentSupplementContext, private readonly qualityEvidence?: ContinuationQualityEvidenceCapability) {
    super();
    if (qualityEvidence) {
      if (!supplement) failed("assemble", "unknown");
      continuationQualityEvidenceProtocol(qualityEvidence, supplement.contextSha256);
    }
    this.supplementalQuotes = supplement ? supplementaryQuoteOptions(supplement, qualityEvidence) : undefined;
  }
  protected evidenceSources(input: SufficiencyInput) { return originalFulfillmentContext(input); }
  protected synthesisQuoteOptions(input: SufficiencyInput, sources: ReturnType<typeof originalFulfillmentContext>) {
    return this.supplementalQuotes ? [...buildQuoteOptions(sources.filter(source => !source.sourceId.startsWith("public:fulfillment:supplement:")), input.gathered),
      ...this.supplementalQuotes.options] : super.synthesisQuoteOptions(input, sources);
  }
  protected synthesisGenerationTokens(): number { return LIMITS.maximumOutputTokens; }
  protected synthesisGenerationGuidance(input: SynthInput): string {
    return this.qualityEvidence ? ORIGINAL_FULFILLMENT_GENERATION_GUIDANCE : super.synthesisGenerationGuidance(input);
  }
  protected async chatJson(_model: string, system: string, user: string, maxTokens = 2048) {
    this.prompts.push(validateOriginalFulfillmentPrompt(system, user, maxTokens));
    return {};
  }
}

/** Build the same full-body sufficiency/generation wire prompts without a supplier,
 * credential, claim or mutation. The complete generated review remains separately bounded. */
export async function preflightOriginalContinuation(binding: Parameters<typeof reasoningInput>[0], supplement?: FulfillmentSupplementContext,
  qualityEvidence?: ContinuationQualityEvidenceCapability) {
  const engine = new ContinuationPromptPreflight(supplement, qualityEvidence), input = reasoningInput(binding, supplement);
  await engine.sufficiency(input);
  await engine.synthesize(input);
  if (engine.prompts.length !== 2) failed("assemble", "unknown");
  return { packetSha256: binding.packet.packetSha256, inputSemanticSha256: binding.packet.inputSemanticSha256,
    targets: input.subClaims.length, selectedSources: input.gathered.length, prompts: engine.prompts,
    providerRequests: 0, searches: 0, payments: 0 };
}

/** Prepare a fully reviewed result for the existing native claim. Delivery remains a
 * separate exact-digest metadata operation; this function starts no order or payment. */
export async function completeOriginalContinuation(db: KeryxDB, authorizationFile: string, authorizationSha256: string, apiKey: string) {
  if (!apiKey.trim()) throw new Error("Original continuation requires the explicit DeepSeek credential");
  const admitted = await beginOriginalContinuation(db, authorizationFile, authorizationSha256);
  const binding = admitted.binding.original, startedAtMs = Date.now();
  let engine: OriginalContinuationEngine | undefined;
  let phase: Phase = "sufficiency";
  try {
    const input = reasoningInput(binding, admitted.binding.supplement);
    const qualityEvidence = admitted.binding.qualityProtocol ? continuationQualityEvidenceCapability(admitted.capability) : undefined;
    if (admitted.binding.qualityProtocol && !qualityEvidence) failed("assemble", "unknown");
    engine = new OriginalContinuationEngine(apiKey, admitted.capability, input, binding.authorization.requiredSupportedTargetIndexes,
      admitted.binding.supplement, qualityEvidence);
    const assessment = await engine.sufficiency(input);
    // A genuine negative assessment is retained by policy. Generation/review cannot
    // raise final coverage above this assessment, so refuse before consuming their holds.
    if (binding.authorization.requiredSupportedTargetIndexes.some(index => {
      const row = assessment.perClaim?.[index];
      return !row || row.coverage < 0.4 || !row.coveredBy.some(marker => input.gathered.some(source => source.marker === marker));
    })) failed("sufficiency", "quality");
    phase = "synthesize";
    const synthesized = await engine.synthesize(input);
    if (engine.failure) failed(engine.failure.phase, engine.failure.category);
    phase = "assemble";
    const providerLedger = continuationProviderLedger(admitted.binding);
    const run = assembleOriginalFulfillmentRun({ binding, claim: admitted.claim, assessment, synthesized,
      evidenceGaps: engine.evidenceGaps, providerLedger, engine, startedAtMs, completedAtMs: Date.now(), supplement: admitted.binding.supplement,
      qualityProtocol: admitted.binding.qualityProtocol, qualityEvidenceCapability: qualityEvidence });
    const prepared = prepareContinuationResult(admitted.capability, run);
    return { prepared: true, runSha256: prepared.runSha256, providerLedgerSha256: prepared.providerLedgerSha256,
      selectedSources: run.citations.length, reviewedStatements: run.originalFulfillment!.statements.length,
      newModelCalls: providerLedger.newModelCalls, combinedReservedMicroUsd: providerLedger.combinedReservedMicroUsd,
      originalProviderBilling: "unknown", paidDeliveryObligation: "unresolved", payments: 0, searches: 0 };
  } catch (error) {
    if (!engine?.failure) recordContinuationDiagnostic(admitted.capability, { phase, category: error instanceof ContinuationFailure
      ? error.category : error instanceof ReasoningInputLimitError ? "input-limit" : phase === "assemble" ? "quality" : "unknown" });
    throw error instanceof ContinuationFailure ? error : new ContinuationFailure(phase,
      error instanceof ReasoningInputLimitError ? "input-limit" : phase === "assemble" ? "quality" : "unknown");
  } finally { closeContinuationCapability(admitted.capability); }
}

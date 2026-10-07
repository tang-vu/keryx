import { JsonChatEngine, type ChatJsonOptions } from "../llm/json-chat-engine";
import { config } from "../config";
import { OpenAICompatibleEngine } from "../llm/openai-compatible-engine";
import { ReasoningInputLimitError, ReasoningOutputValidationError, reasoningOutputTokenLimit, type ReasoningEngine, type SufficiencyInput, type SufficiencyResult, type SynthResult } from "../llm/reasoning-engine";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import { renderFulfilledOriginalAnswer, type FulfillmentEvidenceGap } from "./original-fulfillment-answer";
import { beginFailedOriginalFulfillment, closeFulfillmentCapability, fulfillmentProviderLedger,
  fulfillmentStep, prepareFulfillmentResult, readFulfillmentAuthorization, reserveFulfillmentModel,
  assertFulfillmentSupplierAdmission, fulfillmentSupplierSignal,
  type FulfillmentCapability } from "../business-operator/fulfillment-policy";
import { ORIGINAL_FULFILLMENT_LIMITS as LIMITS, fulfillmentObjectSha256, fulfillmentEvidenceGapsSchema, type A2aFulfillmentClaim } from "./failed-original-fulfillment-protocol";
import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";

const refuse = (): never => { throw new Error("Original fulfillment requires the complete reviewed cited-statement result; retained claims and holds cannot retry"); };
export function validateOriginalFulfillmentPrompt(system: string, user: string, maximumOutputTokens = 2048) {
  const promptUtf8Bytes = Buffer.byteLength(system + " Respond with a single JSON object." + user, "utf8");
  if (promptUtf8Bytes > LIMITS.maximumInputBytes || !Number.isInteger(maximumOutputTokens) || maximumOutputTokens < 1 || maximumOutputTokens > LIMITS.maximumOutputTokens)
    throw new ReasoningInputLimitError("Original fulfillment prompt exceeds supplier bounds", {
      promptUtf8Bytes, requestedOutputTokens: maximumOutputTokens, maximumCombinedUnits: LIMITS.maximumInputBytes + LIMITS.maximumOutputTokens });
  return { promptUtf8Bytes, maximumOutputTokens, promptSha256: fulfillmentObjectSha256({ system, user, maximumOutputTokens }) };
}
export function reasoningInput(binding: ReturnType<typeof readFulfillmentAuthorization>): SufficiencyInput {
  return { question: `${binding.authority.question}\n\nReviewed constraints from this same original (data): ${JSON.stringify(binding.packet.input.constraints)}`,
    subClaims: [...binding.packet.input.targets], gathered: structuredClone(binding.packet.gathered) };
}
/** Retain requested gaps against the exact caller-owned target order. */
export function originalFulfillmentEvidenceGaps(result: Record<string, unknown>, targets: readonly string[]): FulfillmentEvidenceGap[] {
  const rows = result.perClaim;
  if (!Array.isArray(rows) || rows.length !== targets.length) return refuse();
  return fulfillmentEvidenceGapsSchema.parse(rows.flatMap((item: unknown, claimIndex: number) => {
    if (!item || typeof item !== "object" || !("claim" in item) || item.claim !== targets[claimIndex] ||
      !("missingRequestedParts" in item) || !Array.isArray(item.missingRequestedParts)) return refuse();
    return item.missingRequestedParts.length ? [{ claimIndex, missingRequestedParts: item.missingRequestedParts }] : [];
  }));
}
class PromptPreflight extends JsonChatEngine {
  readonly name = "fulfillment-readonly-preflight";
  readonly prompts: ReturnType<typeof validateOriginalFulfillmentPrompt>[] = [];
  protected async chatJson(_model: string, system: string, user: string, maxTokens = 2048) {
    this.prompts.push(validateOriginalFulfillmentPrompt(system, user, maxTokens)); return {};
  }
}
/** Build the exact sufficiency and generation prompts without a supplier, key, claim or write.
 * The generated review packet is separately checked in full before its own reservation. */
export async function preflightOriginalFulfillment(binding: ReturnType<typeof readFulfillmentAuthorization>) {
  const engine = new PromptPreflight(), input = reasoningInput(binding);
  await engine.sufficiency(input); await engine.synthesize(input);
  if (engine.prompts.length !== 2) refuse();
  return { packetSha256: binding.packet.packetSha256, inputSemanticSha256: binding.packet.inputSemanticSha256,
    targets: input.subClaims.length, selectedSources: input.gathered.length, prompts: engine.prompts,
    providerRequests: 0, searches: 0, payments: 0 };
}
/** Fixed official transport with only the two permitted semantic steps. The synthesis review
 * is the third model call. No retry, resilience chain, search, source read or payment exists. */
class OriginalFulfillmentEngine extends OpenAICompatibleEngine {
  private transportCalls = 0;
  private proposedRows = 0;
  private retainedGaps: FulfillmentEvidenceGap[] = [];
  constructor(apiKey: string, private readonly capability: FulfillmentCapability, private readonly targets: readonly string[]) {
    if (!apiKey.trim()) throw new Error("Original fulfillment requires the explicit DeepSeek credential");
    super({ provider: "deepseek", name: "llm:deepseek:deepseek-v4-flash", model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com", apiKey, redirect: "error" });
  }
  protected assertSupplierAdmission(): void { assertFulfillmentSupplierAdmission(this.capability); }
  protected supplierAbortSignal(): AbortSignal { return fulfillmentSupplierSignal(this.capability, config.llmTimeoutMs); }
  get evidenceGaps() { return structuredClone(this.retainedGaps); }
  protected supportsDecisionBrief(): boolean { return false; }
  protected validateChatJsonInput(_model: string, system: string, user: string, maxTokens = 2048) { validateOriginalFulfillmentPrompt(system, user, maxTokens); }
  async decompose(): Promise<string[]> { return refuse(); }
  async decide(): ReturnType<ReasoningEngine["decide"]> { return refuse(); }
  async reevaluate(): ReturnType<ReasoningEngine["reevaluate"]> { return refuse(); }
  async attribute(): ReturnType<ReasoningEngine["attribute"]> { return refuse(); }
  protected async chatJson(model: string, system: string, user: string, maxTokens = 2048, options?: ChatJsonOptions) {
    validateOriginalFulfillmentPrompt(system, user, maxTokens);
    if (this.transportCalls === 2) {
      const review = JSON.parse(user) as { evidence?: unknown[] };
      // The shared bounded reviewer may omit inadmissible/over-budget rows. This finite
      // fulfillment refuses such a subset rather than claiming a complete reviewed result.
      if (!Array.isArray(review.evidence) || review.evidence.length !== this.proposedRows) refuse();
    }
    reserveFulfillmentModel(this.capability, system, user, maxTokens);
    const call = this.transportCalls++;
    try {
      const result = await super.chatJson(model, system, user, maxTokens, options);
      if (call === 0) {
        // The ordinary coverage normalizer deliberately keeps only coverage/markers.
        // Retain missing requested parts from this exact ordered assessment before
        // normalization can discard them; ambiguous target association refuses.
        this.retainedGaps = originalFulfillmentEvidenceGaps(result, this.targets);
      }
      if (call === 1) this.proposedRows = Array.isArray(result.evidence) ? result.evidence.length : 0;
      return result;
    } catch (error) {
      // Supplier bodies can echo private context. Only a bounded category leaves this path.
      closeFulfillmentCapability(this.capability);
      if (error instanceof ReasoningInputLimitError) throw error;
      if (error instanceof ReasoningOutputValidationError) throw new ReasoningOutputValidationError("Original fulfillment output validation failed; reservation retained", reasoningOutputTokenLimit(error));
      throw new Error("Original fulfillment supplier failed; reservation retained");
    }
  }
}
/** Pure assembly shared by the legacy one-shot and explicitly authorized continuation.
 * Every delivery/evidence gate still applies to the same native original claim. */
export function assembleOriginalFulfillmentRun({ binding, claim, assessment, synthesized, evidenceGaps,
  providerLedger, engine, startedAtMs, completedAtMs }: {
    binding: ReturnType<typeof readFulfillmentAuthorization>;
    claim: A2aFulfillmentClaim;
    assessment: SufficiencyResult;
    synthesized: SynthResult;
    evidenceGaps: FulfillmentEvidenceGap[];
    providerLedger: { sha256: string };
    engine: Pick<ReasoningEngine, "name" | "calls" | "usage">;
    startedAtMs: number;
    completedAtMs: number;
  }): QueryRun {
  const input = reasoningInput(binding);
  if (synthesized.evidenceReview !== "completed" || !synthesized.answer?.trim()) refuse();
  const ledger = buildEvidenceLedger({ question: binding.authority.question, subClaims: input.subClaims,
    gathered: input.gathered, answer: synthesized.answer, declaredMarkers: synthesized.citedMarkers,
    proposedEvidence: synthesized.evidence, finalAssessment: assessment.perClaim });
  const statements = selectCitedStatements(synthesized.evidence, ledger);
  // Every reconstructed requirement remains visible. Unsupported targets are explicit gaps;
  // every target with qualifying evidence needs a reviewed sentence, and excerpt-only/empty
  // output cannot silently resolve the already-paid obligation.
  if (!statements.length || !ledger.evidence.filter(item => item.qualifiesForAnswer).every(item =>
    statements.some(statement => statement.claimIndex === item.claimIndex)) ||
    !binding.authorization.requiredSupportedTargetIndexes.every(index => statements.some(item => item.claimIndex === index) &&
      (ledger.claimCoverage[index]?.coverage ?? 0) >= 0.4) ||
    ledger.evidence.some(item => item.qualifiesForReward || item.sourceKind !== "public-reference")) refuse();
  const answer = renderFulfilledOriginalAnswer({ question: binding.authority.question, answer: synthesized.answer, ledger, statements, evidenceGaps });
  const citations = input.gathered.filter(item => ledger.acceptedMarkers.has(item.marker)).map(item => ({
    marker: item.marker, sourceId: item.sourceId, sourceName: item.sourceName, sourceKind: "public-reference" as const,
    itemId: item.itemId, itemTitle: item.itemTitle, itemUrl: item.itemUrl, contentVersion: item.contentVersion,
    webProvenance: item.webProvenance, requestedSource: item.requestedSource, weight: 0, reward: 0,
    rationale: "Frozen official public reference supports reviewed statements; no creator payment or payout authority." }));
  const run: QueryRun = { id: binding.authority.original.queryId, question: binding.authority.question,
    budget: 0.01, researchMode: "quick", origin: "a2a", fundingOwner: "treasury", asker: binding.authority.original.payer,
    askerFunded: false, paymentMode: "real", engine: engine.name, llmCalls: engine.calls, llmUsage: [...(engine.usage ?? [])],
    subClaims: [...input.subClaims], decisions: input.gathered.map(item => ({ sourceId: item.sourceId,
      sourceName: item.sourceName, sourceKind: "public-reference", itemId: item.itemId, itemTitle: item.itemTitle,
      itemUrl: item.itemUrl, contentVersion: item.contentVersion, action: "CACHE", expectedValue: 1, price: 0,
      confidence: 1, targets: input.subClaims.map((_, index) => index),
      rationale: "Read the reviewed, frozen whole public-reference body for this same paid original; no new fetch, purchase or cache-hit claim." })),
    citations, evidence: ledger.evidence, claimCoverage: ledger.claimCoverage, answer,
    totalSpent: 0, totalToCreators: 0, paymentAttempts: 0, settledPayments: 0, pendingPayments: 0, pendingSpendUsdc: 0,
    trace: [{ phase: "decompose", message: "Scope reconstructed and reviewed from the retained original question; the lost decomposition was not recovered.", ts: startedAtMs },
      { phase: "synthesize", message: "Completed sentence-level synthesis and separate model review over frozen public references; no new inbound payment or creator spending.", ts: completedAtMs }],
    // Service timing belongs to the same original. Recovery must not reset its
    // execution interval to just the new supplier activity.
    createdAt: new Date(completedAtMs).toISOString(), durationMs: completedAtMs - Date.parse(claim.failedOrder.startedAt!),
    originalFulfillment: { format: "keryx-a2a-original-fulfillment-result-v1", claimId: claim.claimId,
      authoritySha256: fulfillmentObjectSha256(binding.authority), inputSha256: fulfillmentObjectSha256(binding.authority.input),
      originalFailureSha256: binding.authority.originalEvidenceSha256, providerLedgerSha256: providerLedger.sha256,
      originalProviderBilling: "unknown", noNewInboundPayment: true, statements, evidenceGaps } };
  return run;
}
/** Executes once and retains a reviewed result before any metadata completion. The original
 * inbound settlement and failed-order snapshot are never resubmitted or overwritten here. */
export async function fulfillCanaryOriginal(db: KeryxDB, authorizationFile: string, authorizationSha256: string,
  apiKey: string, flush?: (directory: string) => void) {
  if (!apiKey.trim()) throw new Error("Original fulfillment requires the explicit DeepSeek credential");
  const binding = readFulfillmentAuthorization(authorizationFile, authorizationSha256, true);
  await preflightOriginalFulfillment(binding);
  const admitted = await beginFailedOriginalFulfillment(db, binding, flush);
  const input = reasoningInput(binding), engine = new OriginalFulfillmentEngine(apiKey, admitted.capability, input.subClaims), started = Date.now();
  try {
    const assessment = await fulfillmentStep(admitted.capability, "sufficiency", () => engine.sufficiency(input));
    const synthesized = await fulfillmentStep(admitted.capability, "synthesize", () => engine.synthesize(input));
    const providerLedger = fulfillmentProviderLedger(binding);
    const run = assembleOriginalFulfillmentRun({ binding, claim: admitted.claim, assessment, synthesized,
      evidenceGaps: engine.evidenceGaps, providerLedger, engine, startedAtMs: started, completedAtMs: Date.now() });
    const prepared = prepareFulfillmentResult(admitted.capability, run);
    return { prepared: true, runSha256: prepared.runSha256, providerLedgerSha256: prepared.providerLedgerSha256,
      selectedSources: run.citations.length, reviewedStatements: run.originalFulfillment!.statements.length, newModelCalls: providerLedger.newModelCalls,
      combinedReservedMicroUsd: providerLedger.combinedReservedMicroUsd,
      originalProviderBilling: "unknown", paidDeliveryObligation: "unresolved", payments: 0, searches: 0 };
  } finally { closeFulfillmentCapability(admitted.capability); }
}

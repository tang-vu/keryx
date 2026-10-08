/**
 * JsonChatEngine — shared reasoning logic for any chat LLM that can return JSON.
 * Subclasses implement only `chatJson(model, system, user)`. The prompts (the actual
 * "thinking") live here once, so Anthropic and DeepSeek behave identically.
 */

import { config } from "../config";
import { prepareSelectionBatches, ResearchSelectionPartialBatchError } from "./selection-input";
import { MAX_RESEARCH_TARGETS } from "./research-target-limits";
import { boundedResearchPlan } from "./research-plan";
import { cloneUsage } from "../economics/provider-cost-policy";
import { LlmCallLedger } from "./call-ledger";
import { evidenceContext, EVIDENCE_CONTEXT_GUIDANCE } from "./evidence-context";
import { buildQuoteOptions, resolveQuoteEvidence, type QuoteOption } from "./quote-options";
import { STATEMENT_GENERATION_GUIDANCE } from "./cited-statement";
import { presentationStatementGuidance } from "../research/answer-presentation";
import { buildContextualQuoteOptions } from "./quote-context";
import { prepareDecisionBrief, reviewDecisionBrief, briefEvidence, briefContextSources, briefReviewPacket, BRIEF_GENERATION_GUIDANCE, BRIEF_REVIEW_GUIDANCE, BRIEF_COMPACT_REVIEW_SCHEMA } from "./decision-brief";
import { COVERAGE_GUIDANCE, normalizeCoverage, canStopForCoverage } from "./coverage-assessment";
import { applyEvidenceReview, EVIDENCE_REVIEW_GUIDANCE, MAX_REVIEWED_EVIDENCE } from "./evidence-review";
import { buildEvidenceReviewInput, MAX_EVIDENCE_REVIEW_INPUT_BYTES } from "./evidence-review-input";
import { MAX_SELECTION_DIAGNOSTIC_HISTORY, ResearchSelectionError, invalidResearchSelectionOutput, parseResearchSelection } from "./research-selection";
import { parseSelectionDiagnostic, type SelectionDiagnostic } from "../research/selection-diagnostic";
import type { Decision } from "../types";
import { ReasoningOutputValidationError, outputTokenLimitFromValidatedError } from "./reasoning-engine";
import { synthesisOutputLimitFromError } from "./output-limit-diagnostic";
import { EVIDENCE_ONLY_SCHEMA, evidenceOnlyEnvelope, evidenceOnlyGuidance } from "./evidence-only-synthesis";
import { validTeachingProposalRequest } from "../research/teaching-proposals-request";
import { prepareTeachingProposals, reviewTeachingProposals, teachingProposalReviewInput,
  TEACHING_PROPOSAL_GENERATION_GUIDANCE, type PreparedTeachingProposals } from "../research/teaching-proposals";
import type {
  AttributeInput,
  DecideInput,
  ReevaluateInput,
  ReevaluateOutput,
  ReasoningEngine,
  SufficiencyInput,
  SufficiencyResult,
  SynthInput,
  SynthResult,
  SynthesisFailureStage,
  SynthesisOutputLimit,
  Conflict,
  LlmUsageRecord,
} from "./reasoning-engine";

export interface ChatJsonOptions { reasoningReview?: boolean }

export abstract class JsonChatEngine implements ReasoningEngine {
  abstract readonly name: string;
  private readonly usageRecords: LlmUsageRecord[] = [];
  private readonly callLedger = new LlmCallLedger();
  private readonly selectionRecords: SelectionDiagnostic[] = [];
  /** Opt in only transports whose bounded reasoning review has been evaluated. */
  protected supportsDecisionBrief(): boolean { return false; }
  /** Exact wire-prompt bounds before a supplier call is admitted to the accounting ledger. */
  protected validateChatJsonInput(..._args: Parameters<JsonChatEngine["chatJson"]>): void {}

  get calls() { return this.callLedger.calls; }

  get selectionDiagnostics(): readonly SelectionDiagnostic[] {
    return this.selectionRecords.map(value => parseSelectionDiagnostic(value)!);
  }

  private recordSelectionDiagnostic(value: SelectionDiagnostic): void {
    this.selectionRecords.push(parseSelectionDiagnostic(value)!);
    if (this.selectionRecords.length > MAX_SELECTION_DIAGNOSTIC_HISTORY) this.selectionRecords.shift();
  }

  private measuredChatJson(...args: Parameters<JsonChatEngine["chatJson"]>) {
    this.validateChatJsonInput(...args);
    return this.callLedger.track(this.name, () => this.chatJson(...args));
  }

  get usage(): readonly LlmUsageRecord[] {
    return this.usageRecords.map(cloneUsage);
  }

  /** Store only provider counters. Never store prompts, completions, or request identifiers. */
  protected recordUsage(usage: Omit<LlmUsageRecord, "engine">): void {
    const valid = (value: number) => Number.isSafeInteger(value) && value >= 0;
    if (!valid(usage.inputTokens) || !valid(usage.outputTokens) ||
      (usage.cachedInputTokens !== null && (!valid(usage.cachedInputTokens) || usage.cachedInputTokens > usage.inputTokens))) return;
    this.usageRecords.push(cloneUsage({
      engine: this.name,
      callId: this.callLedger.currentId,
      model: usage.model,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      ...(usage.costCapture ? { costCapture: usage.costCapture } : {}),
    }));
  }

  /**
   * Call the model and return a parsed JSON object. Subclass-specific transport.
   *
   * `maxTokens` matters for the steps whose reply scales with the corpus: one line per candidate
   * source, per gathered excerpt, per citation. A reply that hits the ceiling comes back as
   * truncated JSON, which parses to nothing — and "nothing" used to look exactly like a decision to
   * buy nothing. Implementations MUST throw when the model stops on the length limit rather than
   * hand back a half-object. Planning and selection classify this as a terminal local refusal;
   * other stages retain their existing fallback behavior and output-validation telemetry.
   */
  protected abstract chatJson(
    model: string,
    system: string,
    user: string,
    maxTokens?: number,
    options?: ChatJsonOptions,
  ): Promise<Record<string, unknown>>;

  /**
   * Output ceiling for a reply that carries one entry per item. Generous per item (a rationale is
   * prose) with a floor for the fixed parts and a hard cap well inside provider limits, so a corpus
   * that grows does not silently walk into truncation the way 20 sources did against a flat 2048.
   */
  protected budgetFor(items: number): number {
    return Math.min(8192, 1024 + items * 256);
  }

  /** Specialized finite callers can budget the complete generated result within their
   * own authority. Ordinary synthesis keeps its existing per-source budget. */
  protected synthesisGenerationTokens(input: SynthInput): number {
    return this.budgetFor(4 + input.gathered.length);
  }

  /** Specialized finite callers may retain a complete, already-admitted corpus.
   * Ordinary research keeps its bounded passage selection and metadata. */
  protected evidenceSources(input: SufficiencyInput): ReturnType<typeof evidenceContext> {
    return evidenceContext(input.question, input.subClaims, input.gathered);
  }

  async decompose(question: string): Promise<string[]> {
    return boundedResearchPlan(question, () => this.measuredChatJson(
      config.llmModel,
      "You plan research for Keryx, a reading agent that pays content access tolls and distributes USDC creator rewards according to cited contributions. " +
        `Break the user's question into 1-${MAX_RESEARCH_TARGETS} concise questions to investigate, NOT proposed answers or assertions of fact. ` +
        "Preserve the user's terminology and scope. Explicit user context takes precedence over Keryx's product context; questions can concern any subject. " +
        "Separate information needs from instructions about sources, citations, format, or style. Carry relevant source/scope constraints into the substantive questions; do not turn those instructions into extra research targets. " +
        "A request to propose an activity, illustrative example, exercise, or exit question is a prospective delivery constraint, not a historical fact that the source performed or tested it. Preserve the requested proposal and its labeling in constraints; investigate the factual definitions, distinctions and limitations needed to ground it. " +
        "For example, a teacher requesting weather/climate definitions, two invented classification examples and a ten-minute activity needs factual definition/distinction/limitation targets, not targets asking whether NASA ran those invented activities. If the user instead asks which activities NASA actually tested, preserve that as a factual target. " +
        "Each target must ask for a distinct requested fact or explanation. Do not add an umbrella question that repeats the other targets, or split one fact into paraphrases to fill the range. " +
        "Distinguish comparison SUBJECTS from evidence REFERENCES: complementary documentation URLs about a subject are source constraints, not extra comparison subjects. Do not multiply every dimension by every reference URL. " +
        "When the user compares specific papers or independent sources themselves, preserve every requested dimension for each specific source as a separately inspectable target. " +
        "For example, comparing two exact papers' methods, evaluation setup and limitations requires six targets: each dimension for each paper, retaining its exact version. " +
        "Do not omit limitations or combine both papers into one target that evidence from only one paper could appear to cover. " +
        "For example, a systemd comparison of default stopping, TimeoutStopSec=infinity and SendSIGKILL=no can use three distinct behavior targets under the still-running-worker condition, three deployment-risk targets (one per setting), and one shared pre-replacement-check target: seven total. The table instruction is a format constraint. Preserve conditions and each setting; do not add a second set of paraphrased behavior targets. " +
        "For example, comparing live SQLite .db copying with the Online Backup API can use separate consistency, concurrent-write and locking targets for each method, plus one backup/restore-verification target: seven total. WAL and Backup documentation URLs qualify these needs; they are not two more subjects. Snapshot creation must not be equated with verified restore. " +
        "First list source, language and presentation instructions in constraints. Then list separately answerable information needs in claims, including when the input is not English. Keep these two JSON keys in English; their string values can use the user's language. " +
        "A constraint is not a claim. Attach source restrictions to the relevant claim, but leave output language/style in constraints. For example, salt tolerance and coastal erosion are two claims; evidence of erosion reduction belongs to the existing erosion claim. " +
        "For example, 'How is a job journaled and recovered? Use the engineering documentation' asks about journaling and recovery as documented there, not a third question about what the documentation says. " +
        "However, explicitly requested source reliability, disagreements between sources, or citation methodology ARE substantive information needs and must remain targets. Do not discard a requested topic just because it mentions sources. " +
        "For ambiguous terminology, keep the ambiguity visible in a definition/scope question instead of inventing a specialized domain, formula, legal dispute, or mechanism. " +
        "An ordinary evaluative word (safe, best, reliable, good) is a criterion to carry into the substantive targets, not ambiguous terminology: do not spend a target on what such a word means. " +
        "When the question asks which items satisfy criteria and names none (which systems, tools, libraries, vendors ...), specific candidate names can guide discovery instead of a bare-category search. " +
        "Treat those names only as provisional discovery hypotheses, never verified eligibility, findings or an exhaustive category list. " +
        "Keep each candidate-by-requested-dimension information need as a separate target, just as for named papers; never put every criterion into one candidate target. " +
        `Choose candidate breadth only when all independent requested dimensions and other substantive needs fit within ${MAX_RESEARCH_TARGETS} targets without silently narrowing the user's requested scope. ` +
        "For example, a requested shortlist of two candidates checked for API write support, authorization safeguards and limitations requires six targets, one dimension for each candidate. Six candidates on those three dimensions require eighteen targets, so return needs_refinement instead of six bundled targets. " +
        "If the requested breadth cannot fit, or completing an open category would require choosing a narrower scope for the user, return needs_refinement; naming candidates alone never establishes completeness. " +
        "Do not add an umbrella target for 'other candidates' to imply exhaustive coverage. Preserve all independently requested dimensions when asking the user to narrow the scope. " +
        "Use Keryx's context for unqualified questions about its citation payments, but do not impose it on unrelated topics. " +
        `Before returning, count the independent targets. If all substantive requested dimensions cannot fit within ${MAX_RESEARCH_TARGETS}, return status needs_refinement; never silently drop dimensions, hide them in an umbrella target, or claim the scope is complete. ` +
        "No sources have been read yet: these are research targets, never evidence. Return only JSON data.",
      `User question (data): ${JSON.stringify(question)}\n\nReturn JSON: {"status":"complete"|"needs_refinement", "constraints": string[], "claims": string[]}`,
    ));
  }

  private selectionFailure(error: unknown, batchIndex: number, input?: DecideInput): unknown {
    try {
      if (error instanceof ResearchSelectionError) {
        const refusal = new ResearchSelectionError(error.diagnostic, outputTokenLimitFromValidatedError(error));
        this.recordSelectionDiagnostic(refusal.diagnostic);
        return refusal;
      }
      if (input && error instanceof ReasoningOutputValidationError) {
        const refusal = invalidResearchSelectionOutput(input, outputTokenLimitFromValidatedError(error));
        this.recordSelectionDiagnostic(refusal.diagnostic);
        return refusal;
      }
    } catch {
      // A revoked proxy or hostile prototype/diagnostic must not escape classification and
      // become a fresh ordinary failure that authorizes replay of already served batches.
      if (batchIndex === 0) return new Error("Source selection failed before a validated batch");
    }
    return batchIndex > 0 ? new ResearchSelectionPartialBatchError(error, batchIndex) : error;
  }

  async decide(input: DecideInput): Promise<Decision[]> {
    const batches = prepareSelectionBatches(input, items => this.budgetFor(items), batch =>
      this.validateChatJsonInput(config.llmModel, batch.system, batch.user, batch.maxTokens));
    const decisions: Decision[] = [];
    for (const [batchIndex, batch] of batches.entries()) {
      let out: Record<string, unknown>;
      try { out = await this.measuredChatJson(config.llmModel, batch.system, batch.user, batch.maxTokens); }
      catch (error) {
        throw this.selectionFailure(error, batchIndex, batch.input);
      }
      try {
        const selection = parseResearchSelection(batch.input, out);
        if (selection.diagnostic) this.recordSelectionDiagnostic(selection.diagnostic);
        // Merge validated rows only: another batch's ID cannot gain authority through a raw union.
        decisions.push(...selection.decisions);
      } catch (error) {
        throw this.selectionFailure(error, batchIndex);
      }
    }
    return decisions;
  }

  async sufficiency(input: SufficiencyInput): Promise<SufficiencyResult> {
    const out = await this.measuredChatJson(
      config.llmModel,
      "You decide if enough has been read to answer confidently. For EACH sub-claim, estimate its coverage (0.0 = not covered, 1.0 = fully supported) " +
        "and list which source markers cover it. " + COVERAGE_GUIDANCE +
        "Stop early only when every sub-claim has a direct supported answer, coverage at least 0.7, " +
        "and no requested part still missing. Do not omit a requested gap merely to reach a stopping score. " + EVIDENCE_CONTEXT_GUIDANCE + "Output strict JSON.",
      JSON.stringify({
        question: input.question,
        subClaims: input.subClaims,
        gathered: this.evidenceSources(input),
        schema:
          '{"rationale":string,"perClaim":[{"claim":string,"supportedAnswer":string,"missingRequestedParts":string[],"coverage":number(0..1),"coveredBy":string[]}]}',
      }),
      this.budgetFor(input.subClaims.length + input.gathered.length),
    );
    // The claim text is caller-owned state. Preserve the requested order and wording rather than
    // trusting the model to repeat it exactly; a harmless paraphrase must not erase final coverage.
    const perClaim = normalizeCoverage(out.perClaim, input.subClaims, input.gathered);
    const sufficient = canStopForCoverage(out.perClaim, perClaim);
    const rationale = typeof out.rationale === "string" ? out.rationale : "";
    return {
      sufficient,
      rationale: sufficient ? rationale : [rationale,
        "The assessment does not establish a complete supported answer for every requested part."].filter(Boolean).join(" "),
      perClaim: perClaim.length > 0 ? perClaim : undefined,
    };
  }

  async reevaluate(input: ReevaluateInput): Promise<ReevaluateOutput> {
    const out = await this.measuredChatJson(
      config.llmModel,
      "You are a research agent that has already read some sources. Now assess coverage per sub-claim. " + COVERAGE_GUIDANCE +
        "For each claim, estimate how well the gathered content supports it (0.0 = not covered, 1.0 = fully covered). " +
        "If any claim has coverage below 0.5 AND there are affordable skipped sources that could fill the gap, " +
        "recommend buying them (in priority order). Only recommend sources whose price fits the remaining budget. " +
        "Be frugal — don't buy more if coverage is already adequate. " + EVIDENCE_CONTEXT_GUIDANCE + "Output strict JSON.",
      JSON.stringify({
        question: input.question,
        subClaims: input.subClaims,
        gathered: this.evidenceSources(input),
        skippedSources: input.skippedSources.map((s) => ({
          id: s.id,
          name: s.name,
          price: s.price,
          preview: s.preview.slice(0, 300),
        })),
        remainingBudget: input.remainingBudget,
        schema:
          '{"claims":[{"claim":string,"coverage":number(0..1),"coveredBy":string[],"rationale":string}],"shouldBuyMore":boolean,"recommendedIds":string[],"rationale":string}',
      }),
      this.budgetFor(input.subClaims.length + input.skippedSources.length),
    );
    if (out.claims !== undefined && !Array.isArray(out.claims)) throw new ReasoningOutputValidationError("reevaluate returned malformed claims");
    const claims = (out.claims as ReevaluateOutput["claims"]) ?? [];
    if (claims.some(claim => !claim || typeof claim !== "object" || Array.isArray(claim))) throw new ReasoningOutputValidationError("reevaluate returned a malformed claim");
    return {
      claims: claims.map((c) => ({
        claim: c.claim ?? "",
        coverage: clamp01(c.coverage),
        coveredBy: Array.isArray(c.coveredBy) ? c.coveredBy : [],
        rationale: c.rationale ?? "",
      })),
      shouldBuyMore: Boolean(out.shouldBuyMore),
      recommendedIds: Array.isArray(out.recommendedIds)
        ? (out.recommendedIds as string[])
        : [],
      rationale: (out.rationale as string) ?? "",
    };
  }

  async synthesize(input: SynthInput): Promise<SynthResult> {
    if (input.answerFormat === "decision-brief" && this.supportsDecisionBrief()) return this.synthesizeDecisionBrief(input);
    // Protected originals have no ordinary generation opt-in. Even a stray
    // teaching flag on a legacy/decision-brief input cannot alter their contract.
    const teachingRequest = input.generationFormat === "evidence-only" && !input.answerFormat && input.teachingRequest &&
      validTeachingProposalRequest(input.teachingRequest, input.question) ? input.teachingRequest : undefined;
    const sources = this.evidenceSources(input);
    const quoteOptions = this.synthesisQuoteOptions(input, sources);
    const generation = {
      question: input.question,
      researchTargets: input.subClaims.map((question, claimIndex) => ({ claimIndex, question })),
      sources,
      quoteOptions: this.synthesisGenerationQuoteOptions(input, quoteOptions),
      schema: input.generationFormat === "evidence-only" ? EVIDENCE_ONLY_SCHEMA :
        '{"answer":string (markdown with [S#] citations),"citedMarkers":string[],' +
        '"evidence":[{"claimIndex":number,"marker":string,"quoteId":string,"support":number(0..1),"statement":string}],' +
        '"conflicts":[{"point":string,"positions":[{"marker":string,"stance":string}],"trusted":string,"reason":string}]}',
    };
    let generationSystem = this.synthesisGenerationGuidance(input), generationJson = JSON.stringify(generation);
    const generationTokens = this.synthesisGenerationTokens(input);
    let teachingGeneration = false;
    if (teachingRequest) {
      const system = generationSystem + " For this admitted teaching request, also return teachingProposals. " +
        TEACHING_PROPOSAL_GENERATION_GUIDANCE +
        `Write factual statements in ${teachingRequest.language === "vi" ? "Vietnamese" : "English"}, with at most ${teachingRequest.explanationMaximumWords} explanatory words collectively. ` +
        "Preserve every factual qualification. Prioritize factual evidence; omit proposals rather than weakening facts to fit the unchanged output budget.";
      const json = JSON.stringify({ ...generation, teachingRequest,
        schema: generation.schema.slice(0, -1) + ',"teachingProposals":[{"id":string,"kind":"activity"|"classification-example"|"exit-question","text":string,"premiseIds":string[],"conditions":string[],"durationMinutes":number (activity only),"answer":string (examples/exit only)}]}' });
      try {
        // Local preflight only. Refusing the addition keeps the ordinary factual
        // request intact; it is not a supplier retry or a second generation.
        this.validateChatJsonInput(config.synthesisModel, system, json, generationTokens);
        generationSystem = system; generationJson = json; teachingGeneration = true;
      } catch { /* Keep the unchanged ordinary generation, with proposals withheld. */ }
    }
    // Retain the admitted ceiling even when the ordinary packet omits a redundant prose draft.
    const out = await this.measuredChatJson(config.synthesisModel, generationSystem, generationJson, generationTokens);
    const proposals = resolveQuoteEvidence(out.evidence, quoteOptions);
    const teaching: PreparedTeachingProposals | undefined = teachingRequest ? teachingGeneration
      ? prepareTeachingProposals(teachingRequest, input.question, proposals, out.teachingProposals)
      : { gaps: [{ reason: "invalid-proposals" }] } : undefined;
    let review: unknown;
    let reviewedIndexes: ReadonlySet<number> = new Set();
    let synthesisOutputLimit: SynthesisOutputLimit | undefined;
    let teachingReview = false;
    if (proposals.length) {
      try {
        const reviewInput = this.synthesisEvidenceReviewInput({ proposals, options: quoteOptions, gathered: input.gathered, subClaims: input.subClaims });
        reviewedIndexes = reviewInput.reviewedIndexes;
        let reviewSystem = EVIDENCE_REVIEW_GUIDANCE, reviewJson = reviewInput.json;
        if (teaching?.packet?.proposals.length) {
          try {
            const teachingInput = teachingProposalReviewInput(teaching.packet);
            const factualInput = JSON.parse(reviewInput.json);
            const system = reviewSystem + " " + teachingInput.guidance +
              " Language also checks every packet premise statement against the requested explanation language; source quotes retain their original language.";
            const json = JSON.stringify({ ...factualInput, teachingProposals: teachingInput.packet,
              schema: factualInput.schema.slice(0, -1) + ',"teachingProposalReview":' + teachingInput.schema + '}' });
            // Same 32KB bound and 1024-byte framing reserve as the factual review.
            // Keep ALL already-admitted factual rows and source neighborhoods.
            if (Buffer.byteLength(system + json, "utf8") + 1024 <= MAX_EVIDENCE_REVIEW_INPUT_BYTES) {
              this.validateChatJsonInput(config.llmModel, system, json, this.budgetFor(Math.min(proposals.length, MAX_REVIEWED_EVIDENCE)));
              reviewSystem = system; reviewJson = json; teachingReview = true;
            }
          } catch { /* Review facts once; the proposal addition has no authority. */ }
        }
        if (reviewedIndexes.size) review = await this.measuredChatJson(
          config.llmModel,
          reviewSystem,
          reviewJson,
          this.budgetFor(Math.min(proposals.length, MAX_REVIEWED_EVIDENCE)),
        );
      } catch (error) {
        // Keep the written answer after a review outage; unreviewed evidence cannot earn rewards.
        review = undefined;
        synthesisOutputLimit = synthesisOutputLimitFromError(error, "review");
      }
    }
    const evidence = applyEvidenceReview(proposals, review, reviewedIndexes);
    const envelope = input.generationFormat === "evidence-only" ? evidenceOnlyEnvelope(input, evidence) : undefined;
    return {
      answer: envelope?.answer ?? (out.answer as string) ?? "",
      citedMarkers: envelope?.citedMarkers ?? (Array.isArray(out.citedMarkers) ? (out.citedMarkers as string[]) : []),
      evidence,
      ...(proposals.length ? { evidenceReview: review && typeof review === "object" && Array.isArray((review as { reviews?: unknown }).reviews)
        ? "completed" as const : "unavailable" as const } : {}),
      conflicts: parseConflicts(out.conflicts),
      ...(synthesisOutputLimit ? { synthesisOutputLimit } : {}),
      ...(teaching ? { teachingProposals: { preparationGaps: teaching.gaps,
        ...(teachingReview && teaching.packet ? { reviewed: reviewTeachingProposals(teaching.packet,
          review && typeof review === "object" ? (review as Record<string, unknown>).teachingProposalReview : undefined) } : {}) } } : {}),
    };
  }

  /** Private completion may replace generation guidance without changing the
   * sufficiency prompt or ordinary research's existing contract. */
  protected synthesisGenerationGuidance(input: SynthInput): string {
    if (input.generationFormat === "evidence-only") return evidenceOnlyGuidance +
      (input.answerPresentation ? presentationStatementGuidance(input.answerPresentation) : "");
    return "You write a grounded, accurate answer using ONLY the provided sources. " + EVIDENCE_CONTEXT_GUIDANCE +
        "Cite inline with the source markers like [S1]. Cite every claim. Do not invent facts. " +
        "For every supported research question, select a quoteId from quoteOptions in an evidence item with " +
        "the claimIndex explicitly supplied in researchTargets and the option's exact marker. " +
        "Reuse that same claimIndex for multiple quotes answering one target; do not number answer sentences or evidence items. " +
        "Do not output raw quote text or invent IDs. " +
        STATEMENT_GENERATION_GUIDANCE +
        (input.answerPresentation ? presentationStatementGuidance(input.answerPresentation) : "") +
        "Each option is already a bounded verbatim excerpt; choose only options that directly answer that question. " +
        "A related warning or shared topic is not evidence for an unmentioned procedure. " +
        "Select the smallest sufficient set, at most two options per research question; emit separate evidence items when needed. " +
        "If no option supports an answer, state the gap and omit its evidence; never assume every option deserves a citation. " +
        "Address every research question in the answer, explicitly naming any unanswered part. " +
        "A source belongs in `citedMarkers` only when it appears inline and has an evidence item. " +
        "If the sources do not support a claim, say so and emit no citation/evidence for it. " +
        "When two or more sources disagree on a factual point, do NOT average or blur them: decide " +
        "which to trust based on specificity, internal consistency, and recency; write the answer " +
        "reflecting the trusted source; and record each disagreement in `conflicts` (use an empty " +
        "array when the sources are consistent). Output strict JSON.";
  }

  protected synthesisQuoteOptions(input: SynthInput, sources: ReturnType<typeof evidenceContext>): QuoteOption[] {
    return buildQuoteOptions(sources, input.gathered, { includeShortBlocks: Boolean(input.answerPresentation?.requestedBulletCount) });
  }
  /** Specialized completion may carry server-owned required target bindings in
   * its compact menu. Ordinary research's generation payload stays identical. */
  protected synthesisGenerationQuoteOptions(_input: SynthInput, options: QuoteOption[]):
    Array<Pick<QuoteOption, "quoteId" | "marker" | "text"> & { claimIndex?: number }> {
    return options.map(({ quoteId, marker, text }) => ({ quoteId, marker, text }));
  }
  protected synthesisEvidenceReviewInput(input: Parameters<typeof buildEvidenceReviewInput>[0]) {
    return buildEvidenceReviewInput(input);
  }

  private async synthesizeDecisionBrief(input: SynthInput): Promise<SynthResult> {
    const fallback: SynthResult = { answer: "", citedMarkers: [], evidence: [], conflicts: [], evidenceReview: "unavailable" };
    let failureStage: SynthesisFailureStage = "input";
    let synthesisOutputLimit: SynthesisOutputLimit | undefined;
    const unavailable = (): SynthResult => ({ ...fallback, synthesisFailure: failureStage,
      ...(synthesisOutputLimit ? { synthesisOutputLimit } : {}) });
    try {
      const selectedSources = this.evidenceSources(input);
      const options = buildContextualQuoteOptions(selectedSources, input.gathered);
      if (!options.length) return unavailable();
      // Reserve the complete selected corpus first. Eagerly expanding every menu
      // alternative could exceed the bound before the model selected any quote.
      // No selected passage, target or adverse source is removed to admit a call.
      const sources = briefContextSources(selectedSources, input, []);
      failureStage = "generation";
      const raw = await this.measuredChatJson(config.synthesisModel, BRIEF_GENERATION_GUIDANCE,
        JSON.stringify({ question: input.question,
          researchTargets: input.subClaims.map((question, targetIndex) => ({ targetIndex, question })), sources,
          quoteOptions: options.map(({ quoteId, marker, text, start, end }) => ({ quoteId, marker, text, start, end })),
          schema: '{"facts":[{"id":"f1","targetIndex":0,"text":string,"quoteIds":string[],"support":number}],"actions":[{"id":"a1","text":string,"premiseIds":string[],"conditions":string[]}]}' }), 4096);
      const candidate = prepareDecisionBrief(input, raw, options, sources);
      if (!candidate) return unavailable();
      if (!candidate.candidate.facts.length) return { ...fallback, evidenceReview: "completed" };
      // Review keeps the generator's entire base corpus and gains the full
      // neighborhoods of its selected quotes. Actual union overflow still fails
      // closed; there is no second generation or provider repair call.
      failureStage = "input";
      const reviewedSources = briefContextSources(selectedSources, input, candidate.quotes);
      const packet = prepareDecisionBrief(input, candidate.candidate, options, reviewedSources)!;
      failureStage = "review";
      const review = await this.measuredChatJson(config.llmModel, BRIEF_REVIEW_GUIDANCE,
        JSON.stringify({ packet: briefReviewPacket(packet), schema: BRIEF_COMPACT_REVIEW_SCHEMA }), 4096, { reasoningReview: true });
      const decisionBrief = reviewDecisionBrief(packet, review);
      if (!decisionBrief) return unavailable();
      const evidence = briefEvidence(decisionBrief);
      const citedMarkers = [...new Set(evidence.map(item => item.marker))];
      // Only a marker envelope reaches the old evidence gate. Human prose is
      // rendered later from surviving reviewed rows after all existing gates.
      return { answer: citedMarkers.map(marker => `[${marker}]`).join(" "), citedMarkers, evidence,
        conflicts: [], evidenceReview: "completed", decisionBrief };
    } catch (error) {
      // A malformed generation/review, transport outage or input cap must not
      // discard completed paid reads or route an unreviewed narrative to the UI.
      synthesisOutputLimit = synthesisOutputLimitFromError(error, failureStage === "review" ? "review" : "generation");
      return unavailable();
    }
  }

  async attribute(
    input: AttributeInput,
  ): Promise<{ sourceId: string; weight: number; rationale: string }[]> {
    const out = await this.measuredChatJson(
      config.synthesisModel,
      "You assign each cited source a contribution weight (0..1) for how much it grounded the answer. " + EVIDENCE_CONTEXT_GUIDANCE + "Weights must sum to ~1. Output strict JSON.",
      JSON.stringify({
        question: input.question,
        answer: input.answer,
        sources: evidenceContext(input.question, [], input.used),
        schema: '{"attributions":[{"sourceId":string,"weight":number,"rationale":string}]}',
      }),
      this.budgetFor(input.used.length),
    );
    if (out.attributions !== undefined && !Array.isArray(out.attributions)) throw new ReasoningOutputValidationError("attribute returned malformed attributions");
    const atts =
      (out.attributions as { sourceId: string; weight: number; rationale: string }[]) ?? [];
    if (atts.some(attribution => !attribution || typeof attribution !== "object" || Array.isArray(attribution) ||
      typeof attribution.weight !== "number" || !Number.isFinite(attribution.weight))) throw new ReasoningOutputValidationError("attribute returned a malformed attribution");
    const total = atts.reduce((s, a) => s + (a.weight || 0), 0) || 1;
    return atts.map((a) => ({
      sourceId: a.sourceId,
      weight: clamp01(a.weight / total),
      rationale: a.rationale ?? "",
    }));
  }
}

export function extractJson(text: string): Record<string, unknown> {
  // A valid JSON string can itself contain fenced source/code examples. Parse
  // the whole response first; only a surrounding fence is a transport wrapper.
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReasoningOutputValidationError("Model response is not a JSON object");
    return value as Record<string, unknown>;
  };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { /* inspect an outer wrapper below */ }
  if (parsed !== undefined) return object(parsed);
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)```$/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new ReasoningOutputValidationError("Model response is not valid JSON");
  try {
    return object(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    throw new ReasoningOutputValidationError("Model response is not a valid JSON object");
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Defensively validate the model's `conflicts` array — drop malformed entries and cap the
 *  count so a hallucinated list can never spam the trace. Only well-formed disagreements with
 *  at least two stances survive; missing preference remains explicitly unresolved. */
function parseConflicts(raw: unknown): Conflict[] {
  if (!Array.isArray(raw)) return [];
  const out: Conflict[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const point = typeof o.point === "string" ? o.point.trim() : "";
    const trusted = typeof o.trusted === "string" ? o.trusted.trim() : "";
    const reason = typeof o.reason === "string" ? o.reason.trim() : "";
    const positions = Array.isArray(o.positions)
      ? o.positions
          .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
          .map((p) => ({
            marker: typeof p.marker === "string" ? p.marker.trim() : "",
            stance: typeof p.stance === "string" ? p.stance.trim() : "",
          }))
          .filter((p) => p.marker && p.stance)
      : [];
    if (!point || positions.length < 2) continue;
    out.push({ point, positions, trusted: trusted || "none", reason });
    if (out.length >= 5) break;
  }
  return out;
}

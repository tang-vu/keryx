import { demoteSyntheticEvidence } from "../research/evidence-provenance";
import { answerPresentation } from "../research/answer-presentation";
import { confidenceBanner, ordinaryConfidence } from "../research/confidence-copy";
import { discussionDoesNotMeetDocumentRequest, requestedSourceUrls } from "../research/source-requirements";
import { emptyEvidenceAnswer, researchResponseLanguage } from "./empty-public-evidence";
import { researchFollowUp } from "./research-follow-up";
import { documentAlreadyRead, documentSelectionKey } from "./document-selection";
import { synthesisFailureDetail } from "./synthesis-failure";
import { parseSynthesisOutputLimit, synthesisOutputLimitFromError } from "../llm/output-limit-diagnostic";
import { finalizeGroundedAnswer } from "./answer-grounding";
import { compactWordBudgetAnswer, finishWordBudgetAnswer } from "./word-budget-answer";
import { selectCitedStatements } from "./cited-statements";
import { deliverDecisionBrief } from "./decision-brief";
import { discoverPublicReferences } from "./public-reference-evidence";
import { discoverScholarly } from "../scholarly/discovery";
import { paperCanResearch, paperDuplicatesPublicBody } from "../scholarly/paid-gate";
import { questionDois } from "../scholarly/doi";
import { discoverWeb } from "../web-research/discovery";
import { requestedSources } from "../web-research/requested-sources";
import { requestedSourceReport } from "./requested-source-report";
import { arxivDocumentId } from "../scholarly/arxiv-identity";
import { searxngProvider } from "../web-research/search-provider";
import { tavilyProvider } from "../web-research/tavily-provider";
import { admitBoundedResearch, bindBoundedResearchAdmission } from "../research/research-allowance";
import { admitBusinessCanaryRun, bindBusinessCanaryAdmission } from "../business-operator/canary-policy";
import { BusinessCanaryEngine } from "../business-operator/canary-suppliers";
import { ArticleReadError, articleFailureCode, gatheredArticle, readArticle } from "../web-research/article-reader";
import { bodyIdentity, canonicalUrl } from "../web-research/url-identity";
import { isPublicReferenceId } from "../public-references/catalog";
/**
 * The Keryx agent orchestrator — the brain.
 *
 * Streams a human-readable reasoning trace while it: decomposes the question, discovers candidate
 * sources, DECIDES buy/skip/cache (engine reasons value, code enforces the hard budget), fetches
 * via x402, stops early once it has read enough, synthesizes a cited answer, attributes contribution,
 * and settles weighted citation rewards to eligible creators. Public references are free evidence.
 *
 * Yields TraceStep events; returns the final QueryRun. Visible agency is the product.
 */

import { researchVerdict } from "./research-verdict";
import { config } from "../config";
import { ResearchSelectionError, readSelectionDiagnostics } from "../llm/research-selection";
import { newRunProvenance, type RunProvenance } from "../research/run-provenance";
import type {
  ClaimCoverageRecord,
  Citation,
  Confidence,
  Decision,
  EvidencePortfolio,
  EvidenceRecord,
  PaymentOrigin,
  McpClientChannel,
  PaymentRecord,
  PreviewCoverage,
  QueryRun,
  ResearchMode,
  Source,
  SourceItem,
  ArticleOfferRef,
  TracePhase,
  TraceStep,
} from "../types";
import type {
  GatheredContent,
  SourceCandidate,
  SufficiencyResult,
  SynthResult,
  ReevaluateOutput,
} from "../llm";
import { effectiveEngineName, reasoningAttempts, reasoningUsage, reasoningCalls } from "../llm/resilient-engine";
import type { AgentDeps } from "./deps";
import { resolveResearchEffects } from "./research-effects";
import { recognizeBibliographicTask } from "../research/bibliographic-task-request";
import { runBibliographicAgent } from "./run-bibliographic-agent";
import { parseTeachingProposalRequest } from "../research/teaching-proposals-request";
import { deliverTeachingProposals, type TeachingProposalDelivery } from "../research/teaching-proposals";
import { teachingProposalAnswer } from "../research/teaching-proposals-presentation";
import { allocateSplit } from "../payments/split-allocation";
import {
  PaymentPendingError,
  paymentCountsAsSpent,
  paymentSettlementStatus,
  pendingPaymentFrom,
  settledPaymentFrom,
} from "../payments/payment-state";
import { questionArxivIds } from "../scholarly/arxiv";
import { hasKnownSeedFingerprint } from "../research/seed-evidence-fingerprints";
import { normalizePreviewDepth, previewSummary } from "../sources/preview-depth";
import { isCacheFresh, isCacheWithinTtl, newestPublishedAt } from "./cache-freshness";
import {
  selectRelevantSourceItem,
  sourceItemAssetId,
  sourceItemCacheKey,
  sourceItemContentVersion,
  sourceItemIdentity,
} from "../sources/source-item-asset";
import { sourceFetchTerms } from "../registry/source-fetch-payto";
import { assertRecipientAllowed, sourceRecipientIsExcluded } from "../payments/recipient-exclusion";
import { sourceClaimAccess, publicDuplicateOfOwnedItem } from "../sources/source-claim-access";
import { sourceClaimForUrl } from "../sources/public-source-claim-service";
import { prepareOperatingFee, retainExactItemClaimUrls } from "./operating-fee";
import { resolveFreeSourceItemContent } from "../sources/resolve-source-item-content";
import { contentBodyHash } from "../sources/content-receipt";
import { recognizeSourceRecency, sourceRecencyReport, sourceRecencyRequestGaps, sourceRecencyObservationReport } from "../sources/source-recency";
import { createSourceRecencyResolver } from "./source-recency-observations";
import { projectSourceRecencyResult } from "../sources/source-recency-result";
import type { SourceClaimReceipt } from "../types";
import { resolveValidArticleOffer } from "../offers/resolve-article-offer";
import {
  buildEvidenceLedger,
  MIN_REWARD_SUPPORT,
} from "./evidence-ledger";
import {
  buildPreviewCoverage,
  normalizeClaimTargets,
  previewCoverageBlockReason,
} from "./coverage-precheck";
import {
  attachEvidencePortfolioOutcome,
  selectEvidencePortfolio,
} from "./evidence-portfolio";

export interface RunInput {
  /** Trusted hosted-worker format selection; public request JSON cannot set it. */
  answerFormat?: "decision-brief";
  /** Opt in to scholarly metadata search; this never authorizes payment. */
  scholarly?: boolean;
  /** Explicit opt-in for independently reviewed testnet manuscripts; browser journal only. */
  paidScholarly?: boolean;
  signal?: AbortSignal;
  /** Trusted manual CLI opt-in only; never populate from public request JSON. */
  allowExternalWeb?: boolean;
  question: string;
  /** Trusted adapter copy of validated caller text before follow-up/context augmentation.
   * Never populate this from a public originalQuestion field or model-created prompt. */
  originalQuestion?: string;
  budget?: number;
  /** Quick bounds attention/expansion for latency; Deep preserves the full research pass. */
  researchMode?: ResearchMode;
  queryId?: string;
  /** Execution origin, stamped on the run and its payments. Defaults to "engine" for
   *  direct internal callers that do not specify a request channel. */
  origin?: PaymentOrigin;
  /** Normalized MCP setup channel. Self-declared telemetry, never caller authority. */
  mcpClient?: McpClientChannel;
  /** Stable actor verified by the server (SIWE/API key). Never accept an unverified client value. */
  asker?: string;
  /** Closed ingress/proof metadata supplied only by the trusted adapter, never a public body. */
  provenance?: RunProvenance;
  /** Trusted server-side funding provenance. Public request bodies must never populate this. */
  fundingOwner?: "browser" | "treasury" | "offline";
  /** Catalog model id the asker picked (model-catalog.ts). Read by collectRun when it builds
   *  deps; unknown/unset → default engine. Every pick falls back so the run always answers. */
  model?: string;
  /** Set when this dispatch re-asks a question the corpus previously left under-covered. Recorded
   *  on the run so the demand board can tell an independent dispatch from the agent's own retry. */
  retryOf?: string;
  /** Trusted durable checkpoint awaited immediately before every creator gateway call. Public
   *  callers never set it; A2A uses it to prove whether a crashed job could have moved value. */
  onCreatorPaymentBoundary?: () => Promise<void>;
  /** Trusted durable checkpoint awaited by collectRun immediately before QueryRun persistence. */
  onQueryRunSaveBoundary?: () => Promise<void>;
  /** Trusted per-dispatch execution contract. A2A supplies the package snapshot accepted before
   * payment; public request bodies cannot set this value directly. */
  executionLimits?: {
    attentionLimit: number;
    reevaluateRounds: number;
  };
  /**
   * Exact creator response admitted for a wanted-claim retry. This is discovery coordination,
   * never a forced purchase or payout authority: the asset is guaranteed a candidate slot, while
   * the reasoning engine still emits BUY/SKIP and every payment still resolves registry terms.
   */
  targetAsset?: {
    sourceId: string;
    itemId: string;
    contentVersion: string;
    articleOfferId?: string;
  };
}

interface InternalAsset {
  candidate: SourceCandidate;
  source: Source;
  item?: SourceItem;
  cacheKey: string;
  priceUsdc: number;
  listPriceUsdc: number;
  offer?: ArticleOfferRef;
  claimPolicy?: SourceClaimReceipt;
  rewardAllowed?: boolean;
  publicFallback?: GatheredContent;
}

export async function* runAgent(
  input: RunInput,
  deps: AgentDeps,
): AsyncGenerator<TraceStep, QueryRun, void> {
  const queryId = input.queryId ?? crypto.randomUUID();
  const effects = resolveResearchEffects(deps.db, deps.effects, deps.discoverExternal, queryId);
  // The original caller alone can select this free, exact metadata task. Private
  // originals, package execution, wanted assets and paid-paper flows keep their
  // existing research/payment contracts. Source text and prior context cannot opt in.
  const bibliography = effects.scope.kind === "public" && !input.answerFormat && !input.executionLimits &&
    !input.targetAsset && !input.paidScholarly && ((input.origin ?? "engine") !== "engine" || input.allowExternalWeb === true)
    ? recognizeBibliographicTask(input.originalQuestion ?? input.question) : null;
  if (bibliography) return yield* runBibliographicAgent({ ...input, queryId }, deps, bibliography);
  const canary = admitBusinessCanaryRun({ question: input.question, queryId, origin: input.origin,
    researchMode: input.researchMode, budget: input.budget, fundingOwner: input.fundingOwner,
    privateScope: effects.scope.kind !== "public", paidScholarly: input.paidScholarly });
  if (canary && (!(deps.engine instanceof BusinessCanaryEngine) || deps.webSearch ||
      config.webSearchProvider !== "tavily" || !config.tavilyApiKey.trim() || input.scholarly || deps.discoverScholarly))
    throw new Error("Business canary requires its fixed model/search transports");
  if (canary && (await deps.db.operatorPublicSnapshot(Date.now())).creatorCatalog.registered !== 0)
    throw new Error("Business canary requires the verified empty creator catalog");
  const admission = admitBoundedResearch({ question: input.question, queryId, origin: input.origin,
    researchMode: input.researchMode, budget: input.budget, fundingOwner: input.fundingOwner,
    privateScope: effects.scope.kind !== "public", paidScholarly: input.paidScholarly });
  if (admission && (deps.webSearch || config.webSearchProvider !== "tavily" || !config.tavilyApiKey.trim()))
    throw new Error("Bounded research allowance requires the fixed basic Tavily transport");
  const generator = runAdmittedAgent({ ...input, queryId }, { ...deps,
    effects: canary ? { ...effects, discoverExternal: async () => [] } : effects });
  if (canary) return yield* bindBusinessCanaryAdmission(canary, generator, input.signal);
  return yield* (admission ? bindBoundedResearchAdmission(admission, generator, input.signal) : generator);
}

async function* runAdmittedAgent(
  input: RunInput,
  deps: AgentDeps,
): AsyncGenerator<TraceStep, QueryRun, void> {
  const { engine, db, gateway } = deps;
  const effects = resolveResearchEffects(db, deps.effects, deps.discoverExternal, input.queryId);
  const startedAt = Date.now();
  const budget = input.budget ?? config.defaultBudget;
  const queryId = input.queryId ?? crypto.randomUUID();
  // Retain the execution origin on each payment for audit and channel diagnostics.
  const origin: PaymentOrigin = input.origin ?? "engine";
  const trace: TraceStep[] = [];
  const payments: PaymentRecord[] = [];
  let paymentAttempts = 0;
  let settledPayments = 0;
  let pendingPayments = 0;
  let fundingUnavailable = false;
  const fundingNotice = "Funding readiness is unknown. Paid source access and creator rewards are withheld for this run; any wallet funding activity remains unverified. Inspect the original funding records before another paid attempt.";
  let finalDecisions: Decision[] = [];
  let citations: Citation[] = [];
  let teachingProposals: TeachingProposalDelivery | undefined;
  let operatingFee: QueryRun["operatingFee"];
  let evidence: EvidenceRecord[] = [];
  let claimCoverage: ClaimCoverageRecord[] = [];
  let previewCoverage: PreviewCoverage | undefined;
  let evidencePortfolio: EvidencePortfolio | undefined;
  let evidenceMeasured = false;
  // Initialize before any early return. The production optimizer can otherwise merge an
  // uninitialized binding with the later verdict declaration, stranding finish() in its TDZ.
  let runConfidence: Confidence = { level: "Low", reason: "no source was read for this question" };
  // finish() also handles early returns; never read synthesis-phase lexical bindings there.
  const initialWordBudget = effects.scope.kind === "public" && !input.targetAsset && !input.paidScholarly &&
    !input.answerFormat && !input.executionLimits && process.env.KERYX_DECISION_BRIEF !== "1" &&
    process.env.KERYX_TEACHING_PROPOSALS !== "1"
    ? answerPresentation(input.originalQuestion ?? input.question).requestedMaximumWords : undefined;
  let finalWordBudget: { maximumWords: number; compactAnswer?: string } | undefined = initialWordBudget
    ? { maximumWords: initialWordBudget } : undefined;

  const fetchBudget = budget * (1 - config.citationPoolRatio);
  const citationPool = budget * config.citationPoolRatio;
  const researchMode: ResearchMode = input.researchMode ?? "deep";
  const defaultAttentionLimit =
    researchMode === "quick" ? Math.min(2, config.maxAttentionSources) : config.maxAttentionSources;
  const defaultReevaluateRounds = researchMode === "quick" ? 0 : config.reevaluateRounds;
  let attentionLimit = input.executionLimits?.attentionLimit ?? defaultAttentionLimit;
  const reevaluateRounds = input.executionLimits?.reevaluateRounds ?? defaultReevaluateRounds;
  if (
    !Number.isInteger(attentionLimit) ||
    attentionLimit < 1 ||
    attentionLimit > 32 ||
    !Number.isInteger(reevaluateRounds) ||
    reevaluateRounds < 0 ||
    reevaluateRounds > 8
  ) {
    throw new Error("invalid trusted agent execution limits");
  }
  let spentTolls = 0;

  function emit(phase: TracePhase, message: string, detail?: unknown): TraceStep {
    const s: TraceStep = { phase, message, detail, ts: Date.now() };
    trace.push(s);
    return s;
  }

  async function persistPaymentRecord(payment: PaymentRecord): Promise<string | null> {
    // Journal admission already committed the authoritative row before browser exposure.
    // Reconciliation/gateway CAS owns its lifecycle; a second INSERT is not recovery.
    if (payment.authorizationPhase) return null;
    try {
      await effects.recordPayment(payment);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      effects.alert(
        "payment ledger write failed",
        `${payment.kind} $${payment.amountUsdc} for ${payment.sourceName} (${payment.queryId}): ${message}`,
      );
      return message;
    }
  }

  // 1) DECOMPOSE
  // Freeze this original-text constraint before the engine creates or omits research targets.
  const recencyRequirement = recognizeSourceRecency(input.originalQuestion ?? input.question);
  const requestRecencyGaps = sourceRecencyRequestGaps(recencyRequirement);
  yield emit("decompose", `Breaking down: "${input.question}"`);
  for (const gap of requestRecencyGaps) yield emit("decompose", "Newest-feed requirement retained from the caller; selection is unqualified and affected catalog articles will be withheld before BUY/CACHE.", gap);
  const subClaims = await engine.decompose(input.question);
  // A comparison names one target per candidate. Unless the caller pinned its limits, Deep research
  // may read one source per target, so the last candidates are not left without any evidence.
  if (!input.executionLimits && researchMode === "deep") {
    attentionLimit = Math.min(32, Math.max(attentionLimit, subClaims.length));
  }
  const recencyEnabled = effects.scope.kind === "public" && !input.answerFormat && !input.executionLimits && !input.targetAsset &&
    !input.paidScholarly && (origin !== "engine" || input.allowExternalWeb === true);
  const recencyResolver = createSourceRecencyResolver(recencyRequirement, {
    enabled: recencyEnabled,
    maxReads: Math.min(4, Math.max(0, attentionLimit - 1)), signal: input.signal,
  });
  yield emit("decompose", `Identified ${subClaims.length} research target(s) to investigate; these are not established facts`, subClaims);
  yield emit(
    "decompose",
    researchMode === "quick"
      ? `Quick mode: at most ${attentionLimit} paid/cached/public${recencyEnabled && recencyRequirement ? " or native-feed" : ""} reads, with no marketplace probe or gap-expansion round.`
      : `Deep mode: up to ${attentionLimit} paid/cached/public${recencyEnabled && recencyRequirement ? " or native-feed" : ""} reads plus one bounded gap-expansion pass when needed.`,
    { researchMode, attentionLimit, reevaluateRounds },
  );

  // 2) DISCOVER
  // Earning gate: only feed-ownership-verified sources are discoverable to the agent, so a wallet
  // that lists a feed it doesn't own (and can't put `keryx-verify:<wallet>` in) is never read,
  // cited, or paid. Listing stays permissionless — unverified rows show in the directory, just
  // off the money path. Undefined verified = grandfathered true (curated seed + pre-flag rows).
  const allSources = await db.listSources();
  // A verified asker cannot draw someone else's money to their own wallet: when the run is not
  // funded by the asker's browser grant, sources that pay the asker are left out of discovery.
  const outsideFundedAsker = input.fundingOwner !== "browser" ? input.asker?.toLowerCase() : undefined;
  let selfOwnedCount = 0;
  const eligible = allSources.filter((s) => s.verified !== false && !isPublicReferenceId(s.id) && (gateway.mode === "offline" || s.evidenceProvenance !== "synthetic-demo"));
  const rights = await Promise.all(eligible.map(s => paperCanResearch(db, s, input.paidScholarly === true && origin === "web")));
  const sources = eligible.filter((_s, index) => rights[index]);
  const unverifiedCount = allSources.filter((source) => source.verified === false).length;
  const candidates: SourceCandidate[] = [];
  const assetById = new Map<string, InternalAsset>();
  // Sources whose cached copy still matches what they publish. A copy the source has published
  // past is not a free read of it any more, so it is offered as a paid fetch instead — otherwise
  // the first purchase of a source would be the last toll it ever earned, and every later answer
  // would be built from text the source has moved on from. See ./cache-freshness.ts.
  const freshCache = new Set<string>();
  const { publicReads, publicCandidates, recencyGaps, recencyObservations, itemClaimUrls } = await discoverPublicReferences(db, input.question, subClaims, recencyRequirement, recencyResolver);
  for (const gap of recencyGaps) yield emit("discover",
    `WITHHELD ${gap.sourceName}: retained feed metadata does not establish the requested newest entry; no older cached article substituted.`, gap);
  recencyGaps.push(...requestRecencyGaps);
  const webCandidates = new Map<string, SourceCandidate>();
  const gathered: GatheredContent[] = [];
  const requested = requestedSources(input.question);
  const requestedByUrl = new Map([...requested.candidates.values()].map(candidate => [candidate.item!.itemUrl, candidate]));
  const externalDocumentsWithheld = effects.scope.kind === "job" || origin === "engine" && input.allowExternalWeb !== true;
  function admitWeb(candidate: SourceCandidate) {
    // A requested native feed belongs to the bounded metadata observation. An
    // article reader or model must not re-read it as an alternate newest proof.
    if (recencyRequirement?.feedUrls.includes(candidate.item?.itemUrl ?? "")) return;
    const supplied = requestedByUrl.get(canonicalUrl(candidate.item?.itemUrl ?? "") ?? "");
    const requirement = supplied?.item?.requestedSource;
    const previous = webCandidates.get(supplied?.id ?? candidate.id);
    const sameDocument = canonicalUrl(previous?.item?.itemUrl ?? "") === canonicalUrl(candidate.item?.itemUrl ?? "");
    const admitted = requirement && candidate.item ? { ...candidate,
      id: supplied!.id, sourceId: supplied!.id,
      description: `${candidate.description} This original URL was explicitly supplied by the caller; contents remain unobserved.`,
      item: { ...candidate.item, ...(sameDocument && !candidate.item.scholarly && previous?.item?.scholarly
        ? { scholarly: previous.item.scholarly } : {}), requestedSource: requirement } } : candidate;
    webCandidates.set(admitted.id, admitted); publicCandidates.set(admitted.id, admitted);
  }
  if (!externalDocumentsWithheld) for (const candidate of requested.candidates.values()) admitWeb(candidate);
  for (const candidate of requested.candidates.values()) for (const url of candidate.item!.requestedSource!.urls) yield emit("discover",
    externalDocumentsWithheld ? `WITHHELD original URL ${url}: external document access is disabled for this scope.`
      : `Supplied source URL ${url} admitted as an unread discovery lead. No official authorship or evidence established; a supplied fragment requests a section but only a bounded whole-document read is supported.`,
    { url, candidateId: candidate.id, withheld: externalDocumentsWithheld });
  for (const notice of requested.notices) yield emit("discover", `SKIP supplied original ${notice.url}: ${notice.code ? notice.code + ": " : ""}${notice.reason}`, notice);
  let webDiscovery: { status: "completed" | "unavailable" | "not-configured" | "withheld"; attemptedQueries?: number; succeededQueries?: number; failedQueries?: number } = { status: "not-configured" };
  let webRemainingMs = input.researchMode === "quick" ? 30000 : 55000;
  let webAttempts = 0;
  const webSignal = () => AbortSignal.any([input.signal ?? new AbortController().signal,
    AbortSignal.timeout(Math.max(1, webRemainingMs))]);
  if ((input.scholarly || questionDois(input.question).length || questionArxivIds(input.question).length) && effects.scope.kind === "public"
    && (origin !== "engine" || input.allowExternalWeb === true) && webRemainingMs > 0) {
    const operationStarted = Date.now();
    try {
      const discovered = await (deps.discoverScholarly ?? discoverScholarly)(input.question, input.scholarly === true, webSignal());
      for (const candidate of discovered.candidates.values()) admitWeb(candidate);
      yield emit("discover", `Scholarly discovery: ${discovered.succeeded} provider requests succeeded, ${discovered.unavailable} unavailable; ${discovered.candidates.size} bibliographic previews. DOI lookup resolved ${discovered.resolvedDois}/${discovered.requestedDois} detected identifiers (up to two DOI lookups per run). Explicit versioned arXiv targets use a bounded exact lookup (up to two), rather than keyword search. Metadata is not paper evidence. arXiv is preprint material; peer review is unknown. Selected originals must be read; no creator payout.`);
    } catch { yield emit("discover", "Scholarly discovery unavailable; continuing with other sources. No paper evidence established."); }
    finally { webRemainingMs -= Date.now() - operationStarted; }
    if (input.signal?.aborted) throw new DOMException("Research cancelled", "AbortError");
  }
  if (effects.scope.kind === "job") {
    webDiscovery = { status: "withheld" };
    yield emit("discover", "External web search withheld for private research; no question is sent to a search provider.");
  } else if (origin === "engine" && input.allowExternalWeb !== true) {
    webDiscovery = { status: "withheld" };
    yield emit("discover", "External web search withheld for unattended engine research; manual CLI research can explicitly opt in.");
  } else if (deps.webSearch || config.webSearchProvider || requestedSourceUrls(input.question).urls.length) {
    const operationStarted = Date.now();
    try {
      let configured = deps.webSearch ?? null, configurationFailed = false;
      if (!configured) try {
        configured = config.webSearchProvider === "searxng" ? searxngProvider(config.webSearchUrl)
          : config.webSearchProvider === "tavily" ? tavilyProvider(config.tavilyApiKey) : null;
      } catch { configurationFailed = true; }
      const discovered = await discoverWeb(configured, input.question,
        subClaims, input.researchMode === "quick", webSignal());
      webDiscovery = { status: configurationFailed ? "unavailable" : configured ? "completed" : "not-configured", attemptedQueries: discovered.attemptedQueries, succeededQueries: discovered.succeededQueries, failedQueries: discovered.failedQueries };
      for (const candidate of discovered.candidates.values()) admitWeb(candidate);
      if (discovered.withheldDiscussionPreviews) yield emit("discover",
        discovered.withheldDiscussionPreviews + " discussion-page previews withheld because the request asks for official documentation. Other previews are not thereby verified as official.");
      yield emit("discover", `Web search: ${discovered.attemptedQueries}/${discovered.queries} planned queries attempted, ${discovered.succeededQueries} succeeded, ${discovered.candidates.size} public page previews/leads, ${discovered.failedQueries} unavailable queries${!configured ? configurationFailed ? "; search configuration unavailable, supplied URL leads only" : "; search provider not configured, supplied URL leads only" : ""}${discovered.cancelled ? "; search deadline or cancellation reached" : ""}${discovered.truncatedQueries ? "; query text bounded at 500 characters" : ""}. Previews and supplied URLs are discovery only. Public reads spend no USDC; model and service operating costs remain separate.`);
    } catch { webDiscovery = { status: "unavailable" }; yield emit("discover", "Web search unavailable; continuing with the available catalog. No web evidence was established."); }
    finally { webRemainingMs -= Date.now() - operationStarted; }
    if (input.signal?.aborted) throw new DOMException("Research cancelled", "AbortError");
  } else yield emit("discover", "Broad web search is not configured; other discovery channels remain available.");
  const seenWebBodies = new Set<string>();
  const seenWebUrls = new Set<string>();
  let lastWebFailure = "unavailable";
  const scholarlyReadFailures: string[] = [];
  const publicReadOutcomes: Array<{ name: string; code: string; assetId?: string }> = [];
  async function fetchWeb(id: string): Promise<GatheredContent | null> {
    lastWebFailure = "web-operation-limit";
    const candidate = webCandidates.get(id);
    if (!candidate?.item?.itemUrl || webAttempts >= (input.researchMode === "quick" ? 4 : 12) || webRemainingMs <= 0) {
      publicReadOutcomes.push({ name: candidate?.name ?? "Public source", code: lastWebFailure, assetId: id });
      return null;
    }
    webAttempts++;
    const operationStarted = Date.now();
    try {
      const metadata = candidate.item.scholarly;
      let abstractFallback = false;
      let htmlFallback = false;
      let article;
      try {
        article = await (deps.readWebArticle ?? readArticle)(candidate.item.itemUrl, webSignal());
        if (metadata?.provider === "arxiv" && article.finalUrl === candidate.item.itemUrl && article.kind !== "pdf") throw new ArticleReadError("pdf-extraction-unavailable");
      }
      catch (error) {
        // An official versioned arXiv PDF found by web search has no provider record but the same identity.
        const pdfArxivId = metadata?.provider === "arxiv" ? metadata.arxivId
          : /^https:\/\/arxiv\.org\/pdf\//u.test(candidate.item.itemUrl) ? arxivDocumentId(candidate.item.itemUrl) : undefined;
        if (metadata?.provider !== "arxiv" && !(pdfArxivId && articleFailureCode(error) === "article-byte-limit")) throw error;
        const exhausted = () => webAttempts >= (input.researchMode === "quick" ? 4 : 12) || webRemainingMs - (Date.now() - operationStarted) <= 0 || input.signal?.aborted;
        const fallbackSignal = () => AbortSignal.any([input.signal ?? new AbortController().signal, AbortSignal.timeout(Math.max(1, webRemainingMs - (Date.now() - operationStarted)))]);
        scholarlyReadFailures.push(`arXiv ${pdfArxivId}: paper PDF unavailable (${articleFailureCode(error)}).`);
        if (exhausted()) throw error;
        // A non-PDF body at the PDF URL was read before it was refused; it is never evidence.
        article = undefined;
        // A PDF over the byte limit usually carries figures, not more text. arXiv's own HTML
        // rendition of the same version is full paper text within the unchanged HTML reader bounds.
        if (pdfArxivId && articleFailureCode(error) === "article-byte-limit") {
          webAttempts++;
          const htmlUrl = `https://arxiv.org/html/${pdfArxivId}`;
          try {
            const rendition = await (deps.readWebArticle ?? readArticle)(htmlUrl, fallbackSignal());
            if (rendition.finalUrl !== htmlUrl || rendition.kind !== "html") throw new ArticleReadError("document-identity-changed");
            article = rendition;
            htmlFallback = true;
            scholarlyReadFailures.push(`arXiv ${pdfArxivId}: read arXiv's HTML rendition of the same version instead of the PDF.`);
          } catch (htmlError) {
            scholarlyReadFailures.push(`arXiv ${pdfArxivId}: HTML full text unavailable (${articleFailureCode(htmlError)}).`);
            if (metadata?.provider !== "arxiv" || exhausted()) throw error;
          }
        }
        if (!article) {
          webAttempts++;
          abstractFallback = true;
          article = await (deps.readWebArticle ?? readArticle)(`https://arxiv.org/abs/${pdfArxivId}`, fallbackSignal());
        }
      }
      // A provider's versioned repository identity must survive document redirects.
      const requestedArxivId = candidate.item.requestedSource && arxivDocumentId(candidate.item.itemUrl);
      if (requestedArxivId && arxivDocumentId(article.finalUrl) !== requestedArxivId) throw new ArticleReadError("document-identity-changed");
      if (metadata?.provider === "arxiv") {
        const expected = `https://arxiv.org/${abstractFallback ? "abs" : htmlFallback ? "html" : "pdf"}/${metadata.arxivId}`;
        if (article.finalUrl !== expected || (!abstractFallback && article.kind !== (htmlFallback ? "html" : "pdf"))) throw new ArticleReadError("document-identity-changed");
      }
      const identity = bodyIdentity(article.text);
      if (documentAlreadyRead({ sourceId: id, itemUrl: article.finalUrl }, gathered)) {
        lastWebFailure = "document-alias-already-read";
        publicReadOutcomes.push({ name: candidate.name, code: lastWebFailure, assetId: id });
        return null;
      }
      lastWebFailure = "empty-or-duplicate-body";
      if (!article.text.trim() || seenWebBodies.has(identity) || seenWebUrls.has(article.finalUrl) ||
          gathered.some(read => bodyIdentity(read.text) === identity && read.itemUrl === article.finalUrl) ||
          publicReads.size && [...publicReads.values()].some(read => bodyIdentity(read.text) === identity)) {
        publicReadOutcomes.push({ name: candidate.name, code: lastWebFailure, assetId: id });
        return null;
      }
      seenWebBodies.add(identity);
      seenWebUrls.add(article.finalUrl);
      const extracted = gatheredArticle(id, article);
      extracted.requestedSource = candidate.item.requestedSource;
      if (requestedArxivId && /\/abs\//u.test(article.finalUrl)) extracted.publicDeliveryKind = "abstract";
      if (metadata) {
        extracted.scholarly = { ...metadata, evidenceScope: metadata.provider === "arxiv" ? abstractFallback ? "abstract-page" : "paper-text" : "publisher-page" };
        extracted.itemTitle = metadata.title;
        extracted.itemPublishedAt = metadata.publishedDate?.length === 10 ? metadata.publishedDate : undefined;
        extracted.publicDeliveryKind = abstractFallback ? "abstract" : "excerpt";
        if (abstractFallback) scholarlyReadFailures.push(`arXiv ${metadata.arxivId}: only the abstract page was read; full-paper evidence is unavailable.`);
      }
      return extracted;
    } catch (error) { lastWebFailure = articleFailureCode(error); publicReadOutcomes.push({ name: candidate.name, code: lastWebFailure, assetId: id }); return null; }
    finally { webRemainingMs -= Date.now() - operationStarted; }
  }
  for (const candidate of publicCandidates.values()) {
    candidates.push(candidate);
    freshCache.add(candidate.id);
  }
  let signedOfferCount = 0;
  for (const s of sources) {
    const recencyResolution = await recencyResolver.resolve(s, (sourceId, url) => db.getSourceItemByLink(sourceId, url));
    if (recencyResolution.status === "withheld") {
      recencyGaps.push(recencyResolution.gap);
      yield emit("discover", `WITHHELD ${s.name}: current-feed selection is ${recencyResolution.gap.reason}. No BUY/CACHE or older catalog article is admitted.`, recencyResolution.gap);
      continue;
    }
    if (recencyResolution.status === "eligible") recencyObservations.push(recencyResolution.observation);
    if (await paperDuplicatesPublicBody(db, s, [...publicReads.values()].map(read => read.text))) {
      yield emit("discover", `SKIP paid manuscript ${s.name}: identical exact-version body is already available as a free public reference.`);
      continue;
    }
    let terms;
    try { terms = await sourceFetchTerms(s); }
    catch {
      yield emit("discover", `SKIP ${s.name}: current source payment authority is unavailable.`);
      continue;
    }
    if (!terms.active) continue;
    if (sourceRecipientIsExcluded(s, terms, outsideFundedAsker)) { selfOwnedCount++; continue; }
    let claimAccess;
    try { claimAccess = await sourceClaimAccess(db, s, terms, { now: startedAt }); }
    catch {
      yield emit("discover", `SKIP creator listing ${s.name}: its verified claim policy is unavailable; original public references remain free.`);
      continue;
    }
    if (!claimAccess.readAllowed) {
      yield emit("discover", `SKIP creator listing ${s.name}: earning has not been enabled for its current registry price.`);
      continue;
    }
    const catalogItems = (recencyResolution.status === "eligible" ? [recencyResolution.selected] : await db.getItems(s.id)).map(item => hasKnownSeedFingerprint(item.title, item.link, item.bodyHash)
      ? { ...item, evidenceProvenance: "synthetic-demo" as const } : item);
    for (const knownItem of catalogItems) retainExactItemClaimUrls(itemClaimUrls, knownItem.link,
      [s.url, ...(s.rssUrl ? [s.rssUrl] : [])]);
    const items = catalogItems.filter(item => gateway.mode === "offline" || item.evidenceProvenance !== "synthetic-demo");
    if (catalogItems.length > 0 && items.length === 0) continue;
    // Honor the creator's preview-depth: the agent scores on exactly what a paying reader would see
    // for free. Article selection never inspects paid full text.
    const depth = normalizePreviewDepth(s.previewDepth);
    const target = input.targetAsset?.sourceId === s.id ? input.targetAsset : undefined;
    const item = target
      ? items.find((candidate) => candidate.id === target.itemId) ?? null
      : selectRelevantSourceItem(input.question, subClaims, s.tags, items);

    if (target && (!item || sourceItemContentVersion(item) !== target.contentVersion)) {
      throw new Error("wanted response article changed or disappeared before discovery");
    }

    if (item) {
      const duplicatePublic = claimAccess.claim && [...publicReads.values()].find(read =>
        publicDuplicateOfOwnedItem(item, read, contentBodyHash));
      if (duplicatePublic && (terms.listPriceUsdc > 0 || !claimAccess.rewardAllowed)) {
        yield emit("discover", `READ preference for ${s.name}: the same exact article is already a free public reference; no duplicate purchase or contribution.`);
        continue;
      }
      const id = sourceItemAssetId(item.id);
      const identity = { ...sourceItemIdentity({ ...item, evidenceProvenance: item.evidenceProvenance ?? s.evidenceProvenance }),
        ...(claimAccess.snapshot ? { sourceClaim: claimAccess.snapshot } : {}),
        ...(terms.listPriceUsdc === 0 ? { accessKind: "creator-free" as const } : {}) };
      const cacheKey = sourceItemCacheKey(s.id, item);
      const cached = isCacheWithinTtl(await effects.getCachedAt(cacheKey), Date.now(), config.cacheTtlSeconds);
      if (cached) freshCache.add(id);
      const summary = previewSummary(item.summary, depth);
      const resolvedOffer = s.scholarlyEnrolled ? null : await resolveValidArticleOffer(db, s, item, terms);
      if (target?.articleOfferId && resolvedOffer?.offer.id !== target.articleOfferId) {
        throw new Error("wanted response article offer expired or was replaced before discovery");
      }
      if (resolvedOffer) signedOfferCount++;
      const priceUsdc = resolvedOffer?.ref.priceUsdc ?? terms.listPriceUsdc;
      const candidate: SourceCandidate = {
        id,
        sourceId: s.id,
        item: identity,
        name: `${s.name} — ${item.title}`,
        description: s.description,
        tags: s.tags,
        fetchPrice: priceUsdc,
        ...(resolvedOffer
          ? {
              offer: {
                id: resolvedOffer.offer.id,
                listPriceUsdc: terms.listPriceUsdc,
                expiresAt: resolvedOffer.offer.expiresAt,
              },
            }
          : {}),
        cached,
        preview: summary ? `- ${item.title}: ${summary}` : `- ${item.title}`,
      };
      // Put the offered work first so large catalogs cannot hide it from a bounded model prompt.
      // Position is not a recommendation: the engine still prices and decides it normally.
      if (target) candidates.unshift(candidate);
      else candidates.push(candidate);
      assetById.set(id, {
        candidate,
        source: s,
        item,
        cacheKey,
        priceUsdc,
        listPriceUsdc: terms.listPriceUsdc,
        claimPolicy: claimAccess.snapshot,
        rewardAllowed: claimAccess.rewardAllowed,
        ...(duplicatePublic ? { publicFallback: duplicatePublic } : {}),
        offer: resolvedOffer
          ? { ...resolvedOffer.ref, proof: resolvedOffer.offer }
          : undefined,
      });
      continue;
    }

    // Historical source rows with no articles retain the original source-level purchase path.
    if (terms.listPriceUsdc === 0) continue;
    const legacyCachedAt = await effects.getCachedAt(s.id);
    const cached = isCacheFresh(legacyCachedAt, newestPublishedAt(items), Date.now()) &&
      isCacheWithinTtl(legacyCachedAt, Date.now(), config.cacheTtlSeconds);
    if (cached) freshCache.add(s.id);
    const candidate: SourceCandidate = {
      id: s.id,
      sourceId: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags,
      fetchPrice: terms.listPriceUsdc,
      cached,
      preview: s.description,
    };
    candidates.push(candidate);
    assetById.set(s.id, {
      candidate,
      source: s,
      cacheKey: s.id,
      priceUsdc: terms.listPriceUsdc,
      listPriceUsdc: terms.listPriceUsdc,
      claimPolicy: claimAccess.snapshot,
      rewardAllowed: claimAccess.rewardAllowed,
    });
  }

  if (input.targetAsset) {
    const admitted = assetById.get(sourceItemAssetId(input.targetAsset.itemId));
    if (!admitted || admitted.source.id !== input.targetAsset.sourceId) {
      throw new Error("wanted response source is not active, verified, or payable");
    }
  }
  // Metadata probes consume the original attention grant even when the feed or
  // exact catalog lookup failed. Preserve at least one possible article slot.
  if (recencyResolver.readsUsed) {
    attentionLimit -= recencyResolver.readsUsed;
    yield emit("discover", `Native feed observation used ${recencyResolver.readsUsed} existing attention slot(s); ${attentionLimit} article read slot(s) remain. Publication metadata does not authorize evidence or payments.`,
      { metadataReads: recencyResolver.readsUsed, remainingAttention: attentionLimit, observations: recencyObservations });
  }
  const qualifiedFeeds = new Set([...recencyObservations.map(item => item.feedUrl), ...recencyGaps.flatMap(gap => gap.observation ? [gap.observation.feedUrl] : [])]);
  for (let index = recencyGaps.length - 1; index >= 0; index--) {
    const gap = recencyGaps[index];
    if (gap.scope === "request" && gap.reason === "newest-feed-observation-unqualified" && gap.feedUrl && qualifiedFeeds.has(gap.feedUrl)) recencyGaps.splice(index, 1);
  }
  if (input.targetAsset) {
    yield emit(
      "discover",
      "Admitted the creator's exact article response as a candidate; the agent still decides BUY or SKIP",
      input.targetAsset,
    );
  }
  yield emit(
    "discover",
    `Discovered ${candidates.length - publicCandidates.size} verified creator source(s) and ${publicCandidates.size} free public reference(s)${unverifiedCount > 0 ? ` — skipped ${unverifiedCount} unverified (feed ownership unproven, off the money path)` : ""}`,
    candidates.map((c) => c.name),
  );
  if (selfOwnedCount > 0) {
    yield emit(
      "discover",
      `Left out ${selfOwnedCount} source(s) that pay the asking wallet: this run is not funded by that wallet, so it cannot buy or reward its own work.`,
      { selfOwnedCount },
    );
  }
  if (signedOfferCount > 0) {
    yield emit(
      "discover",
      `Verified ${signedOfferCount} creator-signed article offer${signedOfferCount === 1 ? "" : "s"}; discounted prices are version-bound and capped by SourceRegistry.`,
      { signedOfferCount },
    );
  }

  // Probe the live open x402 marketplace (Circle services) — real third-party endpoints the agent
  // can reason over alongside its creators. Regardless of advertised network, they remain
  // discovery-only: evaluated and logged, never purchased.
  const external =
    researchMode === "deep"
      ? await effects.discoverExternal(input.question, subClaims)
      : [];
  if (external.length > 0) {
    candidates.push(...external);
    const chains = [...new Set(external.flatMap((c) => c.external!.chains))].join(", ");
    yield emit(
      "discover",
      `Probed the live x402 marketplace — surfaced ${external.length} external endpoint(s)${chains ? ` (advertise acceptance on ${chains})` : ""}. Evaluated for discovery only; external endpoints are never purchased by Keryx.`,
      external.map((c) => c.name),
    );
  }

  if (candidates.length === 0) {
    evidenceMeasured = true;
    claimCoverage = subClaims.map((claim, claimIndex) => ({ claimIndex, claim, coverage: 0, coveredBy: [] }));
    return finish(emptyEvidenceAnswer({ question: input.question, outcomes: publicReadOutcomes, skipped: [], discovery: webDiscovery, fundingUnavailable: false, pendingPayments: 0, settledPayments: 0, fetchFailures: 0 }));
  }

  // 3) DECIDE (engine proposes value; code enforces budget AND the Arc-rail constraint)
  // Load query memory — aggregated source performance from past runs
  const candidateIds = sources.map((s) => s.id);
  let memoryContext: string | undefined;
  let reputationContext: string | undefined;
  try {
    // One read of the log serves both halves: the per-source track record and the composite
    // reputation are two readings of the same scored set, and re-loading it would only risk them
    // disagreeing. Both are scoped to past runs about *this* subject, so both are absent on a
    // question the corpus has not been asked before — see query-memory.ts.
    const ctx = await effects.decisionContext(input.question, sources.map((s) => ({ id: s.id, name: s.name })));
    memoryContext = ctx.memory;
    reputationContext = ctx.reputation;
    if (memoryContext) {
      yield emit(
        "discover",
        `Recalled ${ctx.sample} past run${ctx.sample === 1 ? "" : "s"} on this subject — how these sources performed when they were available.`,
        { memory: true, sample: ctx.sample },
      );
    }
    if (reputationContext) {
      yield emit("discover", "ERC-8004 reputation loaded — composite scores on this subject.", { reputation: true });
    }
  } catch {
    // Memory is best-effort — never block a run on memory load failure
  }
  // Combine memory + reputation into a single context string for the decide prompt
  const fullContext = [memoryContext, reputationContext].filter(Boolean).join("\n\n") || undefined;
  const priorSelectionIds = new Set(readSelectionDiagnostics(engine).map(item => item.id));
  let proposed: Decision[];
  try {
    proposed = await engine.decide({ question: input.question, subClaims, candidates, budget, spentSoFar: 0, memoryContext: fullContext });
  } catch (error) {
    if (error instanceof ResearchSelectionError) {
      yield emit("decide", "Source selection was refused by the decision validator. No invalid proposal authorizes a read or payment; this is an incomplete request, not a completed report.", error.diagnostic);
    }
    throw error;
  }
  for (const diagnostic of readSelectionDiagnostics(engine)) {
    if (priorSelectionIds.has(diagnostic.id) || diagnostic.outcome !== "partial") continue;
    yield emit("decide", `Decision validation withheld ${diagnostic.counts.withheldCandidateCount} candidate(s) and rejected ${diagnostic.counts.invalidRowCount} row(s). Independently valid proposals continue through the existing read and payment gates. All research targets remain; proposed relevance is not verified evidence.`, diagnostic);
  }
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const assetBySourceId = new Map(
    [...assetById.values()].map((asset) => [asset.source.id, asset]),
  );
  const isExternal = (id: string) => id.startsWith("ext:");
  const externalById = new Map(external.map((c) => [c.id, c]));

  // External marketplace endpoints are discovery-only: the engine judges their value, but the
  // orchestrator never purchases them, regardless of advertised rail — enforced here like the
  // budget cap, so a model BUY can never leak into an external purchase.
  const proposedAssetIds = new Set<string>();
  const internalProposed = proposed
    .filter((d) => !isExternal(d.sourceId))
    .flatMap<Decision>((d) => {
      // Current engines return candidate ids. Accept a registry source id too so an in-flight
      // fallback/custom engine cannot erase all decisions during this additive rollout.
      const publicCandidate = publicCandidates.get(d.sourceId);
      if (publicCandidate) {
        if (proposedAssetIds.has(publicCandidate.id)) return [];
        proposedAssetIds.add(publicCandidate.id);
        return [{ ...d, assetId: publicCandidate.id, sourceId: publicCandidate.id,
          sourceName: publicCandidate.name, price: 0, offerId: undefined, listPrice: undefined,
          external: false, ...publicCandidate.item,
          action: d.action === "SKIP" ? "SKIP" as const : "CACHE" as const,
          rationale: `${d.rationale} - free public ${webCandidates.has(publicCandidate.id) ? "original-page READ selection (not a cache hit)" : "feed reference"}; no purchase or creator reward.`,
          targets: normalizeClaimTargets(d.targets, subClaims.length) }];
      }
      const asset = assetById.get(d.sourceId) ?? assetBySourceId.get(d.sourceId);
      if (!asset) return [];
      if (proposedAssetIds.has(asset.candidate.id)) return [];
      proposedAssetIds.add(asset.candidate.id);
      return [{
        ...d,
        assetId: asset.candidate.id,
        sourceId: asset.source.id,
        sourceName: asset.candidate.name,
        sourceKind: undefined, publicDeliveryKind: undefined,
        // The engine judges value; authoritative marketplace terms decide the amount reserved.
        price: asset.priceUsdc,
        targets: normalizeClaimTargets(d.targets, subClaims.length),
        ...(asset.offer
          ? { offerId: asset.offer.id, listPrice: asset.listPriceUsdc }
          : {}),
        ...asset.candidate.item,
      }];
    });
  const externalProposed = proposed.filter((d) => isExternal(d.sourceId));
  // A model can omit an input candidate. Preserve every explicit original as an inspectable
  // refusal instead of silently substituting whatever search happened to return.
  if (!externalDocumentsWithheld) for (const [id, candidate] of requested.candidates) {
    if (recencyRequirement?.feedUrls.includes(candidate.item?.itemUrl ?? "")) continue;
    if (proposedAssetIds.has(id)) continue;
    internalProposed.push({ sourceId: id, assetId: id, sourceName: candidate.name, ...candidate.item,
      action: "SKIP", expectedValue: 0, price: 0, confidence: 0, targets: [],
      rationale: "No valid decision was returned for this supplied original. The reasoning engine omitted this supplied original from its proposals; no read was authorized. Narrow the task to this URL and inspect the original rather than silently substituting a secondary source." });
  }

  // Normalize model proposals and apply the downward-only preview gates before portfolio
  // selection. The portfolio may choose a subset of positive proposals; it can never promote a
  // model SKIP, create a candidate, or alter the authoritative registry/offer price.
  const preparedDecisions: Decision[] = [];
  const discussionBlockedIds = new Set<string>();
  for (const proposedDecision of internalProposed) {
    const targets = proposedDecision.targets.filter(index =>
      !discussionDoesNotMeetDocumentRequest(input.question, proposedDecision.itemUrl, subClaims[index]));
    const r = { ...proposedDecision, targets };
    if (discussionDoesNotMeetDocumentRequest(input.question, r.itemUrl) ||
        proposedDecision.targets.length > 0 && targets.length === 0) {
      discussionBlockedIds.add(r.assetId ?? r.sourceId);
      preparedDecisions.push({ ...r, action: "SKIP",
        rationale: "The request asks for official documentation; this URL identifies a discussion or issue page, so no read slot or source payment is authorized." });
      continue;
    }
    // A CACHE proposal against a copy the source has published past is not a free read of that
    // source. Charge for it — here, before the budget guard, so the re-read is reserved like any
    // other purchase: converting it later at fetch time would settle a toll the fetch budget never
    // accounted for. If the budget can't cover it, the guard below turns it into a SKIP.
    const d =
      r.action === "CACHE" && !freshCache.has(r.assetId ?? r.sourceId) && !webCandidates.has(r.assetId ?? r.sourceId)
        ? {
            ...r,
            action: "BUY" as const,
            rationale: `${r.rationale} — no cache exists for this exact content version, so buying a fresh read.`,
          }
        : r;
    const coverageBlock = previewCoverageBlockReason(d, subClaims.length);
    if (coverageBlock) {
      preparedDecisions.push({
        ...d,
        action: "SKIP",
        rationale: `${d.rationale} — ${coverageBlock}, so no toll is authorized.`,
      });
      continue;
    }
    const originalPublicRead = webCandidates.has(d.assetId ?? d.sourceId);
    const attentionFloor = originalPublicRead ? config.minPublicReadExpectedValue : config.minCacheExpectedValue;
    if (
      d.action === "CACHE" &&
      ((d.targets?.length ?? 0) === 0 || d.expectedValue < attentionFloor)
    ) {
      preparedDecisions.push({
        ...d,
        action: "SKIP",
        rationale: `${d.rationale} — ${originalPublicRead ? "the original public READ" : "cached content"} is free, but this read does not clear the attention gate (EV ${d.expectedValue.toFixed(2)}, minimum ${attentionFloor.toFixed(2)}, with a required claim target).`,
      });
      continue;
    }
    preparedDecisions.push(d);
  }

  evidencePortfolio = selectEvidencePortfolio({
    decisions: preparedDecisions,
    claimCount: subClaims.length,
    attentionLimit,
    fetchBudgetUsdc: fetchBudget,
  });
  const selectedAssets = new Set(evidencePortfolio.selectedAssetIds);
  const preparedByAsset = new Map(
    preparedDecisions.map((decision) => [decision.assetId ?? decision.sourceId, decision]),
  );

  // Selected decisions lead the visible ledger and fetch order. The optimizer orders them by
  // marginal claim coverage, preferring a free CACHE read on a true tie so paid tolls can still be
  // stopped before signing when cached evidence is already sufficient.
  for (const assetId of evidencePortfolio.selectedAssetIds) {
    const decision = preparedByAsset.get(assetId);
    if (!decision || (decision.action !== "BUY" && decision.action !== "CACHE")) continue;
    const claimText = decision.targets.map((target) => target + 1).join(", ");
    finalDecisions.push({
      ...decision,
      rationale:
        `${decision.rationale} — selected for the claim-aware evidence portfolio ` +
        `(targets claim${decision.targets.length === 1 ? "" : "s"} ${claimText}; ` +
        (decision.action === "CACHE"
          ? "0 fetch USDC, 1 attention slot)."
          : `$${decision.price.toFixed(6)} fetch USDC, 1 attention slot).`),
    });
  }
  for (const decision of preparedDecisions) {
    const assetId = decision.assetId ?? decision.sourceId;
    if (selectedAssets.has(assetId)) continue;
    if (decision.action === "BUY" || decision.action === "CACHE") {
      const selectedAlias = evidencePortfolio.selectedAssetIds.map(id => preparedByAsset.get(id))
        .find(selected => selected && documentSelectionKey(selected) === documentSelectionKey(decision));
      finalDecisions.push({
        ...decision,
        action: "SKIP",
        rationale:
          selectedAlias
            ? `${decision.rationale} — selected ${selectedAlias.sourceName} as the single delivery channel for this canonical document; this alias adds no independent corroboration or second attention slot. ` +
              (selectedAlias.sourceKind === "public-reference"
                ? "The public route has 0 access USDC and no creator citation reward; no redundant creator toll is authorized."
                : "Its own source identity and registry terms remain authoritative; a creator citation reward still requires qualifying evidence.")
            : `${decision.rationale} — the claim-aware portfolio chose a stronger, less redundant ` +
          `set inside the ${attentionLimit}-source attention and $${fetchBudget.toFixed(6)} fetch-budget caps, so this proposal stays unspent.`,
      });
    } else {
      finalDecisions.push(decision);
    }
  }
  // This is a query-local reservation only. The browser grant remains independently and atomically
  // reserved per actual sign request inside BrowserCosignGateway.
  spentTolls = evidencePortfolio.selectedBuyUsdc;
  let attentionUsed = evidencePortfolio.selectedAssetIds.length;

  // record external evaluations — always SKIP (discovery only), keeping the engine's value reasoning
  for (const d of externalProposed) {
    const ext = externalById.get(d.sourceId);
    const chain = ext?.external?.chains.join("/") || "another chain";
    const base = d.rationale?.trim() || "Topically considered.";
    finalDecisions.push({
      ...d,
      action: "SKIP",
      external: true,
      rationale: `${base} External x402 endpoint advertises acceptance on ${chain} (~$${d.price.toFixed(4)}/call) — discovery-only, so evaluated but never purchased by Keryx.`,
    });
  }

  previewCoverage = buildPreviewCoverage(subClaims, finalDecisions);
  const selectedCached = finalDecisions.filter((decision) => decision.action === "CACHE").length;
  const selectedBought = finalDecisions.filter((decision) => decision.action === "BUY").length;
  yield emit(
    "coverage",
    `Claim-aware portfolio (${evidencePortfolio.selectionMethod}; bounded selection, not a claim of global optimality) selected ${evidencePortfolio.selectedAssetIds.length}/${evidencePortfolio.eligibleCandidates} positive proposal(s): ${selectedCached} free/cache selections + ${selectedBought} paid fresh selections, predicting ${evidencePortfolio.predictedCoveredClaims}/${subClaims.length} claim(s) above the evidence floor with $${evidencePortfolio.selectedBuyUsdc.toFixed(6)}/$${fetchBudget.toFixed(6)} fetch USDC reserved.`,
    evidencePortfolio,
  );
  const coveragePct = Math.round(previewCoverage.ratio * 100);
  yield emit(
    "coverage",
    previewCoverage.status === "ready"
      ? `Free-preview pre-check maps an actionable source to every sub-claim (${previewCoverage.coveredClaims}/${previewCoverage.totalClaims}); paid reading may proceed within the budget.`
      : previewCoverage.status === "partial"
        ? `Free-preview pre-check covers ${previewCoverage.coveredClaims}/${previewCoverage.totalClaims} sub-claims (${coveragePct}%). The agent may buy only claim-targeted sources and will label the answer provisional if paid evidence stays thin.`
        : "Free-preview pre-check found no claim-targeted source worth its toll. No paid fetch will be attempted.",
    previewCoverage,
  );

  for (const d of finalDecisions) {
    yield emit("decide", `${d.action} ${d.sourceName} — ${d.rationale}`, d);
  }

  // 4) FETCH (+ stop-early sufficiency)
  let markerN = 0;
  let fetchFailures = 0;
  const buys = finalDecisions.filter(
    (d) => (d.action === "BUY" || d.action === "CACHE") && !d.external,
  );

  // Ensure the spend wallet holds a settle-able Gateway balance before any payment
  // (real mode tops up from the funder once; offline is a no-op). Cached sources still earn
  // citation rewards, so fund only when an owned payable source will be used.
  let spendWalletReady = false;
  if (budget > 0 && buys.some((decision) =>
      (assetById.get(decision.assetId ?? decision.sourceId)?.priceUsdc ?? 0) > 0)) {
    try {
      const funded = await gateway.ensureFunded(budget);
      spendWalletReady = true;
      if (gateway.mode === "real") {
        yield emit("fetch", `Agent spend wallet ready: ${funded.address}${funded.depositTx ? ` (topped up ${short(funded.depositTx)})` : " (balance sufficient)"}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      yield* withholdOwnedReads("fetch");
    }
  }

  let lastSufficient = false;
  let readingAssessmentUnavailable = false;
  let lastGaps = 0; // sub-claims with coverage < 0.4 from the most recent sufficiency check
  // Most recent interim assessment and the read count it covered, so the final check can reuse it
  // instead of asking the same question about the same evidence twice.
  let interimAssessment: { result: SufficiencyResult; reads: number } | undefined;

  for (const d of buys) {
    if (documentAlreadyRead(d, gathered)) {
      const was = markUnread(d, "this canonical document was already read through another delivery channel; no second attention slot, access toll or independent contribution.");
      if (was === "BUY" && assetById.has(d.assetId ?? d.sourceId)) spentTolls = Math.max(0, round(spentTolls - d.price));
      yield emit("fetch", `SKIP ${d.sourceName}: this canonical document already contributes once; no redundant read or toll.`);
      continue;
    }
    if (webCandidates.has(d.assetId ?? d.sourceId)) {
      yield emit("fetch", `READ ${d.sourceName} - selected original public page, 0 USDC; not a cache hit.`);
      const read = await fetchWeb(d.assetId ?? d.sourceId);
      for (const message of scholarlyReadFailures.splice(0)) yield emit("fetch", message);
      if (input.signal?.aborted) throw new DOMException("Research cancelled", "AbortError");
      if (read) { const marker = `S${++markerN}`; gathered.push({ ...read, marker });
        yield emit("fetch", `Read extracted public text from ${read.itemUrl} - ${marker}; quote matching establishes source grounding, not fact verification.`); }
      else yield emit("fetch", `Public page unavailable (${lastWebFailure}); no evidence admitted. Continuing research.`);
      continue;
    }
    const publicRead = publicReads.get(d.assetId ?? d.sourceId);
    if (publicRead) {
      if (gathered.some(read => read.itemUrl === publicRead.itemUrl && contentBodyHash(read.text) === contentBodyHash(publicRead.text))) {
        yield emit("fetch", `SKIP ${d.sourceName}: this exact article already contributes once to the answer.`);
        continue;
      }
      const marker = `S${++markerN}`;
      gathered.push({ ...publicRead, marker });
      yield emit("fetch", `Read ${d.sourceName} - free public feed reference, no creator payment - ${marker}`);
      continue;
    }
    const asset = assetById.get(d.assetId ?? d.sourceId);
    if (!asset) continue;
    if (fundingUnavailable && asset.priceUsdc > 0) continue;
    const { source, item, cacheKey } = asset;
    try {
      const currentTerms = await sourceFetchTerms(source, { refresh: true });
      if (sourceRecipientIsExcluded(source, currentTerms, outsideFundedAsker)) throw new Error("Source recipient is excluded");
      const currentAccess = await sourceClaimAccess(db, source, currentTerms, { expected: asset.claimPolicy ?? null });
      if (!currentAccess.readAllowed || currentTerms.listPriceUsdc !== asset.listPriceUsdc) throw new Error("Source terms changed");
    } catch {
      yield emit("fetch", `SKIP ${source.name}: source claim or registry terms changed after discovery; no new payment.`);
      continue;
    }
    if (item && asset.claimPolicy && gathered.some(read => publicDuplicateOfOwnedItem(item, read, contentBodyHash))) {
      yield emit("fetch", `SKIP ${source.name}: this exact article was already read; no duplicate contribution or reward.`);
      continue;
    }
    if (await paperDuplicatesPublicBody(db, source, gathered.filter(read => read.sourceKind === "public-reference").map(read => read.text))) {
      yield emit("fetch", `SKIP paid manuscript ${source.name}: identical body was already read publicly, no duplicate access or reward.`);
      continue;
    }
    if (!await paperCanResearch(db, source, input.paidScholarly === true && origin === "web")) {
      yield emit("fetch", `SKIP ${source.name}: manuscript rights or registry terms changed before this read.`);
      continue;
    }
    const itemIdentity = { ...asset.candidate.item, evidenceProvenance: asset.candidate.item?.evidenceProvenance ?? source.evidenceProvenance };
    const assetLabel = item ? `${source.name} — ${item.title}` : source.name;
    const marker = `S${++markerN}`;
    if (asset.priceUsdc === 0 && item) {
      try {
        const text = await resolveFreeSourceItemContent(db, source, item, asset.claimPolicy ?? null);
        gathered.push({ assetId: asset.candidate.id, sourceId: source.id, sourceName: source.name,
          ...itemIdentity, marker, text, accessKind: "creator-free", creatorRewardEligible: asset.rewardAllowed !== false });
        yield emit("fetch", `READ ${assetLabel}: creator-authorized free access, 0 USDC; ${asset.rewardAllowed ? "only a qualified future citation may earn a reward" : "creator rewards are disabled"} — ${marker}`);
      } catch {
        if (asset.publicFallback) {
          gathered.push({ ...asset.publicFallback, marker });
          yield emit("fetch", `READ ${assetLabel}: creator delivery unavailable; original public reference retained, no creator reward — ${marker}`);
        } else yield emit("fetch", `Free creator article ${assetLabel} unavailable; continuing with other evidence.`);
      }
    } else if (d.action === "CACHE") {
      const cached = (await effects.getCached(cacheKey)) ?? "";
      gathered.push({
        assetId: asset.candidate.id,
        sourceId: source.id,
        sourceName: source.name,
        ...itemIdentity,
        marker,
        text: cached,
        creatorRewardEligible: asset.rewardAllowed !== false,
      });
      yield emit("fetch", `Reused cached ${assetLabel} (free) — ${marker}`);
    } else {
      if (budget === 0) {
        yield emit("fetch", `SKIP ${assetLabel}: this delivery requires the payment gateway; the question authorizes 0 USDC and no payment attempt.`);
        continue;
      }
      yield emit(
        "fetch",
        `Paying $${asset.priceUsdc} toll to read ${assetLabel}${asset.offer ? ` (signed offer; list $${asset.listPriceUsdc})` : ""}…`,
      );
      try {
        paymentAttempts++;
        await input.onCreatorPaymentBoundary?.();
        const { content, payment } = await gateway.payFetch({
          source,
          item,
          queryId,
          priceUsdc: asset.priceUsdc,
          offer: asset.offer,
          sourceClaim: asset.claimPolicy,
          deniedRecipient: outsideFundedAsker,
        });
        if (payment.settled) settledPayments++;
        if (paymentSettlementStatus(payment) === "pending") pendingPayments++;
        payment.origin = origin;
        payments.push(payment);
        const ledgerError = await persistPaymentRecord(payment);
        try {
          await effects.setCached(cacheKey, content);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          yield emit("fetch", `Read ${assetLabel}, but its cache could not be refreshed (${message}).`);
        }
        gathered.push({
          assetId: asset.candidate.id,
          sourceId: source.id,
          sourceName: source.name,
          ...itemIdentity,
          marker,
          text: content,
          creatorRewardEligible: asset.rewardAllowed !== false,
        });
        yield emit(
          "fetch",
          `${fetchPaymentMessage(payment, assetLabel)} — ${marker}`,
          payment,
        );
        if (ledgerError) {
          yield emit("fetch", `Payment receipt retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
        }
      } catch (err) {
        // One toll failing (transient settlement error, exhausted grant, sign timeout) must not
        // kill the whole run — skip this source and answer from whatever was already read.
        fetchFailures++;
        const reason = err instanceof Error ? err.message : String(err);
        const settled = settledPaymentFrom(err);
        if (settled) {
          settled.origin = origin;
          settledPayments++;
          payments.push(settled);
          const ledgerError = await persistPaymentRecord(settled);
          yield emit(
            "fetch",
            `Paid $${settled.amountUsdc} to ${assetLabel}, but its content response failed after settlement; receipt retained and the run continues without that article.`,
            settled,
          );
          if (ledgerError) {
            yield emit("fetch", `Settled receipt retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
          }
          continue;
        }
        const pending = pendingPaymentFrom(err);
        if (pending) {
          pending.origin = origin;
          pendingPayments++;
          payments.push(pending);
          const ledgerError = await persistPaymentRecord(pending);
          yield emit(
            "fetch",
            `${pendingAuthorizationLabel(pending)} $${pending.amountUsdc} authorization for ${assetLabel}; ${pendingConfirmationMessage(err)}. The amount is reserved, not counted as settled spend; skipping this article and continuing.`,
            pending,
          );
          if (ledgerError) {
            yield emit("fetch", `Pending authorization retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
          }
          continue;
        }
        // This is a definite pre-submission failure: typed pending/settled errors above are the
        // only post-authorization exits. Release the query-local reservation so another source can
        // fill the evidence gap without weakening the browser grant's independent atomic cap.
        spentTolls = Math.max(0, round(spentTolls - asset.priceUsdc));
        markUnread(d, "the purchase failed before any authorization was submitted, so nothing was bought.");
        yield emit("fetch", `Couldn't buy ${assetLabel} (${reason}) — skipping it, continuing with what's read.`);
        continue;
      }

      // stop-early check after each paid read — now with per-claim coverage
      let suf: SufficiencyResult;
      try { suf = await engine.sufficiency({ question: input.question, subClaims, gathered }); }
      catch {
        readingAssessmentUnavailable = true;
        yield emit("sufficiency", "Reading assessment unavailable; stopping further purchases and retaining completed reads and receipts.");
        break;
      }
      interimAssessment = { result: suf, reads: gathered.length };
      if (suf.perClaim && suf.perClaim.length > 0) {
        for (const c of suf.perClaim) {
          const pct = Math.round(c.coverage * 100);
          const by = c.coveredBy.length ? ` by ${c.coveredBy.join(", ")}` : "";
          yield emit("sufficiency", `Sub-claim "${c.claim.slice(0, 60)}${c.claim.length > 60 ? "…" : ""}": ${pct}% covered${by}`);
        }
      }
      yield emit("sufficiency", suf.rationale, { sufficient: suf.sufficient, perClaim: suf.perClaim });
      lastSufficient = suf.sufficient;
      lastGaps = suf.perClaim ? suf.perClaim.filter((c) => c.coverage < 0.4).length : 0;
      if (suf.sufficient) {
        // Record what actually happened: an unread selection is not a purchase, and its toll
        // reservation returns to the fetch budget for any later gap-filling read. A decision
        // already withheld by a funding failure keeps its reservation and its own rationale.
        let unreadBuys = 0;
        let released = 0;
        for (const x of buys.slice(buys.indexOf(d) + 1)) {
          const was = markUnread(x, "not read: the sources already read covered every research target, so the agent stopped early.");
          if (was === "BUY" && assetById.has(x.assetId ?? x.sourceId)) { unreadBuys++; released += x.price; }
        }
        spentTolls = Math.max(0, round(spentTolls - released));
        if (unreadBuys) {
          yield emit("sufficiency", `Stopping early — skipping ${unreadBuys} further paid fetch(es) to save budget.`);
        }
        break;
      }
    }
  }

  // 4b) RE-EVALUATE — after the initial fetch pass, assess per-claim coverage and
  // potentially buy additional previously-skipped sources to fill gaps. Multi-pass
  // reasoning: the agent "thinks twice" about whether its initial buy/skip choices
  // left any sub-claim unsupported, and spends remaining budget to close the gap.
  // The selection pass reserves context slots, but failed/stop-early fetches never entered the
  // synthesis context and therefore must not block a useful gap-filling read.
  attentionUsed = gathered.length;
  const gatheredIds = new Set(gathered.map((g) => g.assetId ?? g.sourceId));
  let remainingBudget = fetchBudget - spentTolls;

  // Skip re-evaluation when the last sufficiency check already confirmed full coverage —
  // no point burning an LLM call to discover there are no gaps.
  if (readingAssessmentUnavailable) {
    yield emit("reevaluate", "Additional purchases withheld because the reading assessment was unavailable.");
  } else if (lastSufficient && lastGaps === 0 && reevaluateRounds > 0) {
    yield emit("reevaluate", `All sub-claims already well-covered (sufficiency passed with 0 gaps) — skipping re-evaluation to save latency.`);
  } else if (gathered.length > 0 && reevaluateRounds > 0) {
    for (let round = 0; round < reevaluateRounds; round++) {
      if (input.signal?.aborted) throw new DOMException("Research cancelled", "AbortError");
      if (attentionUsed >= attentionLimit) {
        yield emit(
          "reevaluate",
          `Attention budget is full at ${attentionLimit} source(s); no broader context will be purchased.`,
        );
        break;
      }
      const skipped = finalDecisions
        .filter(
          (d) =>
            d.action === "SKIP" &&
            !d.external &&
            !discussionDoesNotMeetDocumentRequest(input.question, d.itemUrl) &&
            !discussionBlockedIds.has(d.assetId ?? d.sourceId) &&
            !isExternal(d.sourceId) &&
            !gatheredIds.has(d.assetId ?? d.sourceId) &&
            !documentAlreadyRead(d, gathered) &&
            (!fundingUnavailable || publicReads.has(d.assetId ?? d.sourceId) || webCandidates.has(d.assetId ?? d.sourceId)),
        )
        .map((d) => {
          const asset = assetById.get(d.assetId ?? d.sourceId);
          return {
            id: d.assetId ?? d.sourceId,
            name: d.sourceName,
            price: asset?.priceUsdc ?? (publicCandidates.has(d.assetId ?? d.sourceId) ? 0 : Infinity),
            preview: asset?.candidate.preview ?? publicCandidates.get(d.sourceId)?.preview ?? "",
          };
        }).filter(candidate => candidate.price === 0 || candidate.price <= remainingBudget);

      if (skipped.length === 0) break;

      let reeval: ReevaluateOutput;
      try { reeval = await engine.reevaluate({
        question: input.question,
        subClaims,
        gathered,
        skippedSources: skipped,
        remainingBudget,
      }); } catch {
        yield emit("reevaluate", "Gap assessment unavailable; retaining completed reads and withholding additional purchases.");
        break;
      }

      // Emit per-claim coverage assessment — visible multi-pass reasoning
      for (const c of reeval.claims) {
        const pct = Math.round(c.coverage * 100);
        yield emit(
          "reevaluate",
          `Sub-claim "${c.claim.slice(0, 60)}${c.claim.length > 60 ? "…" : ""}": ${pct}% covered${c.coveredBy.length ? ` by ${c.coveredBy.join(", ")}` : ""} — ${c.rationale}`,
          c,
        );
      }
      lastSufficient =
        reeval.claims.length > 0 &&
        reeval.claims.every(
          (claim) => claim.coverage >= MIN_REWARD_SUPPORT,
        );
      lastGaps = reeval.claims.filter(
        (claim) => claim.coverage < MIN_REWARD_SUPPORT,
      ).length;

      yield emit("reevaluate", reeval.rationale, {
        shouldBuyMore: reeval.shouldBuyMore,
        recommended: reeval.recommendedIds,
      });

      if (!reeval.shouldBuyMore || reeval.recommendedIds.length === 0) break;

      // Buy additional sources the engine recommended to fill coverage gaps
      for (const recId of reeval.recommendedIds) {
        if (input.signal?.aborted) throw new DOMException("Research cancelled", "AbortError");
        const recommended = webCandidates.get(recId) ?? publicCandidates.get(recId) ?? assetById.get(recId)?.candidate;
        if (recommended && documentAlreadyRead({ ...recommended.item, assetId: recommended.id, sourceId: recommended.sourceId ?? recommended.id }, gathered)) {
          yield emit("reevaluate", `SKIP ${recommended.name}: this canonical document was already read through another delivery channel; no redundant access toll or independent corroboration.`);
          continue;
        }
        if (discussionBlockedIds.has(recId) || discussionDoesNotMeetDocumentRequest(input.question, recommended?.item?.itemUrl) ||
            subClaims.length > 0 && subClaims.every(claim => discussionDoesNotMeetDocumentRequest(input.question, recommended?.item?.itemUrl, claim))) {
          yield emit("reevaluate", "Discussion-page recommendation withheld: the request requires official documentation.");
          continue;
        }
        if (attentionUsed >= attentionLimit) {
          yield emit(
            "reevaluate",
            `Attention budget reached ${attentionLimit} source(s); stopping gap expansion.`,
          );
          break;
        }
        if (webCandidates.has(recId) && !gatheredIds.has(recId)) {
          const read = await fetchWeb(recId);
          for (const message of scholarlyReadFailures.splice(0)) yield emit("reevaluate", message);
          if (input.signal?.aborted) throw new DOMException("Research cancelled", "AbortError");
          if (read) { const marker = `S${++markerN}`; gathered.push({ ...read, marker }); attentionUsed++; gatheredIds.add(recId);
            yield emit("reevaluate", `READ original public page ${read.itemUrl}, 0 USDC - ${marker}`); }
          else yield emit("reevaluate", `Public gap read unavailable (${lastWebFailure}); claim remains unknown.`);
          continue;
        }
        const publicRead = publicReads.get(recId);
        if (publicRead && !gatheredIds.has(recId)) {
          if (gathered.some(read => read.itemUrl === publicRead.itemUrl && contentBodyHash(read.text) === contentBodyHash(publicRead.text))) continue;
          const marker = `S${++markerN}`;
          gathered.push({ ...publicRead, marker });
          attentionUsed++;
          gatheredIds.add(recId);
          yield emit("reevaluate", `Filling gap - free public feed reference ${publicRead.sourceName}, no creator payment - ${marker}`);
          continue;
        }
        const asset = assetById.get(recId);
        const source = asset?.source;
        // Guard against an engine recommending a source we already read (duplicate marker +
        // double payment) or that no longer fits the remaining budget.
        if (!asset || !source || gatheredIds.has(recId) || (remainingBudget <= 0 && asset.priceUsdc > 0) || asset.priceUsdc > remainingBudget + 1e-9) continue;
        if (fundingUnavailable && asset.priceUsdc > 0) {
          yield* withholdOwnedReads("reevaluate", recId);
          continue;
        }
        try {
          const currentTerms = await sourceFetchTerms(source, { refresh: true });
          if (sourceRecipientIsExcluded(source, currentTerms, outsideFundedAsker)) throw new Error("Source recipient is excluded");
          const access = await sourceClaimAccess(db, source, currentTerms, { expected: asset.claimPolicy ?? null });
          if (!access.readAllowed || currentTerms.listPriceUsdc !== asset.listPriceUsdc) throw new Error("Source terms changed");
        } catch { yield emit("reevaluate", `SKIP ${source.name}: claim or registry terms changed; no new payment.`); continue; }
        if (asset.item && asset.claimPolicy && gathered.some(read => publicDuplicateOfOwnedItem(asset.item!, read, contentBodyHash))) continue;
        if (await paperDuplicatesPublicBody(db, source, gathered.filter(read => read.sourceKind === "public-reference").map(read => read.text))) {
          yield emit("reevaluate", `SKIP paid manuscript ${source.name}: identical public body is already evidence, no duplicate payment.`);
          continue;
        }
        if (!await paperCanResearch(db, source, input.paidScholarly === true && origin === "web")) {
          yield emit("reevaluate", `SKIP ${source.name}: manuscript rights or registry terms changed before this read.`);
          continue;
        }

        const marker = `S${++markerN}`;
        const assetLabel = asset.item ? `${source.name} — ${asset.item.title}` : source.name;
        const itemIdentity = { ...asset.candidate.item, evidenceProvenance: asset.candidate.item?.evidenceProvenance ?? source.evidenceProvenance };
        // A fresh cached copy is already paid for: read it instead of buying the same article again.
        if (asset.priceUsdc > 0 && freshCache.has(recId)) {
          const cachedText = await effects.getCached(asset.cacheKey).catch(() => null);
          if (cachedText) {
            gathered.push({ assetId: asset.candidate.id, sourceId: source.id, sourceName: source.name,
              ...itemIdentity, marker, text: cachedText, creatorRewardEligible: asset.rewardAllowed !== false });
            attentionUsed++; gatheredIds.add(recId);
            yield emit("reevaluate", `Filling gap — reused cached ${assetLabel} (free) — ${marker}`);
            continue;
          }
        }
        if (asset.priceUsdc === 0 && asset.item) {
          try {
            const text = await resolveFreeSourceItemContent(db, source, asset.item, asset.claimPolicy ?? null);
            gathered.push({ assetId: asset.candidate.id, sourceId: source.id, sourceName: source.name,
              ...itemIdentity, marker, text, accessKind: "creator-free", creatorRewardEligible: asset.rewardAllowed !== false });
            attentionUsed++; gatheredIds.add(recId);
            yield emit("reevaluate", `READ ${assetLabel}: creator-authorized free article, 0 USDC — ${marker}`);
          } catch { yield emit("reevaluate", `Free creator article ${assetLabel} unavailable; continuing research.`); }
          continue;
        }
        // Funding errors have their own uncertainty boundary. They are never
        // interpreted as a creator payment record or permission to retry funding.
        if (budget === 0) {
          yield emit("reevaluate", `SKIP ${assetLabel}: no payment gateway delivery is authorized by a 0 USDC question.`);
          continue;
        }
        if (!spendWalletReady) {
          try {
            await gateway.ensureFunded(budget);
            spendWalletReady = true;
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") throw error;
            yield* withholdOwnedReads("reevaluate", recId);
            continue;
          }
        }
        yield emit("reevaluate", `Filling gap — buying ${assetLabel} ($${asset.priceUsdc})…`);
        try {
          paymentAttempts++;
          await input.onCreatorPaymentBoundary?.();
          const { content, payment } = await gateway.payFetch({
            source,
            item: asset.item,
            queryId,
            priceUsdc: asset.priceUsdc,
            offer: asset.offer,
            sourceClaim: asset.claimPolicy,
            deniedRecipient: outsideFundedAsker,
          });
          if (payment.settled) settledPayments++;
          if (paymentSettlementStatus(payment) === "pending") pendingPayments++;
          payment.origin = origin;
          payments.push(payment);
          const ledgerError = await persistPaymentRecord(payment);
          try {
            await effects.setCached(asset.cacheKey, content);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            yield emit("reevaluate", `Read ${assetLabel}, but its cache could not be refreshed (${message}).`);
          }
          gathered.push({
            assetId: asset.candidate.id,
            sourceId: source.id,
            sourceName: source.name,
            ...itemIdentity,
            marker,
            text: content,
            creatorRewardEligible: asset.rewardAllowed !== false,
          });
          attentionUsed++;
          gatheredIds.add(asset.candidate.id);
          remainingBudget -= asset.priceUsdc;
          spentTolls += asset.priceUsdc;

          yield emit(
            "reevaluate",
            `${fetchPaymentMessage(payment, assetLabel)} — ${marker}`,
            payment,
          );
          if (ledgerError) {
            yield emit("reevaluate", `Payment receipt retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          const settled = settledPaymentFrom(err);
          if (settled) {
            settled.origin = origin;
            settledPayments++;
            payments.push(settled);
            const ledgerError = await persistPaymentRecord(settled);
            // This source was selected only during re-evaluation, so consume its query slice here.
            remainingBudget -= asset.priceUsdc;
            spentTolls += asset.priceUsdc;
            yield emit(
              "reevaluate",
              `Paid $${settled.amountUsdc} to ${assetLabel}, but its content response failed after settlement; receipt retained and the gap remains open.`,
              settled,
            );
            if (ledgerError) {
              yield emit("reevaluate", `Settled receipt retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
            }
            continue;
          }
          const pending = pendingPaymentFrom(err);
          if (pending) {
            pending.origin = origin;
            pendingPayments++;
            payments.push(pending);
            const ledgerError = await persistPaymentRecord(pending);
            // It may already have settled, so this reservation still consumes the per-query slice.
            remainingBudget -= asset.priceUsdc;
            spentTolls += asset.priceUsdc;
            yield emit(
              "reevaluate",
              `${pendingAuthorizationLabel(pending)} $${pending.amountUsdc} authorization for ${assetLabel}; ${pendingConfirmationMessage(err)}. The reserved budget stays consumed.`,
              pending,
            );
            if (ledgerError) {
              yield emit("reevaluate", `Pending authorization retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
            }
            continue;
          }
          yield emit("reevaluate", `Couldn't buy ${assetLabel} to fill gap (${reason}) — continuing.`);
        }
      }
    }
  }

  if (gathered.length === 0) {
    // An observed empty evidence set is measured zero support, not missing telemetry.
    evidenceMeasured = true;
    claimCoverage = subClaims.map((claim, claimIndex) => ({
      claimIndex, claim, coverage: 0, coveredBy: [],
    }));
    return finish(emptyEvidenceAnswer({ question: input.question, outcomes: publicReadOutcomes,
      skipped: finalDecisions.filter(decision => webCandidates.has(decision.assetId ?? decision.sourceId) && decision.action === "SKIP"),
      discovery: webDiscovery, fundingUnavailable, pendingPayments, settledPayments, fetchFailures }));
  }

  // 4c) FINAL COVERAGE — confidence and citation rewards are authorized only by an assessment of
  // the complete read set. An interim assessment is reused solely when nothing was read after it
  // (the read list is append-only, so an equal count is identical evidence); any later cache read
  // or re-evaluation purchase forces a fresh assessment.
  let finalSufficiency: SufficiencyResult;
  let finalAssessmentAvailable = true;
  try {
    finalSufficiency = interimAssessment?.reads === gathered.length
      ? interimAssessment.result
      : await engine.sufficiency({
          question: input.question,
          subClaims,
          gathered,
        });
  } catch {
    finalAssessmentAvailable = false;
    finalSufficiency = {
      sufficient: false,
      rationale:
        "Final evidence assessment was unavailable; coverage defaults to zero and citation rewards are withheld.",
      perClaim: subClaims.map((claim) => ({
        claim,
        coverage: 0,
        coveredBy: [],
      })),
    };
    yield emit(
      "sufficiency",
      "Final coverage assessment failed; continuing conservatively with zero coverage.",
      { final: true, failed: true },
    );
  }
  for (const c of finalSufficiency.perClaim ?? []) {
    const pct = Math.round(c.coverage * 100);
    const by = c.coveredBy.length
      ? ` by ${c.coveredBy.join(", ")}`
      : "";
    yield emit(
      "sufficiency",
      `Final check — "${c.claim.slice(0, 60)}${c.claim.length > 60 ? "…" : ""}": ${pct}% assessed${by}`,
      c,
    );
  }
  yield emit(
    "sufficiency",
    `Final coverage assessment — ${finalSufficiency.rationale}`,
    {
      final: true,
      sufficient: finalSufficiency.sufficient,
      perClaim: finalSufficiency.perClaim,
    },
  );

  // 5) SYNTHESIZE
  yield emit("synthesize", `Synthesizing a grounded answer from ${gathered.length} source(s)…`);
  let synthesized: SynthResult;
  const ordinaryPresentation = effects.scope.kind === "public" && !input.targetAsset && !input.paidScholarly &&
    !input.answerFormat && process.env.KERYX_DECISION_BRIEF !== "1";
  const presentation = answerPresentation(input.originalQuestion ?? input.question, ordinaryPresentation ? "ordinary" : "retained");
  // First-turn ordinary caller only. Augmented follow-ups, retained/private
  // originals and bounded packages keep their existing synthesis contract.
  const teachingRequest = process.env.KERYX_TEACHING_PROPOSALS === "1" && effects.scope.kind === "public" &&
    (origin !== "engine" || input.allowExternalWeb === true) && !input.executionLimits &&
    !input.targetAsset && !input.paidScholarly && !input.answerFormat && process.env.KERYX_DECISION_BRIEF !== "1" &&
    (input.originalQuestion === undefined || input.originalQuestion === input.question)
    ? parseTeachingProposalRequest(input.originalQuestion ?? input.question) : undefined;
  try { synthesized = await engine.synthesize({ question: input.question, subClaims, gathered, generationFormat: "evidence-only",
    answerPresentation: presentation,
    ...(teachingRequest ? { teachingRequest } : {}),
    ...(input.answerFormat === "decision-brief" || process.env.KERYX_DECISION_BRIEF === "1"
      ? { answerFormat: "decision-brief" as const } : {}) }); }
  catch (error) {
    synthesized = { answer: "", citedMarkers: [], evidence: [], conflicts: [], evidenceReview: "unavailable", synthesisFailure: "synthesis" };
    const limit = synthesisOutputLimitFromError(error, "synthesis");
    if (limit) synthesized.synthesisOutputLimit = limit;
    yield emit("synthesize", "Synthesis unavailable; completed reads and payment receipts are retained, with unsupported conclusions withheld.");
  }
  const outputLimit = parseSynthesisOutputLimit(synthesized.synthesisOutputLimit);
  if (outputLimit) yield emit("synthesize",
    `Model response reached its configured ${outputLimit.outputTokenLimit}-token output limit during ${outputLimit.stage}; completed reads are retained.`,
    { reasoningOutputLimit: outputLimit });
  const synthesisFailure = synthesisFailureDetail(synthesized.synthesisFailure, gathered.length,
    researchResponseLanguage(input.question) === "vi");
  if (synthesisFailure) yield emit("synthesize", synthesisFailure,
    { synthesisFailureStage: synthesized.synthesisFailure, retainedReads: gathered.length });
  if (synthesized.evidenceReview) {
    yield emit("evidence", synthesized.evidenceReview === "unavailable"
      ? "Evidence relevance review unavailable; only qualified excerpts may be delivered, with unsupported prose and rewards withheld."
      : "Relevance review returned; only checked excerpts can retain support, and review cannot raise it.",
    { relevanceReview: synthesized.evidenceReview });
  }

  // Legacy conflict prose has no assertion-to-evidence review. Keep the warning
  // without streaming an unreviewed claim before the answer delivery boundary.
  if (synthesized.conflicts?.length) yield emit("adjudicate",
    "The draft reported possible source disagreements; their wording and preference remain unverified.",
    { reportedConflicts: synthesized.conflicts.length, status: "unverified" });

  // Guard against an empty body (e.g. the model returned unparseable JSON) so the run never
  // completes "done" showing a blank answer after real money was spent.
  let answer = synthesized.answer?.trim()
    ? synthesized.answer
    : `Read ${gathered.length} source(s) (${gathered.map((g) => g.sourceName).join(", ")}), but couldn't compose a written summary this run. Please try again.`;
  let ledger = buildEvidenceLedger({
    question: input.question,
    subClaims,
    gathered,
    answer,
    declaredMarkers: synthesized.citedMarkers,
    proposedEvidence: synthesized.evidence ?? [],
    finalAssessment: finalSufficiency.perClaim,
    rewardAuthorizationAvailable: finalAssessmentAvailable,
    allowIllustrativeDemo: gateway.mode === "offline",
  });
  const projectedBrief = deliverDecisionBrief(synthesized.decisionBrief, ledger, input.question);
  if (projectedBrief) ledger = projectedBrief.ledger;
  const brief = projectedBrief?.facts ? projectedBrief : undefined;
  evidence = ledger.evidence;
  claimCoverage = ledger.claimCoverage;
  if (evidencePortfolio) {
    evidencePortfolio = attachEvidencePortfolioOutcome(evidencePortfolio, {
      read: gathered,
      acceptedMarkers: ledger.acceptedMarkers,
      groundedClaims: claimCoverage.filter(
        (claim) => claim.coverage >= MIN_REWARD_SUPPORT,
      ).length,
    });
  }
  evidenceMeasured = true;
  // Sentences are admitted against the final ledger, after every source, quote and review gate.
  const citedStatements = brief ? [] : selectCitedStatements(synthesized.evidence ?? [], ledger);
  if (teachingRequest && !brief) {
    teachingProposals = deliverTeachingProposals(teachingRequest,
      synthesized.teachingProposals?.reviewed, ledger, citedStatements, synthesized.teachingProposals?.preparationGaps);
  }
  answer = brief?.answer ?? finalizeGroundedAnswer({ question: input.question, answer, ledger, statements: citedStatements,
    presentation,
    synthesisUnavailable: Boolean(synthesisFailure) });
  const vi = researchResponseLanguage(input.question) === "vi";
  const citedSummary = citedStatements.length > 0;
  const unavailableAssessment = Boolean(synthesisFailure) && ledger.acceptedMarkers.size === 0;
  yield emit("evidence", unavailableAssessment ? (vi
    ? "Chưa đánh giá được bằng chứng vì bước tổng hợp hoặc kiểm tra không hoàn tất; không cung cấp kết luận hay trích đoạn chưa được kiểm tra."
    : "Evidence assessment was unavailable because synthesis or review did not complete; unchecked conclusions and excerpts are withheld.") : brief ? (vi ? "Đã kiểm tra riêng từng nhận định và bước tiếp theo; vẫn còn giới hạn của trích đoạn và đánh giá model."
    : "Statements and conditional next steps received separate review; excerpt and model-assessment limitations remain.") : citedSummary ? (vi
    ? `Cung cấp ${citedStatements.length} câu tóm tắt, mỗi câu gắn với một trích đoạn nguyên văn đã kiểm tra; chưa xác minh được tổng hợp đầy đủ.`
    : `Delivering ${citedStatements.length} summary sentence(s), each tied to one checked verbatim excerpt; complete synthesis remains unverified.`) : vi
    ? "Chỉ cung cấp trích đoạn nguồn đủ điều kiện; chưa xác minh được tổng hợp đầy đủ và hỗ trợ cho từng nhận định."
    : "Delivering qualified source excerpts; complete synthesis and per-assertion support remain unverified.",
    { answerDelivery: brief ? "reviewed-decision-brief" : citedSummary ? "cited-summary" : "qualified-excerpts", completeness: "unverified",
      ...(unavailableAssessment ? { assessmentStatus: "unavailable" } : {}),
      ...(citedSummary ? { citedStatements: citedStatements.length } : {}),
      ...(brief ? { briefDigest: brief.digest, facts: brief.facts, actions: brief.actions } : {}) });
  const used = gathered.filter((g) =>
    ledger.acceptedMarkers.has(g.marker),
  );

  for (const item of evidence) {
    yield emit(
      "evidence",
      `${item.sourceKind === "public-reference" && item.qualifiesForAnswer ? "Source-matched public excerpt (no creator reward)" : item.qualifiesForReward ? "Source-matched reward-eligible excerpt" : "Below support/reward gate"} — ${item.marker}, research target ${item.claimIndex + 1}, proposed support ${Math.round(item.support * 100)}% (estimate, not entailment): “${item.quote.slice(0, 140)}${item.quote.length > 140 ? "…" : ""}”`,
      item,
    );
  }
  if (
    ledger.droppedEvidence > 0 ||
    ledger.droppedCitations.length > 0
  ) {
    yield emit(
      "evidence",
      `Rejected ${ledger.droppedEvidence} invalid evidence span(s) and ${ledger.droppedCitations.length} unsupported citation marker(s); rejected markers cannot receive citation rewards.`,
      {
        droppedEvidence: ledger.droppedEvidence,
        droppedCitations: ledger.droppedCitations,
      },
    );
  }
  if (used.length === 0) {
    yield emit(
      "evidence",
      `No citation passed the evidence gate — the $${citationPool.toFixed(6)} citation pool stays unspent; settled access tolls still stand.`,
      { citationPoolUsdc: round(citationPool), withheld: true },
    );
  }

  // Coverage cannot resolve a contradiction or turn a source preference into corroboration.
  const evidenceVerdict = researchVerdict({ coverage: claimCoverage,
    sources: gathered,
    citedMarkers: [...ledger.acceptedMarkers], sourceMarkers: gathered.map(source => source.marker),
    conflicts: synthesized.conflicts ?? [], finalAssessmentSufficient: finalSufficiency.sufficient },
    ordinaryPresentation ? presentation.language : "en");
  // Coverage estimates describe the excerpt ledger, never a verified complete synthesis.
  const verdict: Confidence = ordinaryPresentation && !brief
    ? ordinaryConfidence(presentation.language, unavailableAssessment ? "unavailable" : citedSummary ? "summary" : "excerpts", evidenceVerdict.reason)
    : { level: "Low", reason: unavailableAssessment ? (vi
    ? "Bước tổng hợp hoặc kiểm tra bằng chứng chưa hoàn tất; chưa đánh giá được mức hỗ trợ của nguồn hay câu trả lời hữu ích."
    : "Synthesis or evidence review did not complete; source support and a useful answer remain unassessed.") : brief ? (vi
    ? "Bản phân tích đã qua kiểm tra bằng model trên trích đoạn có giới hạn; chưa xác minh tính đầy đủ hoặc tính đúng đắn độc lập."
    : "The brief received model review over bounded excerpts; completeness and independent factual correctness remain unverified.") : citedSummary ? (vi
    ? "Mỗi câu tóm tắt gắn với một trích đoạn nguyên văn và đã qua kiểm tra bằng mô hình; chưa xác minh tính đầy đủ hoặc tính đúng đắn độc lập."
    : `Each summary sentence is tied to a verbatim excerpt and model-checked; completeness and independent factual correctness remain unverified. Evidence assessment: ${evidenceVerdict.reason}`) : vi
    ? `Chỉ cung cấp trích đoạn nguồn; chưa xác minh được tổng hợp đầy đủ và hỗ trợ cho từng nhận định. Có ${claimCoverage.filter(claim => !(claim.coverage >= MIN_REWARD_SUPPORT)).length} yêu cầu dưới ngưỡng hỗ trợ theo đánh giá ghi nhận; độ bao phủ không chứng minh tính đúng đắn hoặc giải quyết mâu thuẫn nguồn.`
    : `Only source excerpts are delivered; complete synthesis and per-assertion support remain unverified. Evidence assessment: ${evidenceVerdict.reason}` };
  runConfidence = verdict;
  if (finalWordBudget && ordinaryPresentation && !brief && !teachingRequest && presentation.requestedMaximumWords) {
    finalWordBudget = { maximumWords: presentation.requestedMaximumWords,
      compactAnswer: compactWordBudgetAnswer(ledger, citedStatements, verdict) };
  } else finalWordBudget = undefined;

  if (verdict.level === "Low" && used.length > 0) {
    answer = ordinaryPresentation && !brief ? confidenceBanner(answer, verdict, presentation.language)
      : vi ? `> ⚠ Độ tin cậy thấp — ${verdict.reason} Kết quả chưa hoàn chỉnh.\n\n${answer}`
      : `> ⚠ Low confidence — ${verdict.reason.replace(/[.!?]$/, "")}. Treat this as provisional.\n\n${answer}`;
  }

  yield emit("synthesize", unavailableAssessment ? (vi
    ? "Đã giữ kết quả chưa hoàn chỉnh để kiểm tra việc giao kết quả; bước tổng hợp hoặc đánh giá bằng chứng không khả dụng."
    : "Retained an incomplete result for delivery review; synthesis or evidence assessment was unavailable.") : brief ? (vi ? `Đã chuẩn bị bản phân tích có dẫn nguồn từ ${used.length} nguồn`
    : `Prepared a cited decision brief from ${used.length} source(s)`) : citedSummary ? (vi
    ? `Đã chuẩn bị tóm tắt có trích dẫn từng câu từ ${used.length} nguồn`
    : `Prepared a sentence-cited summary from ${used.length} source(s)`) : vi ? `Đã chuẩn bị trích đoạn từ ${used.length} nguồn; chưa xác minh được tổng hợp đầy đủ`
    : `Prepared source excerpts citing ${used.length} source(s); complete synthesis is unverified`, { answer });
  yield emit("verdict", `Confidence: ${verdict.level} — ${verdict.reason}.`, verdict);

  // 6) ATTRIBUTE contribution weights
  if (used.length > 0) {
    let proposedAttributions: Awaited<ReturnType<typeof engine.attribute>> = [];
    try { proposedAttributions = await engine.attribute({
      question: input.question,
      answer,
      used,
    }); } catch {
      // Reuse the existing invalid/incomplete-attribution equal-share policy,
      // restricted to the final delivered evidence. No additional model call.
      yield emit("attribute", "Attribution unavailable; using the existing equal split across evidence-eligible delivered citations.");
    }
    const attributions = resolveAttributions(
      used,
      proposedAttributions,
    );
    const rewards = allocateSplit(
      round(citationPool),
      attributions.map((item) => item.weight),
    );
    citations = used.map((g, index) => {
      const attribution = attributions[index]!;
      return {
        marker: g.marker,
        sourceId: g.sourceId,
        sourceName: g.sourceName,
        itemId: g.itemId,
        itemTitle: g.itemTitle,
        itemUrl: g.itemUrl,
        contentVersion: g.contentVersion,
        itemPublishedAt: g.itemPublishedAt,
        evidenceProvenance: g.evidenceProvenance,
        contentReceipt: g.contentReceipt,
        sourceKind: g.sourceKind,
        publicDeliveryKind: g.publicDeliveryKind,
        webProvenance: g.webProvenance,
        requestedSource: g.requestedSource,
        scholarly: g.scholarly,
        sourceClaim: g.sourceClaim,
        accessKind: g.accessKind,
        weight: attribution.weight,
        reward: g.sourceKind === "public-reference" || g.creatorRewardEligible === false ? 0 : rewards[index] ?? 0,
        rationale: brief ? (vi ? "Đóng góp từ bằng chứng được giữ trong bản phân tích; trọng số là phân bổ, không chứng nhận tính đúng đắn."
          : "Contribution from evidence retained in the brief; weight is an allocation, not certification of factual correctness.") : attribution.rationale,
      };
    });
  }
  for (const c of citations) {
    yield emit("attribute", c.sourceKind === "public-reference"
      ? `${c.sourceName} contributed ${(c.weight * 100).toFixed(0)}% - free public reference; reward share withheld`
      : `${c.sourceName} contributed ${(c.weight * 100).toFixed(0)}% - reward $${c.reward}`, c);
  }

  // 7) SETTLE weighted citation rewards (split across authors)
  if (gateway.operatingFeePolicy && gateway.payOperatingFee && origin !== "a2a" && input.fundingOwner !== "browser"
      && citations.some(citation => citation.sourceKind === "public-reference")) {
    try {
      const plan = await prepareOperatingFee({ queryId, poolUsdc: Math.min(round(citationPool), Math.floor(budget * 1e6 / 2) / 1e6),
        citations, policy: gateway.operatingFeePolicy(), readClaim: url => sourceClaimForUrl(db, url), itemClaimUrls });
      if (plan) {
        operatingFee = plan.snapshot;
        yield emit("settle", `Keryx operating allocation $${plan.snapshot.amountUsdc.toFixed(6)} for unclaimed public citations; sponsored by Keryx, separate from creator rewards.`, plan.snapshot);
        if (fundingUnavailable) throw new Error("Funding readiness is unknown");
        if (!spendWalletReady) { await gateway.ensureFunded(budget); spendWalletReady = true; }
        paymentAttempts++;
        let payment: PaymentRecord;
        try { payment = await gateway.payOperatingFee({ queryId, operatingFee: plan.context }); }
        catch (error) {
          const retained = settledPaymentFrom(error) ?? pendingPaymentFrom(error);
          if (!retained) throw error;
          payment = retained;
        }
        payment.origin = origin;
        const status = paymentSettlementStatus(payment);
        if (status === "settled") settledPayments++;
        if (status === "pending") pendingPayments++;
        payments.push(payment);
        operatingFee = { ...plan.snapshot, status, paymentId: payment.id, reason: undefined };
        await persistPaymentRecord(payment);
        yield emit("settle", status === "settled"
          ? `Settled $${payment.amountUsdc.toFixed(6)} Keryx operating fee for unclaimed public citations.`
          : `Keryx operating authorization $${payment.amountUsdc.toFixed(6)} ${status}; not counted as settled.`, payment);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (operatingFee) operatingFee = { ...operatingFee, status: "withheld", reason: "Operating fee could not be admitted; no new authorization may replace an unresolved original." };
      yield emit("settle", "Keryx operating fee withheld: reviewed authority, unclaimed-source proof or funding capacity is unavailable. The answer remains available.");
    }
  }
  for (const c of citations) {
    if (publicReads.has(c.sourceId) || isPublicReferenceId(c.sourceId)) continue;
    const source = sourceById.get(c.sourceId);
    if (!source || c.reward <= 0) continue;
    try {
      const terms = await sourceFetchTerms(source, { refresh: true });
      if (sourceRecipientIsExcluded(source, terms, outsideFundedAsker)) throw new Error("Source recipient is excluded");
      const access = await sourceClaimAccess(db, source, terms, { expected: c.sourceClaim ?? null });
      if (!access.rewardAllowed) throw new Error("Creator rewards are disabled");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      c.reward = 0;
      yield emit("settle", `Citation reward withheld for ${source.name}: current policy does not authorize a new payment. The cited answer remains available.`);
      continue;
    }
    if (fundingUnavailable) { c.reward = 0; continue; }
    if (!spendWalletReady) {
      try { await gateway.ensureFunded(budget); spendWalletReady = true; }
      catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        yield* withholdOwnedReads("settle");
        c.reward = 0;
        continue;
      }
    }
    const authors = source.authors.length ? source.authors : [{ name: source.name, walletAddress: source.walletAddress, splitWeight: 1 }];
    // Allocate the reward across authors in integer micro-USDC so the settled legs sum to EXACTLY
    // c.reward — independent rounding per author (round(reward * weight)) would let the legs drift
    // a micro-USDC off the reward, and that drift accumulates across every settlement.
    const legAmounts = allocateSplit(c.reward, authors.map((a) => a.splitWeight));
    // Author legs settled for THIS citation — used to ping the source's notify webhook once per
    // citation (not once per author leg), carrying every leg's real on-chain settlement state.
    const citationPayments: PaymentRecord[] = [];
    for (let i = 0; i < authors.length; i++) {
      const author = authors[i];
      const amount = legAmounts[i];
      if (amount <= 0) continue;
      const rationale = `Citation reward (${(c.weight * 100).toFixed(0)}% contribution${authors.length > 1 ? `, ${(author.splitWeight * 100).toFixed(0)}% author split` : ""}).`;
      try {
        assertRecipientAllowed(author.walletAddress, outsideFundedAsker);
        paymentAttempts++;
        await input.onCreatorPaymentBoundary?.();
        const item =
          c.itemId && c.itemTitle && c.itemUrl && c.contentVersion
            ? {
                itemId: c.itemId,
                itemTitle: c.itemTitle,
                itemUrl: c.itemUrl,
                contentVersion: c.contentVersion,
                ...(c.itemPublishedAt ? { itemPublishedAt: c.itemPublishedAt } : {}),
                ...(c.contentReceipt ? { contentReceipt: c.contentReceipt } : {}),
                ...(c.sourceClaim ? { sourceClaim: c.sourceClaim } : {}),
                ...(c.accessKind ? { accessKind: c.accessKind } : {}),
              }
            : undefined;
        const payment = await gateway.payCitation({
          source,
          author,
          item,
          amount,
          weight: c.weight,
          queryId,
          rationale,
          sourceClaim: c.sourceClaim,
          deniedRecipient: outsideFundedAsker,
        });
        if (payment.settled) settledPayments++;
        if (paymentSettlementStatus(payment) === "pending") pendingPayments++;
        payment.origin = origin;
        payments.push(payment);
        const ledgerError = await persistPaymentRecord(payment);
        if (paymentCountsAsSpent(payment)) citationPayments.push(payment);
        yield emit(
          "settle",
          citationPaymentMessage(payment, author.name),
          payment,
        );
        if (ledgerError) {
          yield emit("settle", `Payment receipt retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
        }
        if (paymentSettlementStatus(payment) === "pending") {
          effects.alert(
            `citation settlement pending → ${author.name}`,
            `$${amount} for "${source.name}" has a submitted authorization but no Circle confirmation.`,
          );
        }
      } catch (err) {
        // The answer is already written — a citation-settlement hiccup must not discard it.
        const reason = err instanceof Error ? err.message : String(err);
        const settled = settledPaymentFrom(err);
        if (settled) {
          settled.origin = origin;
          settledPayments++;
          payments.push(settled);
          citationPayments.push(settled);
          const ledgerError = await persistPaymentRecord(settled);
          yield emit(
            "settle",
            `Paid $${settled.amountUsdc} citation reward → ${author.name}; Circle confirmed settlement even though the paid route acknowledgement failed.`,
            settled,
          );
          if (ledgerError) {
            yield emit("settle", `Settled receipt retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
          }
          continue;
        }
        const pending = pendingPaymentFrom(err);
        if (pending) {
          pending.origin = origin;
          pendingPayments++;
          payments.push(pending);
          const ledgerError = await persistPaymentRecord(pending);
          yield emit(
            "settle",
            `${pendingAuthorizationLabel(pending)} $${pending.amountUsdc} citation authorization → ${author.name}; ${pendingConfirmationMessage(err)}. The amount is not counted as paid.`,
            pending,
          );
          if (ledgerError) {
            yield emit("settle", `Pending authorization retained in this dispatch, but the ledger row could not be written (${ledgerError}).`);
          }
          effects.alert(
            `citation settlement pending → ${author.name}`,
            `$${amount} for "${source.name}": ${reason}`,
          );
          continue;
        }
        yield emit("settle", `Couldn't settle the reward to ${author.name} (${reason}) — the answer stands.`, { error: reason });
        // A real-mode failure means a creator was owed USDC that didn't land — worth an ops alert.
        // Offline/simulated runs never settle, so they don't alert. Fire-and-forget (never throws).
        if (gateway.mode === "real") {
          effects.alert(`citation settlement failed → ${author.name}`, `$${amount} for "${source.name}": ${reason}`);
        }
      }
    }
    // Notify-on-citation: ping the creator's webhook the moment their source earns. Fire-and-forget
    // and self-contained (never throws) so a slow/dead endpoint can't stall or fail the run. The
    // dispatcher no-ops when the source has no webhook or no leg actually settled on-chain.
    if (citationPayments.length > 0) {
      const notifyInput = {
        source,
        citation: c,
        payments: citationPayments,
        queryId,
        question: input.question,
        network: config.network,
      };
      effects.notifyCitation(notifyInput);
      if (citationPayments.some((payment) => paymentSettlementStatus(payment) === "settled")) {
        await effects.activation("creator_citation_settled");
      }
    }
  }

  // Save query memory for cross-query learning (best-effort, fire-and-forget). What the agent read
  // goes with it, not just what it cited: a source paid for and then left unquoted is the only
  // evidence the next decision has that it does not earn its toll.
  try {
    await effects.saveMemory(
      queryId,
      input.question,
      citations,
      [...new Set(gathered.map((item) => item.sourceId))],
    );
  } catch {
    // Never fail a run on memory save
  }

  // Follow-up guidance describes observed limits after attribution and settlement. It must
  // not change model-assigned contribution weights or confer evidence/payment authority.
  const followUp = researchFollowUp({ vi, outcomes: publicReadOutcomes, gathered, conflicts: synthesized.conflicts ?? [],
    paymentReviewRequired: fundingUnavailable || pendingPayments > 0 || fetchFailures > 0,
    synthesisFailure: synthesized.synthesisFailure });
  if (followUp) {
    answer += `\n\n${followUp}`;
    if (finalWordBudget?.compactAnswer !== undefined) finalWordBudget.compactAnswer += `\n\n${followUp}`;
  }
  // Append proposals after contribution allocation and settlement. Their text,
  // labels and gaps cannot enter factual coverage or model attribution input.
  if (teachingProposals) answer += `\n\n${teachingProposalAnswer(teachingProposals)}`;
  return finish(answer);

  // ── helpers ──
  /**
   * Turn a selected-but-never-read decision into a SKIP so receipts and counts match reality.
   * Returns the action it replaced, or null when the decision was already a SKIP or is unknown.
   */
  function markUnread(decision: Decision, reason: string): "BUY" | "CACHE" | null {
    const assetId = decision.assetId ?? decision.sourceId;
    const index = finalDecisions.findIndex((item) => !item.external && (item.assetId ?? item.sourceId) === assetId);
    const current = index < 0 ? undefined : finalDecisions[index];
    if (!current || current.action === "SKIP") return null;
    // Replace rather than mutate: the decide step already streamed the planning snapshot.
    finalDecisions[index] = { ...current, action: "SKIP", rationale: `${current.rationale} — ${reason}` };
    return current.action;
  }
  function withholdOwnedReads(phase: "fetch" | "reevaluate" | "settle", selectedAssetId?: string): TraceStep[] {
    const steps: TraceStep[] = [];
    if (!fundingUnavailable) {
      fundingUnavailable = true;
      steps.push(emit(phase, fundingNotice, {
        fundingReadiness: "unknown", automaticPaidAttemptsBlocked: true,
      }));
    }
    for (const [index, decision] of finalDecisions.entries()) {
      const assetId = decision.assetId ?? decision.sourceId;
      if (decision.external || publicCandidates.has(assetId) || assetById.get(assetId)?.priceUsdc === 0
        || (decision.action !== "BUY" && decision.action !== "CACHE" && assetId !== selectedAssetId)) continue;
      // decide events retain the published planning snapshot. Replace the final
      // decision instead of mutating the object already streamed and traced.
      const withheld: Decision = { ...decision, action: "SKIP",
        rationale: "Funding readiness is unknown; this owned source cannot be read or rewarded in this run." };
      finalDecisions[index] = withheld;
      steps.push(emit(phase, `SKIP ${withheld.sourceName}: ${withheld.rationale}`));
    }
    // Keep the query-local fetch reservation intact. A funding error cannot
    // establish no wallet movement, release signer capacity or authorize refunds.
    return steps;
  }
  function finish(answer: string): QueryRun {
    const originals = requestedSourceReport({ candidates: requested.candidates, notices: requested.notices,
      decisions: finalDecisions, gathered, evidence, outcomes: publicReadOutcomes,
      vi: researchResponseLanguage(input.question) === "vi", withheld: externalDocumentsWithheld });
    const recency = sourceRecencyReport(recencyGaps, researchResponseLanguage(input.question) === "vi");
    const observedRecency = sourceRecencyObservationReport(recencyObservations, researchResponseLanguage(input.question) === "vi");
    const withOperationalNotices = (body: string): string => {
      if (originals) body += `\n\n${originals}`;
      if (recency) body = gathered.length === 0 ? `${recency}\n\n${body}` : `${body}\n\n${recency}`;
      if (observedRecency) body += `\n\n${observedRecency}`;
      if (fundingUnavailable) body = `> ${fundingNotice}\n\n${body}`;
      return body;
    };
    answer = withOperationalNotices(answer);
    if (finalWordBudget) {
      const delivered = finishWordBudgetAnswer(answer,
        finalWordBudget.compactAnswer === undefined ? undefined : withOperationalNotices(finalWordBudget.compactAnswer),
        finalWordBudget.maximumWords);
      answer = delivered.answer;
      emit("synthesize", "Final complete-answer word-budget projection; evidence and payment decisions are unchanged.",
        { answer, maximumWords: finalWordBudget.maximumWords, words: delivered.words, outcome: delivered.outcome });
    }
    const totalSpent = round(
      payments
        .filter(paymentCountsAsSpent)
        .reduce((sum, payment) => sum + payment.amountUsdc, 0),
    );
    const pendingSpendUsdc = round(
      payments
        .filter((payment) => paymentSettlementStatus(payment) === "pending")
        .reduce((sum, payment) => sum + payment.amountUsdc, 0),
    );
    const run: QueryRun = {
      id: queryId,
      question: input.question,
      budget,
      researchMode,
      ...(previewCoverage ? { previewCoverage } : {}),
      ...(evidencePortfolio ? { evidencePortfolio } : {}),
      // What actually answered, not what was picked: a run that fell back to the heuristic must not
      // present itself as model-reasoned (see ResilientEngine.effectiveName).
      engine: effectiveEngineName(engine),
      reasoningAttempts: reasoningAttempts(engine),
      llmUsage: reasoningUsage(engine),
      llmCalls: reasoningCalls(engine),
      subClaims,
      decisions: finalDecisions,
      citations,
      ...(evidenceMeasured ? { evidence, claimCoverage } : {}),
      ...(teachingProposals ? { teachingProposals } : {}),
      ...(recencyEnabled && recencyRequirement ? { sourceRecency: projectSourceRecencyResult({ version: 1, scope: "current-feed",
        metadataReads: recencyResolver.readsUsed, observations: recencyObservations, gaps: recencyGaps }) } : {}),
      answer,
      totalSpent,
      totalToCreators: round(payments.filter(payment => payment.kind !== "operating-fee" && paymentCountsAsSpent(payment))
        .reduce((sum, payment) => sum + payment.amountUsdc, 0)),
      ...(operatingFee ? { operatingFee } : {}),
      trace,
      createdAt: new Date().toISOString(),
      origin,
      ...(effects.scope.kind === "public" ? { provenance: newRunProvenance(input) } : {}),
      ...(origin === "mcp" && input.mcpClient ? { mcpClient: input.mcpClient } : {}),
      ...(input.asker ? { asker: input.asker.toLowerCase() } : {}),
      fundingOwner: gateway.mode === "offline" ? "offline" : (input.fundingOwner ?? "treasury"),
      durationMs: Math.max(0, Date.now() - startedAt),
      paymentMode: gateway.mode,
      paymentAttempts,
      settledPayments,
      pendingPayments,
      pendingSpendUsdc,
      // Only present on a retry, so every other surface keeps reading runs exactly as before.
      ...(input.retryOf ? { retryOf: input.retryOf } : {}),
      // Early returns (no sources, no purchase) never reach the verdict step — nothing was read,
      // so the honest label is Low rather than an absent field the surfaces would have to guess at.
      confidence: runConfidence,
    };
    emit(
      "done",
      `Done. Spent $${totalSpent} across ${payments.length - pendingPayments} confirmed/simulated payment(s)${operatingFee ? "; Keryx operating fees are separate from creator rewards" : " to creators"}${pendingPayments ? `; ${pendingPayments} authorization(s) await settlement confirmation` : ""}.${fundingUnavailable ? " Creator-payment amounts only; wallet funding effects remain unknown." : ""}`,
    );
    return demoteSyntheticEvidence(run);
  }
}

function short(tx?: string | null): string {
  return tx ? `${tx.slice(0, 10)}…` : "no-tx";
}

function pendingConfirmationMessage(error: unknown): string {
  return error instanceof PaymentPendingError && !error.submissionAttempted
    ? "Keryx withheld submission; external use remains uncertain"
    : "settlement confirmation is pending";
}

function pendingAuthorizationLabel(payment: PaymentRecord): string {
  if (payment.authorizationPhase === "prepared" || payment.authorizationPhase === "exposed") {
    return "Reserved, possibly unsigned";
  }
  return payment.authorizationPhase === "submission_attempted" ? "Submitted" : "Signed";
}

function fetchPaymentMessage(payment: PaymentRecord, sourceName: string): string {
  const status = paymentSettlementStatus(payment);
  if (status === "settled") {
    return `Paid $${payment.amountUsdc} to ${sourceName} (settled ${short(payment.txHash)})`;
  }
  if (status === "pending") {
    return `Unlocked ${sourceName} after a $${payment.amountUsdc} signed authorization (settlement confirmation pending)`;
  }
  return `Simulated $${payment.amountUsdc} toll to ${sourceName} (offline)`;
}

function citationPaymentMessage(payment: PaymentRecord, authorName: string): string {
  const status = paymentSettlementStatus(payment);
  if (status === "settled") {
    return `Settled $${payment.amountUsdc} citation reward → ${authorName} (${short(payment.txHash)})`;
  }
  if (status === "pending") {
    return `Submitted $${payment.amountUsdc} citation authorization → ${authorName}; settlement confirmation pending`;
  }
  return `Simulated $${payment.amountUsdc} citation reward → ${authorName} (offline)`;
}
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Accept model weights only when every evidence-eligible source appears exactly once with a finite
 * positive weight. Otherwise fall back to an equal split across the already-validated citations:
 * an attribution transport/schema failure must not redirect money, but it also must not make a
 * genuinely grounded creator silently lose the reward promised by the product.
 */
function resolveAttributions(
  used: GatheredContent[],
  proposed: { sourceId: string; weight: number; rationale: string }[],
): { sourceId: string; weight: number; rationale: string }[] {
  const allowed = new Set(used.map((item) => item.sourceId));
  const byId = new Map<
    string,
    { sourceId: string; weight: number; rationale: string }
  >();
  let invalid = false;
  for (const item of proposed) {
    if (
      !allowed.has(item.sourceId) ||
      byId.has(item.sourceId) ||
      !Number.isFinite(item.weight) ||
      item.weight <= 0
    ) {
      invalid = true;
      continue;
    }
    byId.set(item.sourceId, item);
  }

  if (!invalid && byId.size === used.length) {
    const total = [...byId.values()].reduce(
      (sum, item) => sum + item.weight,
      0,
    );
    if (Number.isFinite(total) && total > 0) {
      return used.map((item) => {
        const attribution = byId.get(item.sourceId)!;
        return {
          ...attribution,
          weight: attribution.weight / total,
        };
      });
    }
  }

  return used.map((item) => ({
    sourceId: item.sourceId,
    weight: 1 / used.length,
    rationale:
      "Evidence-validated citation; equal split used because attribution was incomplete or invalid.",
  }));
}

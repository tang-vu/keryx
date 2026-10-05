/**
 * ReasoningEngine — the agent's brain interface.
 *
 * The engine REASONS about value (decompose, decide, sufficiency, synthesize, attribute).
 * It never moves money and never enforces the hard budget cap — the orchestrator does that
 * deterministically on top, so a hallucinated number can never overspend.
 *
 * Two implementations: `AnthropicEngine` (real Claude reasoning, the demo path) and
 * `HeuristicEngine` (deterministic, runs offline with no API key).
 */

import type { Decision, SourceItemIdentity } from "../types";

/** A local request bound, before contacting a supplier. It must not mark a provider unhealthy. */
export class ReasoningInputLimitError extends Error {
  readonly status = 413;
  constructor(message: string, readonly bounds?: ReasoningInputBounds) { super(message); }
}

export interface ReasoningInputBounds {
  promptUtf8Bytes: number;
  requestedOutputTokens: number;
  /** Conservative byte-fallback token upper bound plus output allowance. */
  maximumCombinedUnits: number;
}

/** A completed model response failed the bounded output/decision contract, not the network. */
export class ReasoningOutputValidationError extends Error {}

/** Only transport boundaries may label a statusless failure as network/timeout. */
export class ReasoningTransportError extends Error {
  constructor(readonly category: "network" | "timeout") { super(`Reasoning transport ${category}`); }
}

export type ReasoningStep =
  | "decompose"
  | "decide"
  | "sufficiency"
  | "reevaluate"
  | "synthesize"
  | "attribute";

/**
 * One actual attempt to serve a reasoning step. Errors are deliberately reduced to a status/code:
 * provider response bodies can contain request context and must not become public run metadata.
 */
export interface ReasoningAttempt {
  step: ReasoningStep;
  engine: string;
  /** Zero is the requested/default tier; larger values are progressively deeper fallbacks. */
  tier: number;
  attempt: number;
  startedAt: number;
  durationMs: number;
  outcome: "served" | "failed" | "circuit-open" | "input-limited";
  /** Remaining shared cooldown/half-open lease when this attempt was skipped. */
  retryAfterMs?: number;
  status?: number;
  error?: "timeout" | "rate_limited" | "provider" | "network" | "invalid_request" | "output_validation" | "input_limit" | "internal";
  /** Present only for a proved local refusal; never contains prompt or provider response text. */
  inputBounds?: ReasoningInputBounds;
}

/** Provider-reported token usage for one completed (or billable truncated) model response.
 * Prompts and provider response bodies are deliberately never retained. */
export interface LlmUsageRecord {
  /** Locally generated call correlation; absent on historical usage. */
  callId?: string;
  engine: string;
  model: string;
  inputTokens: number;
  /** null means the cache split was missing, invalid or inconsistent, never measured zero. */
  cachedInputTokens: number | null;
  outputTokens: number;
  /** Captured per request. Absent on history; report time cannot reconstruct it. */
  costCapture?: import("../economics/provider-cost-policy").ProviderCostCapture;
}

/** A discoverable source the agent may choose to pay for (preview is free). */
export interface SourceCandidate {
  sourceKind?: "public-reference";
  id: string;
  /** Registry source behind the asset. Equals id for legacy source-level candidates. */
  sourceId?: string;
  /** Exact article version offered by this candidate. */
  item?: SourceItemIdentity;
  name: string;
  description: string;
  tags: string[];
  fetchPrice: number;
  /** Creator-signed discount terms; list price remains the registry ceiling. */
  offer?: {
    id: string;
    listPriceUsdc: number;
    expiresAt: number;
  };
  cached: boolean; // content already fetched & cached this session/recently
  preview: string; // free preview (recent item titles + summaries)
  /**
   * Present only on endpoints discovered in the live external x402 marketplace (Circle services).
   * All remain discovery-only, regardless of their advertised payment networks: the agent
   * reasons over them but the orchestrator never purchases them. Metadata is not payment authority.
   */
  external?: {
    resource: string; // the paid endpoint URL
    chains: string[]; // human labels for advertised payment networks (e.g. "Base", "Arc mainnet")
    payTo: string; // advertised seller wallet, not trusted payout authority
    onArc: boolean; // advertises acceptance on Keryx's selected Arc profile; discovery-only
  };
}

export interface DecideInput {
  question: string;
  subClaims: string[];
  candidates: SourceCandidate[];
  budget: number;
  spentSoFar: number;
  /** Optional memory context from past queries — aggregated source performance stats. */
  memoryContext?: string;
}

/** Content the agent has unlocked, ready to read. */
export interface GatheredContent extends Partial<SourceItemIdentity> {
  /** Trusted read-time policy can withhold rewards without discarding useful evidence. */
  creatorRewardEligible?: boolean;
  /** Reasoning candidate that produced this read; distinct from registry sourceId for articles. */
  assetId?: string;
  sourceId: string;
  sourceName: string;
  marker: string; // S1, S2, ... assigned by gather order
  text: string;
}

export interface SufficiencyInput {
  question: string;
  subClaims: string[];
  gathered: GatheredContent[];
}

/** Per-sub-claim coverage assessment from the sufficiency check. */
export interface ClaimSufficiency {
  claim: string;
  coverage: number; // 0..1
  coveredBy: string[]; // source markers (S1, S2, …)
}

export interface SufficiencyResult {
  sufficient: boolean;
  rationale: string;
  /** Per-claim coverage breakdown — present when the engine supports granular assessment. */
  perClaim?: ClaimSufficiency[];
}

export interface SynthInput {
  question: string;
  subClaims: string[];
  gathered: GatheredContent[];
  /** Internal staged delivery contract; source/payment authority is unchanged. */
  answerFormat?: "decision-brief";
}

/** A factual disagreement the agent found between sources while writing the answer,
 *  and which source it decided to trust (and why) instead of averaging them. */
export interface Conflict {
  point: string; // the factual point the sources disagree on
  positions: { marker: string; stance: string }[]; // what each conflicting source claims
  trusted: string; // the source marker the agent chose to trust
  reason: string; // why it trusted that one (specificity, internal consistency, recency)
}

/**
 * One model-proposed evidence span. The orchestrator treats this as an untrusted proposal:
 * claimIndex must name a real decomposed claim, marker must name gathered content, and quote must
 * occur verbatim (after whitespace normalization) in that source before it can authorize a
 * citation reward.
 */
export interface ProposedEvidence {
  claimIndex: number; // 0-based index into SynthInput.subClaims
  marker: string; // S1, S2, ...
  quote: string; // short verbatim span copied from the gathered source
  support: number; // 0..1 estimate of how directly the span supports the claim
  /** Server-resolved UTF-16 source offsets; private proposal metadata, not a receipt field. */
  quoteSpan?: import("./evidence-span").EvidenceSpan;
}

/** Result of synthesis: the grounded answer, which markers it cited, and any source
 *  conflicts the agent adjudicated on the way to writing it. */
export interface SynthResult {
  answer: string;
  citedMarkers: string[];
  conflicts: Conflict[];
  evidence: ProposedEvidence[];
  /** Optional second-pass relevance check; engines without this pass leave it absent. */
  evidenceReview?: "completed" | "unavailable";
  /** Server-local reviewed rows/context; never serialize this packet in public receipts. */
  decisionBrief?: import("./decision-brief").ReviewedDecisionBrief;
}

export interface AttributeInput {
  question: string;
  answer: string;
  used: GatheredContent[];
}

/** Coverage assessment for a single sub-claim after reading sources. */
export interface ClaimCoverage {
  claim: string;
  coverage: number; // 0..1
  coveredBy: string[]; // source markers
  rationale: string;
}

/** Input for the re-evaluation step: what's been read, what's been skipped, what budget remains. */
export interface ReevaluateInput {
  question: string;
  subClaims: string[];
  gathered: GatheredContent[];
  skippedSources: {
    id: string;
    name: string;
    price: number;
    preview: string;
  }[];
  remainingBudget: number;
}

/** Output of re-evaluation: per-claim coverage + whether to buy more sources and which. */
export interface ReevaluateOutput {
  claims: ClaimCoverage[];
  shouldBuyMore: boolean;
  recommendedIds: string[]; // sourceIds to buy, in priority order
  rationale: string;
}

export interface ReasoningEngine {
  /** identifier recorded on each query run, e.g. "llm:claude-haiku-4-5" or "heuristic" */
  readonly name: string;

  /** Run-local provider usage. Absent on engines that predate/support no usage telemetry. */
  readonly usage?: readonly LlmUsageRecord[];
  readonly calls?: readonly import("./call-ledger").LlmCallRecord[];

  /** Break a question into the atomic sub-claims an answer must support. */
  decompose(question: string): Promise<string[]>;

  /** Propose BUY/SKIP/CACHE per candidate with a human-readable rationale. */
  decide(input: DecideInput): Promise<Decision[]>;

  /** Decide whether enough has been read to answer confidently (enables early stop).
   *  Returns per-claim coverage when the engine supports granular assessment. */
  sufficiency(input: SufficiencyInput): Promise<SufficiencyResult>;

  /** After reading sources, assess per-claim coverage and identify gaps worth
   *  filling with additional purchases from previously-skipped candidates. */
  reevaluate(input: ReevaluateInput): Promise<ReevaluateOutput>;

  /** Write a grounded answer with inline [S#] citation markers, adjudicating any
   *  source disagreements (trusting one over another rather than averaging). */
  synthesize(input: SynthInput): Promise<SynthResult>;

  /** Assign each cited source a 0..1 contribution weight (cited weights sum to 1). */
  attribute(
    input: AttributeInput,
  ): Promise<{ sourceId: string; weight: number; rationale: string }[]>;
}

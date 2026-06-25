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

import type { Decision } from "../types";

/** A discoverable source the agent may choose to pay for (preview is free). */
export interface SourceCandidate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  fetchPrice: number;
  cached: boolean; // content already fetched & cached this session/recently
  preview: string; // free preview (recent item titles + summaries)
  /**
   * Present only on endpoints discovered in the live external x402 marketplace (Circle services).
   * They settle on other chains, not Keryx's Arc rail, so they are discovery-only: the agent
   * reasons over them but the orchestrator never purchases them.
   */
  external?: {
    resource: string; // the paid endpoint URL
    chains: string[]; // human chain labels it settles on (e.g. "Base", "Ethereum")
    payTo: string; // seller wallet
    onArc: boolean; // true only if it settles on Keryx's Arc rail (none today)
  };
}

export interface DecideInput {
  question: string;
  subClaims: string[];
  candidates: SourceCandidate[];
  budget: number;
  spentSoFar: number;
}

/** Content the agent has unlocked, ready to read. */
export interface GatheredContent {
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

  /** Write a grounded answer with inline [S#] citation markers. */
  synthesize(
    input: SynthInput,
  ): Promise<{ answer: string; citedMarkers: string[] }>;

  /** Assign each cited source a 0..1 contribution weight (cited weights sum to 1). */
  attribute(
    input: AttributeInput,
  ): Promise<{ sourceId: string; weight: number; rationale: string }[]>;
}

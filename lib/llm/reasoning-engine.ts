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

export interface ReasoningEngine {
  /** identifier recorded on each query run, e.g. "llm:claude-haiku-4-5" or "heuristic" */
  readonly name: string;

  /** Break a question into the atomic sub-claims an answer must support. */
  decompose(question: string): Promise<string[]>;

  /** Propose BUY/SKIP/CACHE per candidate with a human-readable rationale. */
  decide(input: DecideInput): Promise<Decision[]>;

  /** Decide whether enough has been read to answer confidently (enables early stop). */
  sufficiency(
    input: SufficiencyInput,
  ): Promise<{ sufficient: boolean; rationale: string }>;

  /** Write a grounded answer with inline [S#] citation markers. */
  synthesize(
    input: SynthInput,
  ): Promise<{ answer: string; citedMarkers: string[] }>;

  /** Assign each cited source a 0..1 contribution weight (cited weights sum to 1). */
  attribute(
    input: AttributeInput,
  ): Promise<{ sourceId: string; weight: number; rationale: string }[]>;
}

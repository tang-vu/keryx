/**
 * Reasoning engine selector. Default chain: Anthropic > DeepSeek (OpenAI-compatible) >
 * deterministic heuristic (offline, no API key — dev only, never the demo path).
 *
 * Model picker: pass a catalog model id to run that model instead. A non-default pick wraps
 * with fallback = Flash (itself falling back to the heuristic), so whichever model the asker
 * chooses, the run ALWAYS answers.
 */

import { config, llmProvider } from "../config";
import { AnthropicEngine } from "./anthropic-engine";
import { HeuristicEngine } from "./heuristic-engine";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { ResilientEngine } from "./resilient-engine";
import { DEFAULT_MODEL_ID, findModelChoice, MODEL_CATALOG, type ModelChoice } from "./model-catalog";
import type { ReasoningEngine } from "./reasoning-engine";

// Deliberately NOT cached across runs. A ResilientEngine tallies, per instance, which tier actually
// answered each reasoning step (see its `effectiveName`) so a run is labelled by what served it
// rather than by what it hoped to use. One shared instance would blend concurrent askers' runs into
// a single tally. Construction is a few field assignments over the global fetch — nothing to pool.

/** Catalog entries usable with the currently configured credentials. */
export function availableModels(): ModelChoice[] {
  return config.deepseekKey.length > 0 ? [...MODEL_CATALOG] : [];
}

/**
 * Resolve a caller-supplied model id to a usable catalog entry. Accepts the bare id or
 * the `keryx:`-prefixed form. Unknown ids, or picks whose provider key is not configured,
 * resolve to null — the caller then runs the default engine (never an error to the asker).
 */
export function resolveModelChoice(id?: string | null): ModelChoice | null {
  const m = findModelChoice(id);
  if (!m) return null;
  return config.deepseekKey.length > 0 ? m : null;
}

/** The credential-priority default engine (no model override). */
function buildDefaultEngine(): ReasoningEngine {
  switch (llmProvider()) {
    case "anthropic":
      return new ResilientEngine(new AnthropicEngine());
    case "deepseek":
      return new ResilientEngine(new OpenAICompatibleEngine());
    default:
      return new HeuristicEngine();
  }
}

/**
 * A catalog pick. Every non-default pick must PIN its wire model: the bare engine falls back to
 * `config.llmModel`, so leaving it unset would run the workhorse while the run reported itself as
 * the picked model — the exact mislabelling `effectiveName` exists to prevent.
 *
 * The default entry is the one exception, because it *is* what the bare engine serves.
 * Flash stays the guaranteed tier beneath any other pick.
 */
function buildChoiceEngine(choice: ModelChoice): ReasoningEngine {
  if (choice.id === DEFAULT_MODEL_ID) return new ResilientEngine(new OpenAICompatibleEngine());
  const primary = new OpenAICompatibleEngine({
    name: `llm:deepseek:${choice.model}`,
    baseUrl: config.llmBaseUrl,
    apiKey: config.deepseekKey,
    model: choice.model,
  });
  return new ResilientEngine(primary, new ResilientEngine(new OpenAICompatibleEngine()));
}

export function getReasoningEngine(modelId?: string): ReasoningEngine {
  const choice = resolveModelChoice(modelId);
  return choice ? buildChoiceEngine(choice) : buildDefaultEngine();
}

export type { ReasoningEngine } from "./reasoning-engine";
export * from "./reasoning-engine";
export { MODEL_CATALOG, DEFAULT_MODEL_ID, findModelChoice, type ModelChoice } from "./model-catalog";

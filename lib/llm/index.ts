/**
 * Reasoning engine selector. Default chain: Anthropic > DeepSeek (OpenAI-compatible) >
 * deterministic heuristic (offline, no API key — dev only, never the demo path).
 *
 * Model picker: pass a catalog model id to run that model instead. Ollama-served picks
 * wrap with fallback = DeepSeek (itself falling back to the heuristic), so whichever
 * model the asker chooses, the run ALWAYS answers.
 */

import { config, llmProvider } from "../config";
import { AnthropicEngine } from "./anthropic-engine";
import { HeuristicEngine } from "./heuristic-engine";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { ResilientEngine } from "./resilient-engine";
import { findModelChoice, MODEL_CATALOG, type ModelChoice } from "./model-catalog";
import type { ReasoningEngine } from "./reasoning-engine";

// Deliberately NOT cached across runs. A ResilientEngine tallies, per instance, which tier actually
// answered each reasoning step (see its `effectiveName`) so a run is labelled by what served it
// rather than by what it hoped to use. One shared instance would blend concurrent askers' runs into
// a single tally. Construction is a few field assignments over the global fetch — nothing to pool.

/** Catalog entries usable with the currently configured credentials. */
export function availableModels(): ModelChoice[] {
  return MODEL_CATALOG.filter((m) =>
    m.provider === "deepseek" ? config.deepseekKey.length > 0 : config.ollamaKey.length > 0,
  );
}

/**
 * Resolve a caller-supplied model id to a usable catalog entry. Accepts the bare id or
 * the `keryx:`-prefixed form. Unknown ids, or picks whose provider key is not configured,
 * resolve to null — the caller then runs the default engine (never an error to the asker).
 */
export function resolveModelChoice(id?: string | null): ModelChoice | null {
  const m = findModelChoice(id);
  if (!m) return null;
  const usable =
    m.provider === "deepseek" ? config.deepseekKey.length > 0 : config.ollamaKey.length > 0;
  return usable ? m : null;
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

/** A catalog pick. Ollama models get DeepSeek as their (resilient) fallback tier. */
function buildChoiceEngine(choice: ModelChoice): ReasoningEngine {
  if (choice.provider === "deepseek") return new ResilientEngine(new OpenAICompatibleEngine());
  const primary = new OpenAICompatibleEngine({
    name: `llm:ollama:${choice.model}`,
    baseUrl: config.ollamaBaseUrl,
    apiKey: config.ollamaKey,
    model: choice.model,
  });
  const fallback =
    config.deepseekKey.length > 0 ? new ResilientEngine(new OpenAICompatibleEngine()) : undefined;
  return new ResilientEngine(primary, fallback);
}

export function getReasoningEngine(modelId?: string): ReasoningEngine {
  const choice = resolveModelChoice(modelId);
  return choice ? buildChoiceEngine(choice) : buildDefaultEngine();
}

export type { ReasoningEngine } from "./reasoning-engine";
export * from "./reasoning-engine";
export { MODEL_CATALOG, DEFAULT_MODEL_ID, findModelChoice, type ModelChoice } from "./model-catalog";

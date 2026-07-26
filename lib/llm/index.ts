/**
 * Reasoning engine selector. Default chain: Anthropic > DeepSeek (OpenAI-compatible) >
 * deterministic heuristic (offline, no API key — dev only, never the demo path).
 *
 * Model picker: pass a catalog model id to run that model instead. A non-default pick wraps
 * with fallback = Flash (itself falling back to the heuristic), so whichever model the asker
 * chooses, the run ALWAYS answers.
 */

import { llmProvider } from "../config";
import { AnthropicEngine } from "./anthropic-engine";
import { HeuristicEngine } from "./heuristic-engine";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { ResilientEngine } from "./resilient-engine";
import { DEFAULT_MODEL_ID, findModelChoice, MODEL_CATALOG, type ModelChoice } from "./model-catalog";
import { endpointFor } from "./provider-endpoints";
import type { ReasoningEngine } from "./reasoning-engine";

// Deliberately NOT cached across runs. A ResilientEngine tallies, per instance, which tier actually
// answered each reasoning step (see its `effectiveName`) so a run is labelled by what served it
// rather than by what it hoped to use. One shared instance would blend concurrent askers' runs into
// a single tally. Construction is a few field assignments over the global fetch — nothing to pool.

/** Catalog entries usable with the currently configured credentials — per provider, not in bulk:
 *  a box holding one provider's key must offer that provider's models and no others. */
export function availableModels(): ModelChoice[] {
  return MODEL_CATALOG.filter((m) => endpointFor(m.provider) !== null);
}

/**
 * Resolve a caller-supplied model id to a usable catalog entry. Accepts the bare id or
 * the `keryx:`-prefixed form. Unknown ids, or picks whose provider key is not configured,
 * resolve to null — the caller then runs the default engine (never an error to the asker).
 */
export function resolveModelChoice(id?: string | null): ModelChoice | null {
  const m = findModelChoice(id);
  if (!m) return null;
  return endpointFor(m.provider) ? m : null;
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
  const endpoint = endpointFor(choice.provider);
  // Unreachable through resolveModelChoice, which filters these out; belt and braces for a direct
  // caller, and it degrades the way everything else here does rather than throwing at an asker.
  if (!endpoint) return buildDefaultEngine();

  const primary = new OpenAICompatibleEngine({
    name: `llm:${choice.provider}:${choice.model}`,
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    model: choice.model,
  });
  // Falls back to whatever this box's default chain is, not to DeepSeek by name: a box credentialed
  // for one provider only would otherwise fall back to a key it does not have.
  return new ResilientEngine(primary, buildDefaultEngine());
}

export function getReasoningEngine(modelId?: string): ReasoningEngine {
  const choice = resolveModelChoice(modelId);
  return choice ? buildChoiceEngine(choice) : buildDefaultEngine();
}

export type { ReasoningEngine } from "./reasoning-engine";
export * from "./reasoning-engine";
export { MODEL_CATALOG, DEFAULT_MODEL_ID, findModelChoice, type ModelChoice } from "./model-catalog";

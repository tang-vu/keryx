/**
 * Reasoning engine selector.
 *
 * The default chain contains every configured provider before the deterministic heuristic:
 * Anthropic -> DeepSeek Flash -> MiMo V2.5 -> enabled Cloudflare -> heuristic. A picked model leads,
 * then falls back through the other configured defaults. Engines are built per run because their
 * effective label and attempt telemetry are run-local; provider circuit state is shared separately.
 */

import { config, llmProviderOrder } from "../config";
import { AnthropicEngine } from "./anthropic-engine";
import { HeuristicEngine } from "./heuristic-engine";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { ResilientEngine } from "./resilient-engine";
import {
  durableReasoningCircuitStore,
  memoryReasoningCircuitStore,
} from "./reasoning-circuit-store";
import {
  DEFAULT_MODEL_ID,
  findModelChoice,
  MODEL_CATALOG,
  type ModelChoice,
} from "./model-catalog";
import { createModelEngine } from "./model-engine";
import { endpointFor, endpointForModel } from "./provider-endpoints";
import type { ReasoningEngine } from "./reasoning-engine";
import { BoundedProductionEngine, configuredProductionModelAllowance, ProductionModelAllowance } from "./bounded-production-engine";
import { BusinessCanaryEngine } from "../business-operator/canary-suppliers";
import { configuredBusinessCanary } from "../business-operator/canary-policy";

/** Catalog entries usable with credentials configured on this process. */
export function availableModels(): ModelChoice[] {
  if (configuredBusinessCanary() || configuredProductionModelAllowance()) {
    return process.env.DEEPSEEK_API_KEY?.trim() ? MODEL_CATALOG.filter(model => model.id === DEFAULT_MODEL_ID) : [];
  }
  return MODEL_CATALOG.filter((model) => endpointForModel(model) !== null);
}

/**
 * Resolve a public model id to a usable entry. Unknown or uncredentialed picks become null and the
 * caller uses the default chain instead of failing an ask.
 */
export function resolveModelChoice(id?: string | null): ModelChoice | null {
  const model = findModelChoice(id);
  if (!model) return null;
  return endpointForModel(model) ? model : null;
}

function defaultRealEngines(exclude = new Set<string>()): ReasoningEngine[] {
  const engines: ReasoningEngine[] = [];

  for (const provider of llmProviderOrder()) {
    let engine: ReasoningEngine | null = null;
    if (provider === "anthropic" && config.anthropicKey) {
      engine = new AnthropicEngine();
    } else if (provider === "deepseek" && endpointFor("deepseek")) {
      // The bare constructor preserves KERYX_LLM_MODEL / KERYX_SYNTHESIS_MODEL for this tier.
      engine = new OpenAICompatibleEngine();
    } else if (provider === "mimo") {
      engine = createModelEngine(findModelChoice("mimo-v2.5")!);
    } else if (provider === "cloudflare") {
      engine = createModelEngine(findModelChoice("cloudflare-llama-3.3")!);
    }
    if (engine && !exclude.has(engine.name)) engines.push(engine);
  }

  return engines;
}

function buildChain(realEngines: ReasoningEngine[]): ReasoningEngine {
  // Vitest engines must be hermetic; production/server/CLI chains share durable DB state.
  const circuitStore = process.env.VITEST
    ? memoryReasoningCircuitStore
    : durableReasoningCircuitStore;
  let fallback: ReasoningEngine = new HeuristicEngine();
  for (let tier = realEngines.length - 1; tier >= 0; tier--) {
    fallback = new ResilientEngine(
      realEngines[tier]!,
      fallback,
      tier,
      circuitStore,
    );
  }
  return fallback;
}

function buildDefaultEngine(): ReasoningEngine {
  const engines = defaultRealEngines();
  return engines.length > 0 ? buildChain(engines) : new HeuristicEngine();
}

function buildChoiceEngine(choice: ModelChoice): ReasoningEngine {
  if (choice.id === DEFAULT_MODEL_ID) return buildDefaultEngine();

  const primary = createModelEngine(choice);
  if (!primary) return buildDefaultEngine();
  return buildChain([primary, ...defaultRealEngines(new Set([primary.name]))]);
}

export function getReasoningEngine(modelId?: string): ReasoningEngine {
  if (configuredBusinessCanary()) {
    if (modelId && findModelChoice(modelId)?.id !== DEFAULT_MODEL_ID)
      throw new Error("Business canary permits only DeepSeek Flash; no provider fallback");
    return new BusinessCanaryEngine(process.env.DEEPSEEK_API_KEY ?? "");
  }
  const bounded = configuredProductionModelAllowance();
  if (bounded) {
    if (modelId && findModelChoice(modelId)?.id !== DEFAULT_MODEL_ID)
      throw new Error("Bounded model allowance permits only DeepSeek Flash; no provider fallback");
    return new BoundedProductionEngine(process.env.DEEPSEEK_API_KEY ?? "", new ProductionModelAllowance(bounded));
  }
  const choice = resolveModelChoice(modelId);
  return choice ? buildChoiceEngine(choice) : buildDefaultEngine();
}

export type { ReasoningEngine } from "./reasoning-engine";
export * from "./reasoning-engine";
export {
  MODEL_CATALOG,
  DEFAULT_MODEL_ID,
  findModelChoice,
  type ModelChoice,
} from "./model-catalog";

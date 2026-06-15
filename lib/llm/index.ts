/**
 * Reasoning engine selector. Anthropic > DeepSeek (OpenAI-compatible) > deterministic heuristic.
 * The heuristic engine runs offline with no API key (dev only — never the demo path).
 */

import { llmProvider } from "../config";
import { AnthropicEngine } from "./anthropic-engine";
import { HeuristicEngine } from "./heuristic-engine";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import type { ReasoningEngine } from "./reasoning-engine";

let cached: ReasoningEngine | null = null;

export function getReasoningEngine(): ReasoningEngine {
  if (cached) return cached;
  switch (llmProvider()) {
    case "anthropic":
      cached = new AnthropicEngine();
      break;
    case "deepseek":
      cached = new OpenAICompatibleEngine();
      break;
    default:
      cached = new HeuristicEngine();
  }
  return cached;
}

export type { ReasoningEngine } from "./reasoning-engine";
export * from "./reasoning-engine";

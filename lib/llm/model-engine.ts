import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { endpointForModel } from "./provider-endpoints";
import type { ModelChoice } from "./model-catalog";

/** Runtime picks and direct watchdog probes must send the same vendor transport policy. */
export function createModelEngine(choice: ModelChoice): OpenAICompatibleEngine | null {
  const endpoint = endpointForModel(choice);
  if (!endpoint) return null;
  return new OpenAICompatibleEngine({
    provider: choice.provider,
    name: `llm:${choice.provider}:${choice.model}`,
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    model: choice.model,
  });
}

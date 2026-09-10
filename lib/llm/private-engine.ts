import { z } from "zod";
import { MODEL_CATALOG } from "./model-catalog";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { HeuristicEngine } from "./heuristic-engine";
import { ResilientEngine } from "./resilient-engine";
import { MemoryReasoningCircuitStore } from "./reasoning-circuit-store";
import { privateReasoningPolicySchema } from "../buyer/private-reasoning-policy";

const policySchema = z.object({ modelId: z.string(), provider: z.enum(["deepseek", "mimo"]),
  baseUrl: z.string().url().max(2048), apiKey: z.string().min(1).max(4096).regex(/^[^\r\n]+$/) }).strict();

/** Backend-only construction from trusted explicit policy. No default credentials/provider chain.
 * The admission layer must bind the returned disclosure to buyer-approved terms before execution.
 */
export function privateReasoningEngine(input: z.infer<typeof policySchema>) {
  let policy: z.infer<typeof policySchema>;
  try { policy = policySchema.parse(input); }
  catch { throw new Error("Private reasoning policy unavailable"); }
  const choice = MODEL_CATALOG.find(model => model.id === policy.modelId && model.provider === policy.provider);
  if (!choice) throw new Error("Private reasoning model unavailable");
  const endpoint = new URL(policy.baseUrl);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("Private reasoning endpoint unavailable");
  const baseUrl = endpoint.href.replace(/\/+$/, "");
  const primary = new OpenAICompatibleEngine({ provider: choice.provider, name: `llm:${choice.provider}:${choice.model}`,
    model: choice.model, baseUrl, apiKey: policy.apiKey, redirect: "error" });
  return {
    engine: new ResilientEngine(primary, new HeuristicEngine(), 0, new MemoryReasoningCircuitStore()),
    disclosure: Object.freeze(privateReasoningPolicySchema.parse({ modelId: choice.id, provider: choice.provider, wireModel: choice.model,
      endpoint: `${baseUrl}/chat/completions`, fallback: "local-heuristic", redirects: "prohibited" })),
  };
}

/**
 * AnthropicEngine — real Claude reasoning via the shared JsonChatEngine prompts.
 */

import Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError, APIConnectionTimeoutError } from "@anthropic-ai/sdk/error";
import { config } from "../config";
import { extractJson, JsonChatEngine } from "./json-chat-engine";
import { ReasoningOutputLimitError, ReasoningTransportError } from "./reasoning-engine";
import { assertOrdinaryCanarySupplierAdmission } from "../business-operator/canary-policy";

export class AnthropicEngine extends JsonChatEngine {
  readonly name = `llm:anthropic:${config.llmModel}`;
  // Retries belong to ResilientEngine so each attempted request is accounted for.
  private client = new Anthropic({ apiKey: config.anthropicKey, maxRetries: 0 });

  protected async chatJson(
    model: string,
    system: string,
    user: string,
    maxTokens = 2048,
  ): Promise<Record<string, unknown>> {
    assertOrdinaryCanarySupplierAdmission();
    const deadline = AbortSignal.timeout(config.llmTimeoutMs);
    const msg = await this.client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      },
      { signal: deadline },
    ).catch((error: unknown) => {
      // The SDK maps an aborted supplied signal to APIUserAbortError; this signal is our deadline.
      if (deadline.aborted || error instanceof APIConnectionTimeoutError) throw new ReasoningTransportError("timeout");
      if (error instanceof APIConnectionError) throw new ReasoningTransportError("network");
      throw error;
    });
    const usage = msg.usage as typeof msg.usage & {
      cache_read_input_tokens?: number | null;
    };
    this.recordUsage({
      model,
      inputTokens: usage.input_tokens,
      cachedInputTokens: usage.cache_read_input_tokens ?? 0,
      outputTokens: usage.output_tokens,
    });
    // Same rule as the OpenAI-compatible transport: a reply stopped by the token ceiling is
    // truncated JSON, and half an object must fail rather than read as an answer.
    if (msg.stop_reason === "max_tokens") {
      throw new ReasoningOutputLimitError(maxTokens);
    }
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return extractJson(text);
  }
}

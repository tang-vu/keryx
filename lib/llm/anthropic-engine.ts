/**
 * AnthropicEngine — real Claude reasoning via the shared JsonChatEngine prompts.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { extractJson, JsonChatEngine } from "./json-chat-engine";

export class AnthropicEngine extends JsonChatEngine {
  readonly name = `llm:anthropic:${config.llmModel}`;
  private client = new Anthropic({ apiKey: config.anthropicKey });

  protected async chatJson(
    model: string,
    system: string,
    user: string,
    maxTokens = 2048,
  ): Promise<Record<string, unknown>> {
    const msg = await this.client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      },
      { signal: AbortSignal.timeout(config.llmTimeoutMs) },
    );
    const usage = msg.usage as typeof msg.usage & {
      cache_read_input_tokens?: number | null;
    };
    this.recordUsage({
      model,
      inputTokens: usage.input_tokens ?? 0,
      cachedInputTokens: usage.cache_read_input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
    });
    // Same rule as the OpenAI-compatible transport: a reply stopped by the token ceiling is
    // truncated JSON, and half an object must fail rather than read as an answer.
    if (msg.stop_reason === "max_tokens") {
      const err = new Error(
        `LLM reply hit the ${maxTokens}-token ceiling before closing its JSON`,
      ) as Error & { status?: number };
      err.status = 503;
      throw err;
    }
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return extractJson(text);
  }
}

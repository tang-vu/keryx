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
  ): Promise<Record<string, unknown>> {
    const msg = await this.client.messages.create({
      model,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return extractJson(text);
  }
}

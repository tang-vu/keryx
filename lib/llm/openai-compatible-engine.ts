/**
 * OpenAICompatibleEngine — DeepSeek (and any OpenAI-compatible chat API) via the shared prompts.
 * Uses the chat-completions endpoint with response_format json_object. No extra SDK dependency.
 */

import { config } from "../config";
import { extractJson, JsonChatEngine } from "./json-chat-engine";

export class OpenAICompatibleEngine extends JsonChatEngine {
  readonly name = `llm:deepseek:${config.llmModel}`;

  protected async chatJson(
    model: string,
    system: string,
    user: string,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.deepseekKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system + " Respond with a single JSON object." },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM ${res.status}: ${await res.text().catch(() => res.statusText)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return extractJson(data.choices?.[0]?.message?.content ?? "{}");
  }
}

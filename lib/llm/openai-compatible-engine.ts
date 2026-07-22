/**
 * OpenAICompatibleEngine — any OpenAI-compatible chat API via the shared prompts.
 * Uses the chat-completions endpoint with response_format json_object. No extra SDK dependency.
 *
 * Default construction targets DeepSeek (the workhorse + guaranteed fallback tier).
 * Pass opts to target another host/model — e.g. Ollama Cloud for the model picker.
 */

import { config } from "../config";
import { extractJson, JsonChatEngine } from "./json-chat-engine";

export interface OpenAICompatibleOpts {
  /** Engine name recorded on each run, e.g. "llm:ollama:glm-5.2". */
  name: string;
  baseUrl: string;
  apiKey: string;
  /** Fixed wire model. When set it overrides the per-call default (llmModel/synthesisModel). */
  model?: string;
}

export class OpenAICompatibleEngine extends JsonChatEngine {
  readonly name: string;
  private readonly opts: OpenAICompatibleOpts;

  constructor(opts?: OpenAICompatibleOpts) {
    super();
    this.opts = opts ?? {
      name: `llm:deepseek:${config.llmModel}`,
      baseUrl: config.llmBaseUrl,
      apiKey: config.deepseekKey,
    };
    this.name = this.opts.name;
  }

  protected async chatJson(
    model: string,
    system: string,
    user: string,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: this.opts.model ?? model,
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
      // Surface the HTTP status so the resilience layer can classify transient vs hard failures.
      const err = new Error(
        `LLM ${res.status}: ${await res.text().catch(() => res.statusText)}`,
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return extractJson(data.choices?.[0]?.message?.content ?? "{}");
  }
}

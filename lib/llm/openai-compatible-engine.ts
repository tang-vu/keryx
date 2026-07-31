/**
 * OpenAICompatibleEngine — any OpenAI-compatible chat API via the shared prompts.
 * Uses the chat-completions endpoint with response_format json_object. No extra SDK dependency.
 *
 * Default construction targets DeepSeek Flash, the primary workhorse.
 * Pass opts to pin another host/model — every non-default catalog pick does.
 */

import { config } from "../config";
import { extractJson, JsonChatEngine } from "./json-chat-engine";

export interface OpenAICompatibleOpts {
  /** Engine name recorded on each run, e.g. "llm:deepseek:deepseek-v4-pro". */
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
    maxTokens = 2048,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(config.llmTimeoutMs),
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
        max_tokens: maxTokens,
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
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const choice = data.choices?.[0];
    // A reply cut off at the token ceiling is truncated JSON, which parses to nothing — and
    // "nothing" reads downstream as a decision rather than a failure. Surface it with a retryable
    // status so the resilience layer treats it like any other provider hiccup: retry, then drop a
    // tier. This is exactly how a 20-source corpus against a flat 2048-token cap turned into runs
    // that bought nothing while their traces looked deliberate.
    if (choice?.finish_reason === "length") {
      const err = new Error(
        `LLM reply hit the ${maxTokens}-token ceiling before closing its JSON`,
      ) as Error & { status?: number };
      err.status = 503;
      throw err;
    }
    return extractJson(choice?.message?.content ?? "{}");
  }
}

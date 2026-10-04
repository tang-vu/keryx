/**
 * OpenAICompatibleEngine — any OpenAI-compatible chat API via the shared prompts.
 * Uses the chat-completions endpoint with response_format json_object. No extra SDK dependency.
 *
 * Default construction targets DeepSeek Flash, the primary workhorse.
 * Pass opts to pin another host/model — every non-default catalog pick does.
 */

import { config } from "../config";
import { extractJson, JsonChatEngine, type ChatJsonOptions } from "./json-chat-engine";
import { capturePricePolicy } from "../economics/provider-cost-policy";
import { ReasoningInputLimitError } from "./reasoning-engine";

export interface OpenAICompatibleOpts {
  /** Explicit provider identity; vendor options must not leak to generic compatible hosts. */
  provider?: "deepseek" | "mimo" | "cloudflare";
  /** Engine name recorded on each run, e.g. "llm:deepseek:deepseek-v4-pro". */
  name: string;
  baseUrl: string;
  apiKey: string;
  /** Fixed wire model. When set it overrides the per-call default (llmModel/synthesisModel). */
  model?: string;
  /** Private callers prohibit redirects that could forward prompt content elsewhere. */
  redirect?: "error";
}

function tokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export class OpenAICompatibleEngine extends JsonChatEngine {
  readonly name: string;
  private readonly opts: OpenAICompatibleOpts;

  protected supportsDecisionBrief(): boolean {
    const flash = (model: string) => /^(deepseek-v4-flash|deepseek-flash)$/.test(model);
    return this.opts.provider === "deepseek" && this.opts.baseUrl === "https://api.deepseek.com" &&
      (this.opts.model ? flash(this.opts.model) : flash(config.llmModel) && flash(config.synthesisModel));
  }

  constructor(opts?: OpenAICompatibleOpts) {
    super();
    this.opts = opts ? { ...opts } : {
      provider: "deepseek",
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
    options?: ChatJsonOptions,
  ): Promise<Record<string, unknown>> {
    const wireModel = this.opts.model ?? model;
    if (this.opts.provider === "cloudflare") {
      // Llama 3.3's context is 24k tokens. UTF-8 bytes conservatively bound byte-fallback
      // tokenization, with 1k tokens reserved for role/framing overhead. Refuse before HTTP;
      // no prompt truncation or partial-source reasoning. The chain can try another provider.
      if (maxTokens > 8192 || new TextEncoder().encode(system + " Respond with a single JSON object." + user).length + maxTokens > 23000) {
        throw new ReasoningInputLimitError("Cloudflare research exceeds the bounded context");
      }
    }
    const requestStartedAt = new Date().toISOString();
    const pricing = capturePricePolicy(this.opts.provider, wireModel);
    const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: "POST",
      ...(this.opts.redirect || this.opts.provider === "cloudflare" ? { redirect: this.opts.redirect ?? "error" } : {}),
      signal: AbortSignal.timeout(config.llmTimeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: wireModel,
        // V4 defaults to thinking, which can consume a bounded JSON step's entire output
        // allowance before producing content. Keep the existing token cap and failover.
        ...(this.opts.provider === "deepseek" && /^(deepseek-v4-(flash|pro)|deepseek-flash)$/.test(wireModel)
          ? { thinking: { type: options?.reasoningReview ? "enabled" : "disabled" },
            ...(options?.reasoningReview ? { reasoning_effort: "low" } : {}) }
          : {}),
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
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        prompt_cache_hit_tokens?: number;
        prompt_cache_miss_tokens?: number;
      };
    };
    const inputTokens = data.usage?.prompt_tokens;
    const outputTokens = data.usage?.completion_tokens;
    const responseReceivedAt = new Date().toISOString();
    const reportedCached = data.usage?.prompt_tokens_details?.cached_tokens;
    const hit = this.opts.provider === "deepseek" ? data.usage?.prompt_cache_hit_tokens : undefined;
    const miss = this.opts.provider === "deepseek" ? data.usage?.prompt_cache_miss_tokens : undefined;
    const supplied = [reportedCached, hit, miss].filter(value => value !== undefined);
    let cachedInputTokens: number | null = null;
    if (tokenCount(inputTokens) && supplied.length > 0 && supplied.every(value => tokenCount(value) && value <= inputTokens)) {
      const candidates = [reportedCached, hit, miss === undefined ? undefined : inputTokens - miss]
        .filter((value): value is number => value !== undefined);
      if (candidates.every(value => value === candidates[0])) cachedInputTokens = candidates[0];
    }
    // Missing/malformed counters are unknown cost, not measured zero-token work.
    // Keep the answer usable; economics detects the model call without a usage record.
    if (tokenCount(inputTokens) && tokenCount(outputTokens)) {
      this.recordUsage({
        model: wireModel,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        costCapture: { provider: this.opts.provider ?? "unknown", requestStartedAt, responseReceivedAt, pricing },
      });
    }
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

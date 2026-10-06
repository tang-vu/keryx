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
import { ReasoningInputLimitError, ReasoningOutputValidationError, ReasoningTransportError } from "./reasoning-engine";
import { assertOrdinaryCanarySupplierAdmission } from "../business-operator/canary-policy";

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

function transportFailure(error: unknown): ReasoningTransportError {
  const name = (error as { name?: string })?.name;
  return new ReasoningTransportError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
}

export class OpenAICompatibleEngine extends JsonChatEngine {
  readonly name: string;
  private readonly opts: OpenAICompatibleOpts;

  protected assertSupplierAdmission(): void { assertOrdinaryCanarySupplierAdmission(); }

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

  protected validateChatJsonInput(_model: string, system: string, user: string, maxTokens = 2048): void {
    if (this.opts.provider !== "cloudflare") return;
    const promptUtf8Bytes = new TextEncoder().encode(system + " Respond with a single JSON object." + user).length;
    if (maxTokens > 8192 || promptUtf8Bytes + maxTokens > 23000) {
      // Keep every target and candidate; an ineligible tier cannot acquire source/payment authority.
      throw new ReasoningInputLimitError("Cloudflare research exceeds the bounded context", {
        promptUtf8Bytes, requestedOutputTokens: maxTokens, maximumCombinedUnits: 23000,
      });
    }
  }

  protected async chatJson(
    model: string,
    system: string,
    user: string,
    maxTokens = 2048,
    options?: ChatJsonOptions,
  ): Promise<Record<string, unknown>> {
    const wireModel = this.opts.model ?? model;
    // Also enforce this bound for operational direct-transport callers outside the ledger wrapper.
    this.validateChatJsonInput(model, system, user, maxTokens);
    this.assertSupplierAdmission();
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
    }).catch((error: unknown) => { throw transportFailure(error); });
    if (!res.ok) {
      // Surface the HTTP status so the resilience layer can classify transient vs hard failures.
      const err = new Error(
        `LLM ${res.status}: ${await res.text().catch(() => res.statusText)}`,
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const body: unknown = await res.json().catch((error: unknown) => {
      if (error instanceof SyntaxError) throw new ReasoningOutputValidationError("Provider response is not valid JSON");
      throw transportFailure(error);
    });
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ReasoningOutputValidationError("Provider response is not a JSON object");
    const data = body as {
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
    // "nothing" reads downstream as a decision rather than a failure. Keep usage and the historic
    // status, but classify it as request-local output validation and drop a tier without retrying
    // identical caps or poisoning a shared circuit. A 20-source corpus with a flat cap caused runs
    // that bought nothing while their traces looked deliberate.
    if (choice?.finish_reason === "length") {
      const err = new ReasoningOutputValidationError(
        `LLM reply hit the ${maxTokens}-token ceiling before closing its JSON`,
      ) as Error & { status?: number };
      err.status = 503;
      throw err;
    }
    const content = choice?.message?.content;
    if (content !== undefined && typeof content !== "string") throw new ReasoningOutputValidationError("Model completion is not text");
    return extractJson(content ?? "{}");
  }
}

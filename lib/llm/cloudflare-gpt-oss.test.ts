import { afterEach, expect, it, vi } from "vitest";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { ReasoningOutputValidationError } from "./reasoning-engine";
import { findModelChoice } from "./model-catalog";
import { capturePricePolicy, CLOUDFLARE_GPT_OSS_POLICY, usageCostBounds } from "../economics/provider-cost-policy";

const model = "@cf/openai/gpt-oss-120b";
class Transport extends OpenAICompatibleEngine {
  request(text = "Synthetic question", tokens = 2048) { return this.chatJson(model, "Return JSON", text, tokens); }
}
const transport = (wireModel = model) => new Transport({ provider: "cloudflare", name: `llm:cloudflare:${wireModel}`,
  model: wireModel, apiKey: "synthetic", baseUrl: "https://api.cloudflare.com/client/v4/accounts/" + "a".repeat(32) + "/ai/v1" });

function configured(flag = "true") {
  vi.resetModules();
  vi.stubEnv("KERYX_CLOUDFLARE_ENABLED", "true");
  vi.stubEnv("KERYX_CLOUDFLARE_GPT_OSS_ENABLED", flag);
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32)); vi.stubEnv("CLOUDFLARE_API_TOKEN", "synthetic");
  vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("DEEPSEEK_API_KEY", "synthetic");
  vi.stubEnv("MIMO_API_KEY", ""); vi.stubEnv("KERYX_LLM_MODEL", "deepseek-v4-flash");
  vi.stubEnv("KERYX_LLM_PROVIDER_ORDER", "deepseek,cloudflare");
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

it.each(["", "false", "TRUE"])("keeps GPT-OSS unavailable without its exact manual opt-in (%s)", async flag => {
  configured(flag);
  const { availableModels, resolveModelChoice } = await import("./index");
  const { createModelEngine } = await import("./model-engine");
  expect(availableModels().map(choice => choice.id)).toContain("cloudflare-llama-3.3");
  expect(availableModels().map(choice => choice.id)).not.toContain("cloudflare-gpt-oss-120b");
  expect(resolveModelChoice("keryx:cloudflare-gpt-oss-120b")).toBeNull();
  expect(createModelEngine(findModelChoice("cloudflare-gpt-oss-120b")!)).toBeNull();
});

it("lists the explicit experimental choice consistently on public and OpenAI model APIs", async () => {
  configured();
  const { resolveModelChoice } = await import("./index");
  expect(resolveModelChoice("keryx:cloudflare-gpt-oss-120b")).toMatchObject({ model, manualOnly: true });
  expect(findModelChoice("gpt-oss-120b")?.id).toBe("deepseek-flash");
  const publicResponse = await (await import("../../app/api/models/route")).GET().json();
  expect(publicResponse.default).toBe("deepseek-flash");
  expect(publicResponse.models.find((choice: { id: string }) => choice.id === "cloudflare-gpt-oss-120b").label).toContain("experimental");
  const openaiResponse = await (await import("../../app/api/v1/models/route")).GET().json();
  expect(openaiResponse.data.map((choice: { id: string }) => choice.id)).toContain("keryx:cloudflare-gpt-oss-120b");
});

it("selects GPT-OSS directly with bounded reasoning and visible fallback to the existing default", async () => {
  configured();
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string);
    if (url.startsWith("https://api.cloudflare.com")) {
      expect(request).toMatchObject({ model, reasoning_effort: "low", response_format: { type: "json_object" }, max_tokens: 2048 });
      expect(init.redirect).toBe("error");
      return new Response("unavailable", { status: 503 });
    }
    return Response.json({ choices: [{ message: { content: '{"claims":["What is the synthetic fact?"]}' }, finish_reason: "stop" }] });
  });
  vi.stubGlobal("fetch", fetch);
  const { getReasoningEngine } = await import("./index");
  const { reasoningAttempts, effectiveEngineName } = await import("./resilient-engine");
  const engine = getReasoningEngine("cloudflare-gpt-oss-120b");
  expect(await engine.decompose("Synthetic question")).toEqual(["What is the synthetic fact?"]);
  expect(reasoningAttempts(engine)[0]).toMatchObject({ engine: `llm:cloudflare:${model}`, outcome: "failed", status: 503 });
  expect(effectiveEngineName(engine)).toContain("fallback from llm:cloudflare:" + model);
});

it("keeps GPT-OSS outside the automatic chain even when the new choice is enabled", async () => {
  configured();
  const requested: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    requested.push(JSON.parse(init.body as string).model);
    if (url.startsWith("https://api.deepseek.com")) return new Response("unavailable", { status: 503 });
    return Response.json({ choices: [{ message: { content: '{"claims":["What is the synthetic fact?"]}' } }] });
  }));
  const engine = (await import("./index")).getReasoningEngine();
  await engine.decompose("Synthetic question");
  expect(requested).toEqual(["deepseek-v4-flash", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"]);
});

it("uses model-specific context bounds without cutting multilingual input or expanding output ceilings", async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    expect(JSON.parse(init.body as string).messages[1].content).toBe("đ".repeat(20_000));
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  });
  vi.stubGlobal("fetch", fetch);
  await expect(transport().request("đ".repeat(20_000))).resolves.toEqual({ ok: true });
  await expect(transport("@cf/meta/llama-3.3-70b-instruct-fp8-fast").request("đ".repeat(20_000)))
    .rejects.toMatchObject({ bounds: { maximumCombinedUnits: 23_000 } });
  await expect(transport().request("đ".repeat(60_000))).rejects.toMatchObject({ status: 413 });
  await expect(transport().request("small", 8193)).rejects.toMatchObject({ status: 413 });
  await expect(transport("@cf/unreviewed/model").request()).rejects.toThrow("model policy unavailable");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("retains usage for truncated JSON and rejects its output without another supplier call", async () => {
  const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: '{"ok":' }, finish_reason: "length" }],
    usage: { prompt_tokens: 100, completion_tokens: 2048 } }));
  vi.stubGlobal("fetch", fetch);
  const engine = transport();
  await expect(engine.request()).rejects.toBeInstanceOf(ReasoningOutputValidationError);
  expect(engine.usage).toHaveLength(1); expect(fetch).toHaveBeenCalledTimes(1);
  expect(engine.usage[0].costCapture?.pricing).toMatchObject({ id: CLOUDFLARE_GPT_OSS_POLICY.id, wireModel: model });
});

it("estimates the new gross tariff without rewriting Llama history or fabricating billing", () => {
  const pricing = capturePricePolicy("cloudflare", model)!;
  expect(pricing).toMatchObject({ observedAt: "2026-10-08", lowerRates: { inputUsdPerMillion: 0.35, outputUsdPerMillion: 0.75 } });
  expect(capturePricePolicy("cloudflare", "@cf/meta/llama-3.3-70b-instruct-fp8-fast")?.observedAt).toBe("2026-10-02");
  const record = { engine: `llm:cloudflare:${model}`, model, inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: null,
    costCapture: { provider: "cloudflare", requestStartedAt: "2026-10-08T12:00:00Z", responseReceivedAt: "2026-10-08T12:00:01Z", pricing } };
  expect(usageCostBounds(record)).toEqual({ lower: 1.1, upper: 1.1 });
  Object.assign(pricing.upperRates, { outputUsdPerMillion: 0 });
  expect(usageCostBounds(record)).toBeNull();
});

it("does not admit the Cloudflare choice into buyer-approved private reasoning", async () => {
  const { privateReasoningEngine } = await import("./private-engine");
  expect(() => privateReasoningEngine({ provider: "cloudflare", modelId: "cloudflare-gpt-oss-120b", apiKey: "synthetic",
    baseUrl: "https://api.cloudflare.com" } as never)).toThrow("Private reasoning policy unavailable");
});

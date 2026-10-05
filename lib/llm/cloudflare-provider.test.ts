import { afterEach, expect, it, vi } from "vitest";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { privateReasoningEngine } from "./private-engine";
import { capturePricePolicy, usageCostBounds } from "../economics/provider-cost-policy";
import { MemoryReasoningCircuitStore } from "./reasoning-circuit-store";
import { ResilientEngine } from "./resilient-engine";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
const model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
class Transport extends OpenAICompatibleEngine {
  request(text = "fixture", tokens = 1024) { return this.chatJson(model, "Return JSON", text, tokens); }
}
const engine = () => new Transport({ provider: "cloudflare", name: `llm:cloudflare:${model}`, model,
  baseUrl: "https://api.cloudflare.com/client/v4/accounts/" + "a".repeat(32) + "/ai/v1", apiKey: "synthetic" });

it.each(["", "false", "TRUE"])("requires an exact explicit enable flag (%s)", async flag => {
  vi.stubEnv("KERYX_CLOUDFLARE_ENABLED", flag); vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32)); vi.stubEnv("CLOUDFLARE_API_TOKEN", "synthetic");
  const { endpointFor } = await import("./provider-endpoints");
  const { availableModels } = await import("./index");
  expect(endpointFor("cloudflare")).toBeNull();
  expect(availableModels().some(value => value.provider === "cloudflare")).toBe(false);
});

it.each(["", "../other", "a".repeat(31), "a".repeat(32) + "?x=1"])("rejects an invalid account id before transport: %s", async account => {
  vi.stubEnv("KERYX_CLOUDFLARE_ENABLED", "true"); vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", account); vi.stubEnv("CLOUDFLARE_API_TOKEN", "synthetic");
  expect((await import("./provider-endpoints")).endpointFor("cloudflare")).toBeNull();
});

it("adds an explicitly enabled configured provider after the existing default tiers", async () => {
  vi.stubEnv("KERYX_CLOUDFLARE_ENABLED", "true"); vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32)); vi.stubEnv("CLOUDFLARE_API_TOKEN", "synthetic");
  vi.stubEnv("KERYX_LLM_PROVIDER_ORDER", "");
  const { endpointFor } = await import("./provider-endpoints");
  expect(endpointFor("cloudflare")).toEqual({ baseUrl: "https://api.cloudflare.com/client/v4/accounts/" + "a".repeat(32) + "/ai/v1", apiKey: "synthetic" });
  const { llmProviderOrder } = await import("../config");
  expect(llmProviderOrder()).toEqual(["anthropic", "deepseek", "mimo", "cloudflare"]);
});

it.each([false, true])("uses Cloudflare only after the existing providers fail (healthy primary: %s)", async healthy => {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("DEEPSEEK_API_KEY", "synthetic"); vi.stubEnv("OPENAI_API_KEY", ""); vi.stubEnv("MIMO_API_KEY", "synthetic");
  vi.stubEnv("KERYX_CLOUDFLARE_ENABLED", "true"); vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32)); vi.stubEnv("CLOUDFLARE_API_TOKEN", "synthetic");
  vi.stubEnv("KERYX_LLM_PROVIDER_ORDER", "deepseek,mimo,cloudflare");
  const fetch = vi.fn(async (url: string) => {
    if (url.startsWith("https://api.cloudflare.com") || healthy && url.startsWith("https://api.deepseek.com")) {
      return Response.json({ choices: [{ message: { content: '{"claims":["What is the fixture fact?"]}' } }] });
    }
    return new Response("unavailable", { status: 503 });
  });
  vi.stubGlobal("fetch", fetch);
  const { getReasoningEngine } = await import("./index");
  const { reasoningAttempts, effectiveEngineName } = await import("./resilient-engine");
  const chain = getReasoningEngine();
  expect(chain.name).toBe("llm:deepseek:deepseek-v4-flash");
  expect(await chain.decompose("fixture question")).toEqual(["What is the fixture fact?"]);
  expect(fetch.mock.calls.filter(([url]) => url.startsWith("https://api.cloudflare.com"))).toHaveLength(healthy ? 0 : 1);
  expect(reasoningAttempts(chain)).toHaveLength(healthy ? 1 : 3);
  expect(effectiveEngineName(chain)).toContain(healthy ? "llm:deepseek:" : "llm:cloudflare:");
  if (!healthy) expect(reasoningAttempts(chain)[2]).toMatchObject({ engine: `llm:cloudflare:${model}`, tier: 2, outcome: "served" });
});

it("refuses an oversized multilingual prompt or excessive output without making an HTTP call", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(engine().request("đ".repeat(12000))).rejects.toMatchObject({ status: 413 });
  await expect(engine().request("small", 8193)).rejects.toMatchObject({ status: 413 });
  expect(fetch).not.toHaveBeenCalled();
});

it("does not open a healthy provider circuit after a local large-input refusal", async () => {
  vi.resetModules();
  vi.stubEnv("KERYX_CLOUDFLARE_ENABLED", "true"); vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32)); vi.stubEnv("CLOUDFLARE_API_TOKEN", "synthetic");
  vi.stubEnv("KERYX_LLM_PROVIDER_ORDER", "cloudflare");
  const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: '{"claims":["Small fixture question?"]}' } }] })); vi.stubGlobal("fetch", fetch);
  const { getReasoningEngine } = await import("./index");
  await getReasoningEngine().decompose("đ".repeat(12000));
  expect(fetch).not.toHaveBeenCalled();
  expect(await getReasoningEngine().decompose("small fixture")).toEqual(["Small fixture question?"]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("retains prior failure state and the bounded half-open lease after local refusal", async () => {
  const store = new MemoryReasoningCircuitStore();
  const transport = engine(); const key = JSON.stringify([transport.name, "decompose"]);
  await store.failed(key, { transient: true, now: 0, failureThreshold: 1, baseCooldownMs: 1000, maxCooldownMs: 10000 });
  vi.spyOn(Date, "now").mockReturnValue(1001);
  const success = vi.spyOn(store, "succeeded"); const failed = vi.spyOn(store, "failed");
  vi.stubGlobal("fetch", vi.fn());
  await new ResilientEngine(transport, undefined, 0, store).decompose("đ".repeat(12000));
  expect(success).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  expect((await store.acquire(key, 1002, 1000)).allowed).toBe(false);
  expect((await store.failed(key, { transient: true, now: 1002, failureThreshold: 1, baseCooldownMs: 1000, maxCooldownMs: 10000 })).failures).toBe(2);
});

it("retains an upstream HTTP 413 as a request failure without poisoning the provider circuit", async () => {
  const store = new MemoryReasoningCircuitStore(); const failed = vi.spyOn(store, "failed");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream rejection", { status: 413 })));
  await new ResilientEngine(engine(), undefined, 0, store).decompose("small fixture");
  expect(failed).not.toHaveBeenCalled();
});

it("sends bounded JSON without vendor thinking options, prohibits redirects, and records gross tariff usage", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 100, completion_tokens: 50 } })));
  vi.stubGlobal("fetch", fetch);
  const transport = engine(); expect(await transport.request()).toEqual({ ok: true });
  const [url, request] = fetch.mock.calls[0];
  expect(url).toContain("/ai/v1/chat/completions"); expect(request.redirect).toBe("error");
  expect(JSON.parse(request.body)).toMatchObject({ model, max_tokens: 1024, response_format: { type: "json_object" } });
  expect(JSON.parse(request.body)).not.toHaveProperty("thinking");
  expect(transport.usage[0].costCapture?.provider).toBe("cloudflare");
  expect(transport.usage[0].cachedInputTokens).toBeNull();
  expect(usageCostBounds(transport.usage[0])).toEqual({ lower: expect.closeTo(0.00014195, 12), upper: expect.closeTo(0.00014195, 12) });
});

it("surfaces truncated JSON and quota exhaustion rather than fabricated valid decisions", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{', }, finish_reason: "length" }], usage: { prompt_tokens: 1, completion_tokens: 1024 } })))
    .mockResolvedValueOnce(new Response("quota exhausted", { status: 429 })));
  const transport = engine();
  await expect(transport.request()).rejects.toMatchObject({ status: 503 });
  expect(transport.usage).toHaveLength(1);
  await expect(transport.request()).rejects.toMatchObject({ status: 429 });
});

it("keeps the new processor outside the private buyer-approved provider policy", () => {
  expect(() => privateReasoningEngine({ provider: "cloudflare", modelId: "cloudflare-llama-3.3", apiKey: "synthetic", baseUrl: "https://api.cloudflare.com" } as never)).toThrow("Private reasoning policy unavailable");
});

it("records quota failure and visibly degrades to the existing heuristic after bounded retries", async () => {
  vi.resetModules();
  vi.stubEnv("KERYX_CLOUDFLARE_ENABLED", "true"); vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32)); vi.stubEnv("CLOUDFLARE_API_TOKEN", "synthetic");
  vi.stubEnv("KERYX_LLM_PROVIDER_ORDER", "cloudflare");
  const fetch = vi.fn(async () => new Response("quota exhausted", { status: 429 })); vi.stubGlobal("fetch", fetch);
  const { getReasoningEngine } = await import("./index");
  const { effectiveEngineName, reasoningAttempts } = await import("./resilient-engine");
  const chain = getReasoningEngine();
  expect(await chain.decompose("What does Cedar charge?")).not.toHaveLength(0);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(reasoningAttempts(chain).filter(attempt => attempt.engine.startsWith("llm:cloudflare:")).every(attempt => attempt.outcome === "failed" && attempt.status === 429)).toBe(true);
  expect(effectiveEngineName(chain)).toContain("heuristic");
});

it("rejects tariff identity and rate tampering without altering historical DeepSeek policy", () => {
  const policy = capturePricePolicy("cloudflare", model)!;
  const usage = { engine: `llm:cloudflare:${model}`, model, inputTokens: 100, outputTokens: 50, cachedInputTokens: null,
    costCapture: { provider: "cloudflare", requestStartedAt: "2026-10-02T08:00:00Z", responseReceivedAt: "2026-10-02T08:00:01Z", pricing: policy } };
  expect(usageCostBounds({ ...usage, costCapture: { ...usage.costCapture, provider: "deepseek" } })).toBeNull();
  Object.assign(policy.upperRates, { outputUsdPerMillion: 0 });
  expect(usageCostBounds(usage)).toBeNull();
});

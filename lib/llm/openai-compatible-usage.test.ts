import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { FLASH_POLICY, usageCostBounds } from "../economics/provider-cost-policy";

describe("OpenAI-compatible usage telemetry", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("captures provider counters without retaining prompts or completions", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"claims":["one"]}' }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 30,
            prompt_tokens_details: { cached_tokens: 20 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const engine = new OpenAICompatibleEngine({
      name: "llm:deepseek:deepseek-v4-flash",
      baseUrl: "https://example.test",
      apiKey: "test-only",
      model: "deepseek-v4-flash",
    });

    await expect(engine.decompose("private question")).resolves.toEqual(["one"]);
    expect(engine.usage).toEqual([
      expect.objectContaining({
        callId: engine.calls[0].id,
        engine: "llm:deepseek:deepseek-v4-flash",
        model: "deepseek-v4-flash",
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 30,
      }),
    ]);
    expect(JSON.stringify(engine.usage)).not.toContain("private question");
    expect(JSON.stringify(engine.usage)).not.toContain("claims");
  });

  it.each([
    { name: "nested cache", split: { prompt_tokens_details: { cached_tokens: 20 } }, expected: 20 },
    { name: "top-level cache", split: { prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 100 }, expected: 20 },
    { name: "all consistent", split: { prompt_tokens_details: { cached_tokens: 20 }, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 100 }, expected: 20 },
    { name: "miss-only", split: { prompt_cache_miss_tokens: 100 }, expected: 20 },
    { name: "absent split", split: {}, expected: null },
    { name: "conflicting nested/hit", split: { prompt_tokens_details: { cached_tokens: 20 }, prompt_cache_hit_tokens: 30 }, expected: null },
    { name: "conflicting hit/miss", split: { prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 99 }, expected: null },
    { name: "negative", split: { prompt_cache_hit_tokens: -1 }, expected: null },
    { name: "excess", split: { prompt_cache_hit_tokens: 121 }, expected: null },
    { name: "malformed", split: { prompt_tokens_details: { cached_tokens: "20" } }, expected: null },
    { name: "null", split: { prompt_cache_hit_tokens: null }, expected: null },
    { name: "explicit zero", split: { prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 120 }, expected: 0 },
  ])("keeps the valid answer while accounting for $name", async ({ split, expected }) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-30T01:00:00Z"));
    const http = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
      expect(JSON.parse(options!.body as string).model).toBe("deepseek-v4-flash");
      vi.setSystemTime(new Date("2026-09-30T01:00:02Z"));
      return Response.json({ choices: [{ message: { content: '{"claims":["one"]}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 30, ...split } });
    });
    const engine = new OpenAICompatibleEngine({ provider: "deepseek", name: "llm:deepseek:deepseek-v4-flash",
      model: "deepseek-v4-flash", baseUrl: "https://synthetic.example", apiKey: "synthetic-no-authority" });
    expect(await engine.decompose("Synthetic private question")).toEqual(["one"]);
    expect(http).toHaveBeenCalledOnce();
    expect(engine.calls[0].outcome).toBe("returned");
    expect(engine.usage[0]).toMatchObject({ callId: engine.calls[0].id, inputTokens: 120,
      outputTokens: 30, cachedInputTokens: expected, costCapture: { provider: "deepseek",
        requestStartedAt: "2026-09-30T01:00:00.000Z", responseReceivedAt: "2026-09-30T01:00:02.000Z",
        pricing: { id: FLASH_POLICY.id, wireModel: "deepseek-v4-flash" } } });
    expect(usageCostBounds(engine.usage[0]) === null).toBe(expected === null);
    const serialized = JSON.stringify(engine.usage);
    expect(serialized).not.toContain("Synthetic private question");
    expect(serialized).not.toContain("synthetic-no-authority");
    expect(serialized).not.toContain("synthetic.example");
    const copy = engine.usage[0];
    Object.assign(copy.costCapture!.pricing!.upperRates, { outputUsdPerMillion: 99 });
    expect(engine.usage[0].costCapture!.pricing!.upperRates.outputUsdPerMillion).toBe(1.2);
  });

  it("does not infer supplier identity from the engine name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: '{"claims":["one"]}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 30 } }));
    const engine = new OpenAICompatibleEngine({ name: "llm:deepseek:deepseek-v4-flash",
      model: "deepseek-v4-flash", baseUrl: "https://synthetic.example", apiKey: "synthetic-no-authority" });
    expect(await engine.decompose("Synthetic question")).toEqual(["one"]);
    expect(engine.usage[0]).toMatchObject({ cachedInputTokens: null, costCapture: { provider: "unknown", pricing: null } });
    expect(usageCostBounds(engine.usage[0])).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";

describe("OpenAI-compatible usage telemetry", () => {
  afterEach(() => vi.restoreAllMocks());

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
      {
        engine: "llm:deepseek:deepseek-v4-flash",
        model: "deepseek-v4-flash",
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 30,
      },
    ]);
    expect(JSON.stringify(engine.usage)).not.toContain("private question");
    expect(JSON.stringify(engine.usage)).not.toContain("claims");
  });
});

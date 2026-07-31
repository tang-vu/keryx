/**
 * The production incident this protects against is a healthy secondary provider sitting unused
 * while a transient/default-provider failure drops a paid dispatch to deterministic reasoning.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("credential-aware provider chain", () => {
  it("serves a failed DeepSeek step from MiMo before the heuristic", async () => {
    vi.resetModules();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("MIMO_API_KEY", "mimo-key");

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://api.deepseek.com")) {
        return new Response("bad model", { status: 400 });
      }
      if (url.startsWith("https://api.xiaomimimo.com")) {
        return Response.json({
          choices: [{ message: { content: '{"claims":["served by MiMo"]}' } }],
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getReasoningEngine } = await import("./index");
    const { effectiveEngineName, reasoningAttempts } = await import("./resilient-engine");
    const engine = getReasoningEngine();

    await expect(engine.decompose("q")).resolves.toEqual(["served by MiMo"]);
    expect(effectiveEngineName(engine)).toBe(
      "llm:mimo:mimo-v2.5 (fallback from llm:deepseek:deepseek-v4-flash)",
    );
    expect(reasoningAttempts(engine)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          engine: "llm:deepseek:deepseek-v4-flash",
          tier: 0,
          outcome: "failed",
          status: 400,
        }),
        expect.objectContaining({
          engine: "llm:mimo:mimo-v2.5",
          tier: 1,
          outcome: "served",
        }),
      ]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses MiMo as the default real engine when it is the only configured provider", async () => {
    vi.resetModules();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("MIMO_API_KEY", "mimo-key");

    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: '{"claims":["MiMo only"]}' } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getReasoningEngine } = await import("./index");
    const { effectiveEngineName } = await import("./resilient-engine");
    const engine = getReasoningEngine();

    await expect(engine.decompose("q")).resolves.toEqual(["MiMo only"]);
    expect(effectiveEngineName(engine)).toBe("llm:mimo:mimo-v2.5");
  });
});

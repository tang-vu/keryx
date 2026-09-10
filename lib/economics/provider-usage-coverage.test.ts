import { afterEach, expect, it, vi } from "vitest";
import { privateReasoningEngine } from "../llm/private-engine";
import { effectiveEngineName, reasoningAttempts, reasoningUsage } from "../llm/resilient-engine";
import { calculateTestnetEconomics } from "./testnet-economics";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["rejected", "truncated"])("keeps %s provider work unpriced after real local fallback", async (failure) => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const http = vi.fn<typeof fetch>().mockImplementation(async () => failure === "rejected"
    ? new Response("Synthetic provider error", { status: 400 })
    : Response.json({ choices: [{ finish_reason: "length", message: { content: "{" } }],
      usage: { prompt_tokens: 100, completion_tokens: 2048 } }));
  vi.stubGlobal("fetch", http);
  const { engine } = privateReasoningEngine({
    modelId: "deepseek-flash", provider: "deepseek",
    baseUrl: "https://synthetic-provider.example/v1", apiKey: "synthetic-not-a-credential",
  });
  expect((await engine.decompose("How are synthetic research results stored?")).length).toBeGreaterThan(0);
  const attempts = reasoningAttempts(engine);
  expect(attempts).toEqual(expect.arrayContaining([
    expect.objectContaining({ outcome: "failed", tier: 0 }),
    expect.objectContaining({ outcome: "served", engine: "heuristic" }),
  ]));
  const usage = reasoningUsage(engine);
  expect(usage.length > 0).toBe(failure === "truncated");
  expect(calculateTestnetEconomics([{
    id: "synthetic-fallback-case", engine: effectiveEngineName(engine),
    reasoningAttempts: attempts, llmUsage: usage,
  }], [])).toMatchObject({ pricedRuns: 0, unpricedRuns: 1, shadowGrossMarginUsd: 0 });
});

it.each([
  { name: "missing usage", usage: undefined, priced: 0 },
  { name: "empty usage", usage: {}, priced: 0 },
  { name: "missing output", usage: { prompt_tokens: 100 }, priced: 0 },
  { name: "negative input", usage: { prompt_tokens: -1, completion_tokens: 10 }, priced: 0 },
  { name: "string input", usage: { prompt_tokens: "100", completion_tokens: 10 }, priced: 0 },
  { name: "fractional output", usage: { prompt_tokens: 100, completion_tokens: 0.5 }, priced: 0 },
  { name: "excess cached input", usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 101 } }, priced: 0 },
  { name: "complete counters", usage: { prompt_tokens: 100, completion_tokens: 10 }, priced: 1 },
  { name: "explicit zero counters", usage: { prompt_tokens: 0, completion_tokens: 0 }, priced: 1 },
])("keeps $name honest through the actual provider and resilient engine", async ({ usage, priced }) => {
  const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    choices: [{ message: { content: '{"claims":["Synthetic research target"]}' } }], usage,
  }));
  vi.stubGlobal("fetch", http);
  const { engine } = privateReasoningEngine({
    modelId: "deepseek-flash", provider: "deepseek",
    baseUrl: "https://synthetic-provider.example/v1", apiKey: "synthetic-not-a-credential",
  });
  expect(await engine.decompose("Synthetic research question")).toEqual(["Synthetic research target"]);
  const attempts = reasoningAttempts(engine);
  expect(attempts).toMatchObject([{ outcome: "served", tier: 0 }]);
  const snapshot = calculateTestnetEconomics([{
    id: "synthetic-usage-case", engine: effectiveEngineName(engine),
    reasoningAttempts: attempts, llmUsage: reasoningUsage(engine), researchMode: "quick",
  }], []);
  expect(snapshot).toMatchObject({ sampledRuns: 1, pricedRuns: priced, unpricedRuns: 1 - priced });
  if (!priced) expect(snapshot.shadowGrossMarginUsd).toBe(0);
  expect(http).toHaveBeenCalledTimes(1);
});

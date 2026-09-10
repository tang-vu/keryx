import { afterEach, expect, it, vi } from "vitest";
import { privateReasoningEngine } from "../llm/private-engine";
import { effectiveEngineName, reasoningAttempts, reasoningUsage, reasoningCalls } from "../llm/resilient-engine";
import { calculateTestnetEconomics, economicsRunSample } from "./testnet-economics";
import type { QueryRun } from "../types";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["measured", "missing", "failed"])("accounts for the optional evidence review: %s", async (review) => {
  const counters = { prompt_tokens: 100, completion_tokens: 10 };
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({
      answer: "The synthetic source describes durable storage [S1].", citedMarkers: ["S1"],
      evidence: [{ claimIndex: 0, marker: "S1", quoteId: "q0_0", support: 0.9 }], conflicts: [],
    }) } }], usage: counters }))
    .mockImplementationOnce(async () => {
      if (review === "failed") throw new Error("Synthetic private provider error");
      return Response.json({ choices: [{ message: { content: '{"reviews":[{"index":0,"support":0.9}]}' } }],
        ...(review === "measured" ? { usage: counters } : {}),
      });
    });
  vi.stubGlobal("fetch", http);
  const { engine } = privateReasoningEngine({ modelId: "deepseek-flash", provider: "deepseek",
    baseUrl: "https://synthetic-provider.example/v1", apiKey: "synthetic-not-a-credential" });
  const result = await engine.synthesize({ question: "How is the synthetic result stored?",
    subClaims: ["The synthetic result uses durable storage."], gathered: [{ sourceId: "synthetic",
      sourceName: "Synthetic source", marker: "S1", text: "The synthetic result uses durable storage." }] });
  expect(result.answer).toContain("[S1]");
  expect(http).toHaveBeenCalledTimes(2);
  expect(reasoningAttempts(engine)).toMatchObject([{ outcome: "served", step: "synthesize" }]);
  const calls = reasoningCalls(engine)!;
  expect(calls).toHaveLength(2);
  expect(new Set(calls.map((call) => call.id)).size).toBe(2);
  expect(JSON.stringify(calls)).not.toContain("Synthetic private provider error");
  const run = { id: "synthetic-reviewed", engine: effectiveEngineName(engine),
    reasoningAttempts: reasoningAttempts(engine), llmUsage: reasoningUsage(engine), llmCalls: calls } as QueryRun;
  const sample = JSON.parse(JSON.stringify(economicsRunSample(run)));
  expect(sample.usageCoverageVersion).toBe(2);
  expect(calculateTestnetEconomics([sample], [])).toMatchObject({
    pricedRuns: review === "measured" ? 1 : 0, unpricedRuns: review === "measured" ? 0 : 1,
  });
});

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
    reasoningAttempts: attempts, llmUsage: usage, llmCalls: reasoningCalls(engine),
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
    reasoningAttempts: attempts, llmUsage: reasoningUsage(engine), llmCalls: reasoningCalls(engine), researchMode: "quick",
  }], []);
  expect(snapshot).toMatchObject({ sampledRuns: 1, pricedRuns: priced, unpricedRuns: 1 - priced });
  if (!priced) expect(snapshot.shadowGrossMarginUsd).toBe(0);
  expect(http).toHaveBeenCalledTimes(1);
});

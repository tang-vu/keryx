import { afterEach, expect, it, vi } from "vitest";
import { config } from "../config";
import { getReasoningEngine } from "./index";
import { reasoningAttempts, reasoningCalls, reasoningUsage } from "./resilient-engine";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { CoverageReuseEngine } from "./coverage-reuse-engine";
import type { SufficiencyInput, SynthInput } from "./reasoning-engine";

const mutable = config as { deepseekKey: string; anthropicKey: string; llmModel: string; synthesisModel: string };
const original = { deepseekKey: mutable.deepseekKey, anthropicKey: mutable.anthropicKey,
  llmModel: mutable.llmModel, synthesisModel: mutable.synthesisModel };
afterEach(() => { Object.assign(mutable, original); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const input: SufficiencyInput = { question: "When does the synthetic system settle?",
  subClaims: ["When does the synthetic system settle?"], gathered: [{ sourceId: "source", marker: "S1",
    sourceName: "Synthetic source", text: "The synthetic system settles in two days.", contentVersion: "v1" }] };
const coverage = { rationale: "Bounded synthetic coverage", perClaim: [{ claim: input.subClaims[0],
  supportedAnswer: "It settles in two days.", missingRequestedParts: [], coverage: 0.9, coveredBy: ["S1"] }] };
function response(value: unknown) {
  return Response.json({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 200, prompt_cache_miss_tokens: 800 } });
}
function transport(ordinaryResearch = true) {
  const engine = new OpenAICompatibleEngine({ name: "llm:deepseek:deepseek-flash", provider: "deepseek",
    baseUrl: "https://synthetic.invalid", apiKey: "synthetic", model: "deepseek-flash" });
  return ordinaryResearch ? new CoverageReuseEngine(engine) : engine;
}

it("routes the explicit balanced option and retains both synthesis and evidence review", async () => {
  Object.assign(mutable, { deepseekKey: "synthetic", anthropicKey: "", llmModel: "deepseek-flash", synthesisModel: "deepseek-flash" });
  vi.stubEnv("KERYX_LLM_PROVIDER_ORDER", "deepseek");
  const models: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(init!.body as string); models.push(body.model);
    const packet = JSON.parse(body.messages[1].content.startsWith("{") ? body.messages[1].content : "{}");
    if (packet.quoteOptions?.length) {
      const quote = packet.quoteOptions[0];
      return response({ evidence: [{ claimIndex: 0, marker: quote.marker, quoteId: quote.quoteId, support: .9, statement: quote.text }], conflicts: [] });
    }
    if (body.messages[0].content.startsWith("You plan")) return response({ claims: input.subClaims });
    return response({ ...coverage, reviews: [], attributions: [{ sourceId: "source", weight: 1, rationale: "Synthetic" }] });
  });
  const engine = getReasoningEngine("deepseek-balanced");
  await engine.decompose(input.question);
  await engine.sufficiency(input);
  const attemptsBeforeReuse = reasoningAttempts(engine).length;
  await engine.sufficiency(structuredClone(input));
  expect(reasoningAttempts(engine)).toHaveLength(attemptsBeforeReuse);
  await engine.synthesize({ ...input, generationFormat: "evidence-only" } as SynthInput);
  await engine.attribute({ question: input.question, answer: "Synthetic answer [S1].", used: input.gathered });
  expect(models).toEqual(["deepseek-flash", "deepseek-flash", "deepseek-v4-pro", "deepseek-v4-pro", "deepseek-flash"]);
  expect(reasoningUsage(engine).map(u => [u.stage, u.model])).toEqual([
    ["decompose", "deepseek-flash"], ["sufficiency", "deepseek-flash"], ["attribute", "deepseek-flash"],
    ["synthesize", "deepseek-v4-pro"], ["evidence-review", "deepseek-v4-pro"],
  ]);
  expect(reasoningCalls(engine)).toHaveLength(5);
  expect(reasoningAttempts(engine).map(a => a.step)).toEqual(expect.arrayContaining(["decompose", "sufficiency", "synthesize", "attribute"]));
  expect(engine.name).toContain("deepseek-flash"); expect(engine.name).toContain("deepseek-v4-pro");
});

it("keeps an explicit Pro selection pinned to Pro", async () => {
  Object.assign(mutable, { deepseekKey: "synthetic", anthropicKey: "" });
  vi.stubEnv("KERYX_LLM_PROVIDER_ORDER", "deepseek");
  const http = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ claims: input.subClaims }));
  await getReasoningEngine("deepseek-v4-pro").decompose(input.question);
  expect(JSON.parse(http.mock.calls[0][1]!.body as string).model).toBe("deepseek-v4-pro");
});

it("reuses only exact successful coverage within the same ordinary engine", async () => {
  const http = vi.spyOn(globalThis, "fetch").mockImplementation(async () => response(coverage));
  const engine = transport(); const state = structuredClone(input);
  const first = await engine.sufficiency(state); first.rationale = "Caller mutation";
  expect((await engine.sufficiency(structuredClone(state))).rationale).not.toBe("Caller mutation");
  expect(http).toHaveBeenCalledTimes(1);
  state.gathered[0].text += " A new qualification applies."; await engine.sufficiency(state);
  state.gathered[0].contentVersion = "v2"; await engine.sufficiency(state);
  state.subClaims.push("What qualification applies?"); await engine.sufficiency(state);
  await transport().sufficiency(input);
  expect(http).toHaveBeenCalledTimes(5);
  expect(engine.calls).toHaveLength(4); expect(engine.usage!.every(u => u.stage === "sufficiency")).toBe(true);
});

it("does not cache failures or opt fixed transports into reuse", async () => {
  const http = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Synthetic unavailable", { status: 503 }))
    .mockImplementation(async () => response(coverage));
  const engine = transport(); await expect(engine.sufficiency(input)).rejects.toThrow();
  await engine.sufficiency(input); await engine.sufficiency(input);
  expect(engine.calls!.map(c => c.outcome)).toEqual(["failed", "returned"]);
  const fixed = transport(false); await fixed.sufficiency(input); await fixed.sufficiency(input);
  expect(http).toHaveBeenCalledTimes(4);
});

it("does not cache heuristic coverage after a provider failure", async () => {
  Object.assign(mutable, { deepseekKey: "synthetic", anthropicKey: "", llmModel: "deepseek-flash", synthesisModel: "deepseek-flash" });
  vi.stubEnv("KERYX_LLM_PROVIDER_ORDER", "deepseek");
  const http = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Synthetic invalid request", { status: 400 }))
    .mockImplementation(async () => response(coverage));
  const engine = getReasoningEngine("deepseek-flash");
  await engine.sufficiency(input);
  await engine.sufficiency(input);
  expect(http).toHaveBeenCalledTimes(2);
  expect(reasoningUsage(engine)).toHaveLength(1);
});

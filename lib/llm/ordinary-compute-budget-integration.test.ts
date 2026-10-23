import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";
import { OrdinaryComputeBudget, OrdinaryComputeLimitError, bindOrdinaryComputeBudget } from "./ordinary-compute-budget";
import { ResilientEngine } from "./resilient-engine";
import { CoverageReuseEngine } from "./coverage-reuse-engine";
import { StagedEngine } from "./staged-engine";
import { MemoryReasoningCircuitStore } from "./reasoning-circuit-store";
import { ReasoningTransportError, type SynthInput } from "./reasoning-engine";

const input = { question: "What is the documented constraint?", subClaims: ["What is the constraint?"], gathered: [] };
class Supplier extends JsonChatEngine {
  readonly requests: Array<{ system: string; packet: Record<string, unknown> }> = [];
  constructor(readonly name: string, private readonly fail = false) { super(); }
  protected async chatJson(_model: string, system: string, user: string) {
    const packet = JSON.parse(user);
    this.requests.push({ system, packet });
    if (this.fail) throw new ReasoningTransportError("network");
    if ("evidence" in packet) return { reviews: [{ index: 0, support: 0.9, statementSupport: 0.9 }] };
    if ("quoteOptions" in packet) {
      const quote = (packet.quoteOptions as Array<{ quoteId: string; marker: string }>)[0];
      return { evidence: quote ? [{ claimIndex: 0, marker: quote.marker, quoteId: quote.quoteId,
        support: 0.9, statement: "The synthetic source requires a retained receipt." }] : [], conflicts: [] };
    }
    return { perClaim: [], rationale: "No supported evidence." };
  }
}

function bind(engines: Supplier[], calls: number) {
  const budget = new OrdinaryComputeBudget({ calls, promptUtf8Bytes: 1_048_576, requestedOutputTokens: 131_072 });
  for (const engine of engines) bindOrdinaryComputeBudget(engine, budget);
  return budget;
}

describe("compute bounds at actual supplier call boundaries", () => {
  it("does not retry or call another provider when a shared allowance is exhausted", async () => {
    const primary = new Supplier("primary"), fallback = new Supplier("fallback");
    const budget = bind([primary, fallback], 1);
    const store = new MemoryReasoningCircuitStore();
    const failed = vi.spyOn(store, "failed"), succeeded = vi.spyOn(store, "succeeded");
    const engine = new ResilientEngine(primary, fallback, 0, store);
    await engine.sufficiency(input);
    succeeded.mockClear();
    await expect(engine.sufficiency(input)).rejects.toBeInstanceOf(OrdinaryComputeLimitError);
    expect(primary.requests).toHaveLength(1);
    expect(fallback.requests).toHaveLength(0);
    expect(failed).not.toHaveBeenCalled();
    expect(succeeded).not.toHaveBeenCalled();
    expect(budget.snapshot().admitted.calls).toBe(1);
    expect(primary.calls).toHaveLength(1);
    expect(engine.telemetry.at(-1)).toMatchObject({ outcome: "input-limited", error: "input_limit", status: 413 });
  });

  it("charges failed supplier attempts before failover and cannot regain their allowance", async () => {
    const primary = new Supplier("primary", true), fallback = new Supplier("fallback");
    const budget = bind([primary, fallback], 1);
    const engine = new ResilientEngine(primary, fallback);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(engine.sufficiency(input)).rejects.toBeInstanceOf(OrdinaryComputeLimitError);
      expect(primary.requests).toHaveLength(1);
      expect(fallback.requests).toHaveLength(0);
      expect(budget.snapshot().admitted.calls).toBe(1);
      expect(primary.calls[0]).toMatchObject({ outcome: "failed", stage: "sufficiency" });
    } finally { warning.mockRestore(); }
  });

  it("shares the routine and synthesis allowance while preserving evidence review", async () => {
    const routine = new Supplier("routine"), synthesis = new Supplier("synthesis");
    const budget = bind([routine, synthesis], 3);
    const engine = new StagedEngine(routine, synthesis);
    await engine.sufficiency(input);
    const synthesisInput: SynthInput = { ...input, generationFormat: "evidence-only", gathered: [{
      sourceId: "synthetic", sourceName: "Synthetic source", sourceKind: "public-reference", marker: "S1",
      text: "The synthetic source requires a retained receipt.", itemUrl: "https://example.invalid/original",
    }] };
    const result = await engine.synthesize(synthesisInput);
    expect(result.evidenceReview).toBe("completed");
    expect(routine.requests).toHaveLength(1);
    expect(synthesis.calls.map(call => call.stage)).toEqual(["synthesize", "evidence-review"]);
    expect(budget.snapshot().admitted.calls).toBe(3);
    await expect(engine.sufficiency(input)).rejects.toBeInstanceOf(OrdinaryComputeLimitError);
  });

  it("withholds unreviewed evidence when generation used the last supplier call", async () => {
    const engine = new Supplier("synthesis");
    bind([engine], 1);
    const result = await engine.synthesize({ ...input, generationFormat: "evidence-only", gathered: [{
      sourceId: "synthetic", sourceName: "Synthetic source", sourceKind: "public-reference", marker: "S1",
      text: "The synthetic source requires a retained receipt.", itemUrl: "https://example.invalid/original",
    }] });
    expect(engine.requests).toHaveLength(1);
    expect(result.evidenceReview).toBe("unavailable");
    expect(result.evidence?.every(item => item.support === 0 && item.statementSupport === 0)).toBe(true);
  });

  it("does not spend another call when exact coverage is reused", async () => {
    const supplier = new Supplier("routine");
    const budget = bind([supplier], 1);
    const engine = new CoverageReuseEngine(supplier);
    await engine.sufficiency(input);
    await engine.sufficiency(input);
    expect(supplier.requests).toHaveLength(1);
    expect(budget.snapshot().admitted.calls).toBe(1);
    await expect(engine.sufficiency({ ...input, question: input.question + " Changed." }))
      .rejects.toBeInstanceOf(OrdinaryComputeLimitError);
  });

  it("keeps direct fixed-model engines outside ordinary admission", async () => {
    const original = new Supplier("retained-original");
    for (let i = 0; i < 33; i++) await original.sufficiency(input);
    expect(original.requests).toHaveLength(33);
  });
});

describe("ordinary selector wiring", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

  it("binds actual balanced transports to one allowance and gives a new request a fresh budget", async () => {
    vi.resetModules();
    vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-no-network-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const fetch = vi.fn(async (_url: unknown, options: { body?: string } = {}) => {
      const request = JSON.parse(options.body!);
      const packet = JSON.parse(request.messages[1].content);
      const quote = packet.quoteOptions?.[0];
      const content = quote ? { evidence: [{ claimIndex: 0, marker: quote.marker, quoteId: quote.quoteId,
        support: 0.9, statement: "The synthetic source requires a retained receipt." }], conflicts: [] }
        : { perClaim: [], rationale: "No evidence." };
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 } });
    });
    vi.stubGlobal("fetch", fetch);
    const { getReasoningEngine } = await import("./index");
    const { ordinaryComputeSnapshot } = await import("./ordinary-compute-budget");
    const engine = getReasoningEngine("deepseek-balanced");
    for (let i = 0; i < 31; i++) await engine.sufficiency({ ...input, question: `${input.question} ${i}` });
    const result = await engine.synthesize({ ...input, generationFormat: "evidence-only", gathered: [{
      sourceId: "synthetic", sourceName: "Synthetic source", sourceKind: "public-reference", marker: "S1",
      text: "The synthetic source requires a retained receipt.", itemUrl: "https://example.invalid/original",
    }] });
    expect(fetch).toHaveBeenCalledTimes(32);
    expect(JSON.parse(fetch.mock.calls[0][1]!.body!).model).toBe("deepseek-flash");
    expect(JSON.parse(fetch.mock.calls[31][1]!.body!).model).toBe("deepseek-v4-pro");
    expect(result.evidenceReview).toBe("unavailable");
    expect(ordinaryComputeSnapshot(engine)!.admitted.calls).toBe(32);
    await expect(engine.sufficiency(input)).rejects.toMatchObject({ limit: "calls", status: 413 });
    expect(fetch).toHaveBeenCalledTimes(32);
    const next = getReasoningEngine("deepseek-balanced");
    await next.sufficiency(input);
    expect(fetch).toHaveBeenCalledTimes(33);
    expect(ordinaryComputeSnapshot(next)!.admitted.calls).toBe(1);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { BusinessCanaryEngine } from "../business-operator/canary-suppliers";
import { ResearchSelectionInputLimitError, ResearchSelectionPartialBatchError } from "./selection-input";
import { ResearchSelectionError } from "./research-selection";
import { ResilientEngine, reasoningAttempts } from "./resilient-engine";
import { MemoryReasoningCircuitStore } from "./reasoning-circuit-store";
import { ReasoningTransportError, type DecideInput } from "./reasoning-engine";

const supplier = vi.hoisted(() => ({ reserve: vi.fn() }));
// Actual transport/framing, synthetic supplier admission. Durable slot authority has separate tests.
vi.mock("../business-operator/canary-policy", () => ({
  configuredBusinessCanary: () => ({}), reserveCanaryModel: supplier.reserve,
  assertOrdinaryCanarySupplierAdmission: () => {},
}));

afterEach(() => { vi.unstubAllGlobals(); supplier.reserve.mockReset(); });

function input(count = 20, text = "p"): DecideInput {
  return { question: "Compare the documented behavior and limitations of the named systems.",
    subClaims: Array.from({ length: 8 }, (_, index) => `Which exact source documents requirement ${index}?`),
    budget: 0.01, spentSoFar: 0, memoryContext: "Historical hints cannot establish current evidence.",
    candidates: Array.from({ length: count }, (_, index) => ({
      id: `public:web:${String(index).padStart(64, "0")}`, sourceKind: "public-reference",
      name: "t".repeat(200), description: "Unverified preview; inspect the original document, including limitations.",
      tags: ["public-web"], fetchPrice: 0, cached: false, preview: text.repeat(600).slice(0, 600),
      item: { itemId: String(index).padStart(64, "0"), itemTitle: "t".repeat(200),
        itemUrl: `https://publisher${index}.example/` + "a".repeat(80), contentVersion: "unread" },
    })) };
}

function rows(ids: string[]) {
  return ids.map(sourceId => ({ sourceId, action: "CACHE", expectedValue: 0.8, confidence: 0.7,
    rationale: "Inspect this original to verify the requested behavior and limitations.", targets: [0, 7] }));
}

class CaptureEngine extends JsonChatEngine {
  readonly name = "synthetic-selection";
  readonly packets: { system: string; user: string; maxTokens: number }[] = [];
  constructor(private readonly reply?: (payload: { allowedSourceIds: string[] }, call: number) => Record<string, unknown>) { super(); }
  protected async chatJson(_model: string, system: string, user: string, maxTokens = 2048) {
    this.packets.push({ system, user, maxTokens });
    const payload = JSON.parse(user);
    return this.reply?.(payload, this.packets.length) ?? { decisions: rows(payload.allowedSourceIds) };
  }
}

describe("bounded source selection batches", () => {
  it.each(["p", "界", "ữ", "😀"])("fits actual Flash message bytes and retains every target/candidate (%s)", async text => {
    const request = input(20, text), before = structuredClone(request);
    const bodies: { model: string; messages: { role: string; content: string }[]; max_tokens: number }[] = [];
    const fetch = vi.fn(async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(String(options.body)); bodies.push(body);
      const payload = JSON.parse(body.messages[1].content);
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: {
        content: JSON.stringify({ decisions: rows(payload.allowedSourceIds) }),
      } }] }), { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetch);
    const engine = new BusinessCanaryEngine("synthetic-not-a-credential");
    const result = await engine.decide(request);
    expect(bodies.length).toBeGreaterThan(1);
    expect(supplier.reserve).toHaveBeenCalledTimes(bodies.length);
    expect(engine.calls).toHaveLength(bodies.length);
    const payloads = bodies.map(body => JSON.parse(body.messages[1].content));
    expect(payloads.flatMap(payload => payload.allowedSourceIds)).toEqual(request.candidates.map(candidate => candidate.id));
    expect(new Set(bodies.map(body => body.messages[1].content)).size).toBe(bodies.length);
    for (const [index, body] of bodies.entries()) {
      expect(body.model).toBe("deepseek-v4-flash");
      expect(body.messages.map(message => message.role)).toEqual(["system", "user"]);
      expect(body.messages[0].content.endsWith(" Respond with a single JSON object.")).toBe(true);
      expect(Buffer.byteLength(body.messages.map(message => message.content).join(""), "utf8")).toBeLessThanOrEqual(32000);
      expect(body.max_tokens).toBeLessThanOrEqual(8192);
      expect(payloads[index]).toMatchObject({ question: request.question, budget: 0.01, spentSoFar: 0,
        memoryContext: request.memoryContext, allowedTargetIndexes: [0, 1, 2, 3, 4, 5, 6, 7],
        subClaims: request.subClaims.map((question, claimIndex) => ({ question, claimIndex })) });
      expect(payloads[index].candidates.map((candidate: { sourceId: string }) => candidate.sourceId)).toEqual(payloads[index].allowedSourceIds);
      for (const candidate of payloads[index].candidates) {
        const original = request.candidates.find(value => value.id === candidate.sourceId)!;
        expect(candidate).toMatchObject({ name: original.name, description: original.description, tags: original.tags,
          preview: original.preview, article: original.item!.itemTitle, articleUrl: original.item!.itemUrl,
          contentVersion: original.item!.contentVersion });
      }
      const [system, user, maximum] = supplier.reserve.mock.calls[index];
      expect(body.messages.map(message => message.content)).toEqual([system + " Respond with a single JSON object.", user]);
      expect(body.max_tokens).toBe(maximum);
    }
    expect(result.map(decision => decision.sourceId)).toEqual(request.candidates.map(candidate => candidate.id));
    expect(result.every(decision => decision.action === "CACHE" && decision.targets.join(",") === "0,7")).toBe(true);
    expect(request).toEqual(before);
  });

  it("counts escaped metadata, URLs and caller-required source scope rather than previews alone", async () => {
    const request = input(9);
    for (const candidate of request.candidates) {
      candidate.preview = "short preview";
      candidate.description = "界\"\\".repeat(400);
      candidate.tags = ["許可".repeat(300)];
      candidate.item!.itemUrl += "b".repeat(1800);
      candidate.item!.requestedSource = { urls: [candidate.item!.itemUrl, candidate.item!.itemUrl + "#limits"], readScope: "bounded-whole-document" };
    }
    const engine = new CaptureEngine();
    await engine.decide(request);
    expect(engine.packets.length).toBeGreaterThan(1);
    for (const packet of engine.packets) {
      expect(Buffer.byteLength(packet.system + " Respond with a single JSON object." + packet.user, "utf8")).toBeLessThanOrEqual(32000);
      for (const value of JSON.parse(packet.user).candidates) {
        const original = request.candidates.find(candidate => candidate.id === value.sourceId)!;
        expect(value).toMatchObject({ description: original.description, tags: original.tags, requestedSource: original.item!.requestedSource });
      }
    }
  });

  it("preflights the stricter actual Cloudflare input plus output limit for every batch", async () => {
    const bodies: { messages: { content: string }[]; max_tokens: number }[] = [];
    const fetch = vi.fn(async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(String(options.body)); bodies.push(body);
      const payload = JSON.parse(body.messages[1].content);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ decisions: rows(payload.allowedSourceIds) }) } }] });
    });
    vi.stubGlobal("fetch", fetch);
    const engine = new OpenAICompatibleEngine({ provider: "cloudflare", name: "synthetic-cloudflare",
      baseUrl: "https://synthetic.invalid", model: "synthetic-model", apiKey: "synthetic" });
    expect(await engine.decide(input(20))).toHaveLength(20);
    expect(bodies.length).toBeGreaterThan(1);
    for (const body of bodies) {
      expect(Buffer.byteLength(body.messages.map(message => message.content).join(""), "utf8") + body.max_tokens).toBeLessThanOrEqual(23000);
    }
  });

  it("makes an indivisible stricter Cloudflare selection terminal before either tier dispatches", async () => {
    const request = input(1); request.candidates[0].description = "d".repeat(18000);
    const fetch = vi.fn(() => { throw Error("No supplier may dispatch"); }); vi.stubGlobal("fetch", fetch);
    const primary = new OpenAICompatibleEngine({ provider: "cloudflare", name: "synthetic-cloudflare-indivisible",
      baseUrl: "https://synthetic.invalid", model: "synthetic-model", apiKey: "synthetic" });
    const alternate = new CaptureEngine(), engine = new ResilientEngine(primary, alternate, 0, new MemoryReasoningCircuitStore());
    const error = await engine.decide(request).catch(value => value);
    expect(error).toBeInstanceOf(ResearchSelectionInputLimitError);
    expect(error.bounds.maximumCombinedUnits).toBe(23000);
    expect(error.bounds.promptUtf8Bytes).toBeLessThan(32000);
    expect(error.bounds.promptUtf8Bytes + error.bounds.requestedOutputTokens).toBeGreaterThan(23000);
    expect(primary.calls).toHaveLength(0); expect(alternate.calls).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["candidate", "target", "question", "memory"])("refuses an indivisible oversized %s before any request or fallback", async kind => {
    const request = input(20);
    if (kind === "candidate") request.candidates.at(-1)!.description = "界".repeat(12000);
    if (kind === "target") request.subClaims[7] = "界".repeat(12000);
    if (kind === "question") request.question = "界".repeat(12000);
    if (kind === "memory") request.memoryContext = "界".repeat(12000);
    const primary = new CaptureEngine(), fallback = new CaptureEngine();
    const engine = new ResilientEngine(primary, fallback, 0, new MemoryReasoningCircuitStore());
    await expect(engine.decide(request)).rejects.toBeInstanceOf(ResearchSelectionInputLimitError);
    expect(primary.calls).toHaveLength(0); expect(fallback.calls).toHaveLength(0);
    expect(reasoningAttempts(engine)).toEqual([expect.objectContaining({ step: "decide", outcome: "input-limited", error: "input_limit", status: 413 })]);
  });

  it("preserves output room per row without raising the 8192-token ceiling", async () => {
    const request = input(60);
    for (const candidate of request.candidates) {
      candidate.preview = ""; candidate.name = "short"; candidate.description = "short"; candidate.item = undefined;
    }
    const engine = new CaptureEngine();
    expect(await engine.decide(request)).toHaveLength(60);
    expect(engine.packets.map(packet => JSON.parse(packet.user).expectedDecisionRows)).toEqual([28, 28, 4]);
    expect(engine.packets.map(packet => packet.maxTokens)).toEqual([8192, 8192, 2048]);
  });

  it("never admits another batch's ID through the combined output", async () => {
    const request = input(24), foreign = request.candidates.at(-1)!.id;
    const engine = new CaptureEngine((payload, call) => ({ decisions: call === 1
      ? [...rows([payload.allowedSourceIds[0]]), ...rows([foreign])]
      : rows(payload.allowedSourceIds.filter(id => id !== foreign)) }));
    const result = await engine.decide(request);
    expect(engine.packets.length).toBeGreaterThan(1);
    expect(result.some(decision => decision.sourceId === foreign)).toBe(false);
    expect(engine.selectionDiagnostics[0].reasons).toContainEqual({ code: "unknown_source", rowIndex: 1 });
  });

  it("keeps nonadjacent duplicate input IDs in one group and retains their withheld verdict", async () => {
    const request = input(12);
    for (const candidate of request.candidates) candidate.description = "d".repeat(4500);
    request.candidates.at(-1)!.id = request.candidates[0].id;
    const engine = new CaptureEngine();
    const result = await engine.decide(request), duplicate = request.candidates[0].id;
    expect(engine.packets.filter(packet => JSON.parse(packet.user).allowedSourceIds.includes(duplicate))).toHaveLength(1);
    expect(result.filter(decision => decision.sourceId === duplicate)).toEqual([expect.objectContaining({ action: "SKIP", targets: [], selectionRefusal: "duplicate_source" })]);
    expect(result.filter(decision => decision.sourceId !== duplicate)).toHaveLength(10);
  });

  it("stops on invalid batch output without retry, later batch calls or fallback", async () => {
    const request = input(8);
    for (const candidate of request.candidates) candidate.description = "d".repeat(9000);
    const primary = new CaptureEngine((payload, call) => call === 2 ? {} : { decisions: rows(payload.allowedSourceIds) });
    const fallback = new CaptureEngine();
    const engine = new ResilientEngine(primary, fallback, 0, new MemoryReasoningCircuitStore());
    await expect(engine.decide(request)).rejects.toBeInstanceOf(ResearchSelectionError);
    expect(primary.calls).toHaveLength(2); expect(fallback.calls).toHaveLength(0);
    expect(primary.selectionDiagnostics.at(-1)?.outcome).toBe("refused");
  });

  it("preserves the first batch transport failure without inventing completed work", async () => {
    const failure = new ReasoningTransportError("network");
    const primary = new CaptureEngine(() => { throw failure; });
    await expect(primary.decide(input(20))).rejects.toBe(failure);
    expect(primary.calls).toHaveLength(1);
  });

  it.each([
    [new ReasoningTransportError("network"), "network", undefined],
    [new ReasoningTransportError("timeout"), "timeout", undefined],
    [Object.assign(new Error("private provider response"), { status: 429 }), "rate_limited", 429],
    [Object.assign(new Error("private provider response"), { status: 503 }), "provider", 503],
    [new Error("private provider response"), "unknown", undefined],
  ])("holds a later batch failure as %s without replaying earlier responses", async (failure, category, status) => {
    const primary = new CaptureEngine((payload, call) => { if (call === 2) throw failure; return { decisions: rows(payload.allowedSourceIds) }; });
    const fallback = new CaptureEngine(), store = new MemoryReasoningCircuitStore();
    const engine = new ResilientEngine(primary, fallback, 0, store);
    const error = await engine.decide(input(24)).catch(value => value);
    expect(error).toBeInstanceOf(ResearchSelectionPartialBatchError);
    expect(error).toMatchObject({ category, status, completedBatches: 1 });
    expect(JSON.stringify(error)).not.toContain("private");
    expect(error).not.toHaveProperty("cause");
    expect(primary.calls).toHaveLength(2); expect(fallback.calls).toHaveLength(0);
    expect(reasoningAttempts(engine)).toEqual([expect.objectContaining({ outcome: "failed", error: category === "unknown" ? "internal" : category })]);
  });

  it("keeps hostile thrown values terminal and never evaluates category/status getters", async () => {
    const getter = vi.fn(() => { throw Error("private provider response"); });
    const forged = Object.defineProperty(new ReasoningTransportError("network"), "category", { get: getter });
    const proxy = new Proxy({}, { getOwnPropertyDescriptor: () => { throw Error("private proxy response"); } });
    for (const failure of [forged, proxy]) {
      const primary = new CaptureEngine((payload, call) => { if (call === 2) throw failure; return { decisions: rows(payload.allowedSourceIds) }; });
      const fallback = new CaptureEngine(), engine = new ResilientEngine(primary, fallback, 0, new MemoryReasoningCircuitStore());
      await expect(engine.decide(input(24))).rejects.toMatchObject({ name: "ResearchSelectionPartialBatchError", category: "unknown" });
      expect(primary.calls).toHaveLength(2); expect(fallback.calls).toHaveLength(0);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("continues to consult the supplier hold before each distinct batch's HTTP", async () => {
    let held = 10;
    supplier.reserve.mockImplementation(() => { if (held === 11) throw new Error("provider ceiling exhausted"); held++; });
    const fetch = vi.fn(async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(String(options.body)), payload = JSON.parse(body.messages[1].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decisions: rows(payload.allowedSourceIds) }) } }] }));
    });
    vi.stubGlobal("fetch", fetch);
    await expect(new BusinessCanaryEngine("synthetic-not-a-credential").decide(input(20)))
      .rejects.toMatchObject({ name: "ResearchSelectionPartialBatchError", category: "unknown", completedBatches: 1 });
    expect(held).toBe(11); expect(supplier.reserve).toHaveBeenCalledTimes(2); expect(fetch).toHaveBeenCalledTimes(1);
  });
});

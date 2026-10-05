import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { HeuristicEngine } from "./heuristic-engine";
import { DurableReasoningCircuitStore, MemoryReasoningCircuitStore } from "./reasoning-circuit-store";
import { ResilientEngine, reasoningAttempts, reasoningCalls, reasoningUsage } from "./resilient-engine";
import { ReasoningOutputValidationError, type DecideInput } from "./reasoning-engine";

const opened: SqliteAdapter[] = [];
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  while (opened.length) opened.pop()!.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const names = { deepseek: "llm:deepseek:deepseek-v4-flash", mimo: "llm:mimo:mimo-v2.5",
  cloudflare: "llm:cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast" };
function provider(provider: keyof typeof names) {
  return new OpenAICompatibleEngine({ provider, name: names[provider], model: names[provider].slice(`llm:${provider}:`.length),
    baseUrl: `https://${provider}.synthetic.invalid`, apiKey: "synthetic" });
}
const input = (count = 1): DecideInput => ({ question: "How does the documented synthetic recovery journal work?",
  subClaims: ["How is a journal entry retained?", "How is an uncertain original recovered?"], budget: 0.03, spentSoFar: 0,
  candidates: Array.from({ length: count }, (_, index) => ({ id: `source-${index}`, name: `Journal ${index}`,
    description: "Synthetic original journal documentation", tags: ["journal", "recovery"], fetchPrice: 0.001, cached: false,
    preview: "A journal entry retains its original identifier and uncertain recovery state. ".repeat(9) })) });
function reply(sourceId = "source-0", targets: number[] | undefined = [0]) {
  return Response.json({ choices: [{ message: { content: JSON.stringify({ decisions: [{ sourceId, action: "BUY",
    expectedValue: 0.9, confidence: 0.9, rationale: "The original journal can answer the target", targets }] }) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5809, completion_tokens: 1921 } });
}

describe("response validation and durable client isolation", () => {
  it.each(["TimeoutError", "AbortError"])("preserves %s during response-body transport as timeout", async name => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = Response.json({});
    vi.spyOn(body, "json").mockRejectedValue(Object.assign(new Error("synthetic body deadline"), { name }));
    const transport = vi.fn().mockResolvedValueOnce(body).mockImplementation(async () => reply());
    vi.stubGlobal("fetch", transport);
    const engine = new ResilientEngine(provider("deepseek"), provider("mimo"), 0, new MemoryReasoningCircuitStore());
    await engine.decide(input());
    expect(reasoningAttempts(engine)[0]).toMatchObject({ outcome: "failed", error: "timeout" });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("retains a prior failure and bounded half-open lease after invalid model output", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Date, "now").mockReturnValue(1001);
    const store = new MemoryReasoningCircuitStore(), key = JSON.stringify([names.deepseek, "decide"]);
    await store.failed(key, { transient: true, now: 0, failureThreshold: 1, baseCooldownMs: 1000, maxCooldownMs: 10000 });
    const success = vi.spyOn(store, "succeeded"), failed = vi.spyOn(store, "failed");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "{broken" } }] })));
    await new ResilientEngine(provider("deepseek"), new HeuristicEngine(), 0, store).decide(input());
    expect(success).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
    expect((await store.acquire(key, 1002, 1000)).allowed).toBe(false);
    expect((await store.failed(key, { transient: true, now: 1002, failureThreshold: 1, baseCooldownMs: 1000, maxCooldownMs: 10000 })).failures).toBe(2);
  });

  it("keeps a returned billable response distinct from failed decision validation and later requests", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new MemoryReasoningCircuitStore();
    const failed = vi.spyOn(store, "failed");
    // A billable JSON response passes transport parsing but lacks required decision targets.
    const bad = Response.json({ choices: [{ message: { content: JSON.stringify({ decisions: [{ sourceId: "source-0",
      action: "BUY", expectedValue: 0.9, confidence: 0.9, rationale: "relevant" }] }) } }],
      usage: { prompt_tokens: 5809, completion_tokens: 1921 } });
    const transport = vi.fn().mockResolvedValueOnce(bad).mockImplementation(async () => reply());
    vi.stubGlobal("fetch", transport);
    const primary = provider("deepseek"), alternate = provider("mimo");
    const first = new ResilientEngine(primary, alternate, 0, store);
    expect(await first.decide(input())).toMatchObject([{ action: "BUY", targets: [0], price: 0.001 }]);
    expect(reasoningAttempts(first)).toMatchObject([
      { engine: names.deepseek, outcome: "failed", error: "output_validation" },
      { engine: names.mimo, outcome: "served" },
    ]);
    expect(primary.calls[0].outcome).toBe("returned");
    expect(reasoningUsage(first)).toHaveLength(2);
    expect(reasoningUsage(first)[0]).toMatchObject({ callId: primary.calls[0].id, inputTokens: 5809, outputTokens: 1921 });
    expect(failed).not.toHaveBeenCalled();
    const second = new ResilientEngine(provider("deepseek"), provider("mimo"), 0, store);
    expect(await second.decide(input())).toMatchObject([{ targets: [0] }]);
    expect(reasoningAttempts(second)).toMatchObject([{ engine: names.deepseek, outcome: "served" }]);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it.each([400, 413, 422])("keeps HTTP %s payload rejection local to its request", async status => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new MemoryReasoningCircuitStore(), failed = vi.spyOn(store, "failed");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("synthetic", { status })).mockImplementation(async () => reply()));
    const first = new ResilientEngine(provider("deepseek"), provider("mimo"), 0, store);
    await first.decide(input());
    expect(reasoningAttempts(first)[0]).toMatchObject({ outcome: "failed", error: "invalid_request", status });
    await new ResilientEngine(provider("deepseek"), provider("mimo"), 0, store).decide(input());
    expect(failed).not.toHaveBeenCalled();
  });

  it("does not label unknown application errors as network failures or retry them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = new HeuristicEngine();
    const decide = vi.spyOn(primary, "decide").mockRejectedValue(new TypeError("synthetic private response"));
    const store = new MemoryReasoningCircuitStore(), failed = vi.spyOn(store, "failed");
    const engine = new ResilientEngine(primary, undefined, 0, store);
    await engine.decide(input());
    expect(decide).toHaveBeenCalledOnce();
    expect(reasoningAttempts(engine)[0]).toMatchObject({ outcome: "failed", error: "internal" });
    expect(JSON.stringify(reasoningAttempts(engine))).not.toContain("synthetic private response");
    expect(failed).not.toHaveBeenCalled();
  });
});

it("preserves shared open circuits across sequential and concurrent clients while refusing the exact oversized fallback payload before HTTP", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-resilience-clients-")); directories.push(directory);
  const file = path.join(directory, "circuits.sqlite");
  const makeClient = async () => {
    const db = new SqliteAdapter(file); await db.init(); opened.push(db);
    const store = new DurableReasoningCircuitStore(async () => db);
    return new ResilientEngine(provider("deepseek"), new ResilientEngine(provider("mimo"),
      new ResilientEngine(provider("cloudflare"), new HeuristicEngine(), 2, store), 1, store), 0, store);
  };
  const transport = vi.fn(async (url: string) => {
    if (url.includes("deepseek")) throw new TypeError("synthetic connection refused");
    if (url.includes("mimo")) throw Object.assign(new Error("synthetic deadline"), { name: "TimeoutError" });
    throw new Error("Cloudflare must be refused before HTTP");
  });
  vi.stubGlobal("fetch", transport);
  const offered = input(48);
  const first = await makeClient(); await first.decide(offered);
  expect(reasoningAttempts(first).map(attempt => [attempt.engine, attempt.outcome, attempt.error])).toEqual([
    [names.deepseek, "failed", "network"], [names.mimo, "failed", "timeout"],
    [names.cloudflare, "input-limited", "input_limit"], ["heuristic", "served", undefined],
  ]);
  expect(reasoningCalls(first)).toHaveLength(2);
  expect(reasoningUsage(first)).toEqual([]);
  const sequential = await makeClient(); await sequential.decide(offered);
  const concurrent = await Promise.all([makeClient(), makeClient(), makeClient()]);
  await Promise.all(concurrent.map(client => client.decide(offered)));
  for (const client of [sequential, ...concurrent]) {
    const attempts = reasoningAttempts(client);
    expect(attempts.slice(0, 2)).toMatchObject([{ outcome: "circuit-open" }, { outcome: "circuit-open" }]);
    expect(attempts[2]).toMatchObject({ outcome: "input-limited", error: "input_limit",
      inputBounds: { maximumCombinedUnits: 23000, requestedOutputTokens: 8192 } });
    const bounds = attempts[2].inputBounds!;
    expect(bounds.promptUtf8Bytes + bounds.requestedOutputTokens).toBeGreaterThan(bounds.maximumCombinedUnits);
    expect(reasoningCalls(client)).toEqual([]);
    expect(reasoningUsage(client)).toEqual([]);
  }
  expect(transport).toHaveBeenCalledTimes(2);
});

it("checks an eligible actual decide envelope without removing research targets, candidate identity or economic bounds", async () => {
  const offered = input(8);
  const transport = vi.fn(async () => reply()); vi.stubGlobal("fetch", transport);
  const engine = provider("cloudflare"); await engine.decide(offered);
  const request = (transport.mock.calls[0] as unknown as [string, RequestInit])[1];
  const wire = JSON.parse(request.body as string);
  const payload = JSON.parse(wire.messages[1].content);
  expect(payload.question).toBe(offered.question);
  expect(payload.subClaims).toEqual(offered.subClaims.map((question, claimIndex) => ({ question, claimIndex })));
  expect(payload).toMatchObject({ budget: offered.budget, spentSoFar: offered.spentSoFar });
  expect(payload.candidates).toHaveLength(offered.candidates.length);
  for (const [index, candidate] of offered.candidates.entries()) {
    expect(payload.candidates[index]).toMatchObject({ sourceId: candidate.id, name: candidate.name,
      description: candidate.description, tags: candidate.tags, price: candidate.fetchPrice, cached: candidate.cached,
      preview: candidate.preview.slice(0, 600), sourceKind: "creator" });
  }
  const actualBytes = new TextEncoder().encode(wire.messages.map((message: { content: string }) => message.content).join("")).length;
  expect(actualBytes + wire.max_tokens).toBeLessThanOrEqual(23000);
  expect(engine.calls).toHaveLength(1);
  expect(engine.usage).toHaveLength(1);
});

it.each(["{broken", "null", "[]"])("classifies malformed model JSON %s as output validation", async text => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 5, completion_tokens: 3 } })));
  const engine = provider("deepseek");
  await expect(engine.decide(input())).rejects.toBeInstanceOf(ReasoningOutputValidationError);
  expect(engine.usage).toHaveLength(1);
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { runAgent } from "../agent/run-agent";
import type { AgentDeps } from "../agent/deps";
import { HeuristicEngine } from "./heuristic-engine";
import { JsonChatEngine } from "./json-chat-engine";
import { OpenAICompatibleEngine } from "./openai-compatible-engine";
import { MemoryReasoningCircuitStore } from "./reasoning-circuit-store";
import { ReasoningInputLimitError, ReasoningOutputValidationError, ReasoningTransportError } from "./reasoning-engine";
import { ResilientEngine, reasoningAttempts, reasoningCalls, reasoningUsage } from "./resilient-engine";
import { boundedResearchPlan, parseResearchPlan, ResearchPlanningError, researchFailureMessage } from "./research-plan";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Synthetic Vietnamese comparisons, not historical provider output or vendor advice.
const systemd = {
  question: "Đối chiếu default, TimeoutStopSec=infinity và SendSIGKILL=no theo tài liệu chính thức phiên bản X: hành vi khi worker còn chạy, rủi ro deploy, và điều kiện kiểm tra trước khi sửa cấu hình.",
  claims: ["Default: hành vi khi worker còn chạy theo phiên bản X?", "TimeoutStopSec=infinity: hành vi khi worker còn chạy theo phiên bản X?",
    "SendSIGKILL=no: hành vi khi worker còn chạy theo phiên bản X?", "Default: rủi ro deploy theo phiên bản X?",
    "TimeoutStopSec=infinity: rủi ro deploy theo phiên bản X?", "SendSIGKILL=no: rủi ro deploy theo phiên bản X?", "Điều kiện kiểm tra trước khi sửa cấu hình phiên bản X?"],
};
const sqlite = {
  question: "Đọc https://example.org/wal.html và https://example.org/backup.html phiên bản X; so sánh copy live.db và Online Backup API về tính nhất quán, ghi đồng thời, khóa, và bước xác minh khôi phục. Trình bày bảng ngắn.",
  claims: ["Copy live.db: tính nhất quán theo hai tài liệu phiên bản X?", "Online Backup API: tính nhất quán theo hai tài liệu phiên bản X?",
    "Copy live.db: ghi đồng thời theo hai tài liệu phiên bản X?", "Online Backup API: ghi đồng thời theo hai tài liệu phiên bản X?",
    "Copy live.db: khóa theo hai tài liệu phiên bản X?", "Online Backup API: khóa theo hai tài liệu phiên bản X?",
    "Các bước xác minh khôi phục cho cả hai phương pháp theo phiên bản X?"],
};

class Fixture extends JsonChatEngine {
  readonly name = "synthetic-planning";
  constructor(private output: Record<string, unknown>) { super(); }
  protected async chatJson() { return this.output; }
}
function provider(name = "primary") {
  return new OpenAICompatibleEngine({ name: `llm:${name}`, baseUrl: `https://${name}.synthetic.invalid`, apiKey: "synthetic", model: "synthetic" });
}
function response(content: unknown, finish_reason = "stop") {
  return Response.json({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason }],
    usage: { prompt_tokens: 23, completion_tokens: 11 } });
}

describe("bounded planning contract", () => {
  it.each([systemd, sqlite])("preserves all supplied atomic targets and reaches discovery without changing the claim limit", async fixture => {
    const engine = new Fixture({ status: "complete", claims: fixture.claims, constraints: ["Use the original source versions; keep all substantive conditions."] });
    const boundary = new Error("synthetic discovery boundary");
    const listSources = vi.fn().mockRejectedValue(boundary), payFetch = vi.fn(), payCitations = vi.fn();
    const deps = { engine, db: { listSources }, gateway: { mode: "offline", payFetch, payCitations } } as unknown as AgentDeps;
    const iterator = runAgent({ question: fixture.question, budget: 0, researchMode: "quick" }, deps);
    expect((await iterator.next()).value).toMatchObject({ phase: "decompose" });
    expect((await iterator.next()).value).toMatchObject({ phase: "decompose", detail: fixture.claims });
    expect((await iterator.next()).value).toMatchObject({ phase: "decompose", detail: { researchMode: "quick", reevaluateRounds: 0 } });
    await expect(iterator.next()).rejects.toBe(boundary);
    expect(listSources).toHaveBeenCalledOnce(); expect(payFetch).not.toHaveBeenCalled(); expect(payCitations).not.toHaveBeenCalled();
  });

  it.each([
    {}, { claims: [] }, { claims: "private-model-body" }, { claims: ["valid", null] }, { claims: ["valid", " "] },
    { claims: ["valid", "x".repeat(601)] }, { claims: Array(65).fill("valid") },
    { status: "invented", claims: ["valid"] }, { claims: ["valid"], constraints: "private-model-body" },
    { claims: ["valid"], constraints: [null] }, { claims: ["valid"], constraints: Array(17).fill("valid") },
  ])("refuses malformed scope without filtering or aggregate fallback: %j", output => {
    expect(() => parseResearchPlan("Original caller request", output)).toThrow(ResearchPlanningError);
  });

  it("deduplicates only exact trimmed repeats and keeps distinct case or paraphrased targets", () => {
    expect(parseResearchPlan("request", { claims: [" Target A? ", "Target A?", "target a?", "Reworded A?", ...Array.from({ length: 5 }, (_, i) => `Other ${i}?`)] }))
      .toEqual(["Target A?", "target a?", "Reworded A?", ...Array.from({ length: 5 }, (_, i) => `Other ${i}?`)]);
    expect(() => parseResearchPlan("request", { claims: Array.from({ length: 9 }, (_, i) => `Target ${i}?`) })).toThrow("proposed research plan exceeded 8");
    expect(() => parseResearchPlan("request", { status: "needs_refinement", claims: ["aggregate question"] })).toThrow(ResearchPlanningError);
  });

  it("keeps suggestions bounded, caller-derived and out of generic error logs and accounting", () => {
    const question = `Private-caller-marker compare versions?\nKeep original qualifications;\nRead https://user:secret@example.org/private?q=secret#section, ${"😀".repeat(140)}.`;
    const error = new ResearchPlanningError(question, "expanded_output");
    expect(error.message).not.toContain("Private-caller-marker");
    expect(error.message).not.toContain("secret");
    expect(JSON.stringify(error)).not.toContain("Private-caller-marker");
    expect(inspect(error)).not.toContain("Private-caller-marker");
    expect(error.scopeChoices.length).toBeLessThanOrEqual(3);
    for (const choice of error.scopeChoices) { expect(choice.length).toBeLessThanOrEqual(241); expect(choice.isWellFormed()).toBe(true); }
    const message = researchFailureMessage(error);
    expect(message).toContain("Private-caller-marker"); expect(message).toContain("not a new question or an automatic retry");
    expect(message).not.toContain("https://user"); expect(message).not.toContain("secret");
    expect(researchFailureMessage(new Error("unchanged unknown error"))).toBe("unchanged unknown error");
  });

  it("wraps planning output validation only, retaining transport and input-limit distinctions", async () => {
    await expect(boundedResearchPlan("original", async () => { throw new ReasoningOutputValidationError("private-model-body"); })).rejects.toThrow(ResearchPlanningError);
    for (const error of [new ReasoningInputLimitError("input bound"), new ReasoningTransportError("timeout"), new TypeError("unknown")]) {
      await expect(boundedResearchPlan("original", async () => { throw error; })).rejects.toBe(error);
    }
  });
});

describe("billable planning refusal lifecycle", () => {
  it.each([
    { content: { claims: Array.from({ length: 9 }, (_, i) => `Private-provider-body target ${i}?`) }, finish: "stop" },
    { content: { claims: ["valid", null] }, finish: "stop" },
    { content: "{private-provider-body malformed", finish: "stop" },
    { content: { claims: sqlite.claims }, finish: "length" },
  ])("stops before discovery and extra paid tiers while retaining the returned call and usage: %j", async ({ content, finish }) => {
    const transport = vi.fn(async () => response(content, finish)); vi.stubGlobal("fetch", transport);
    const store = new MemoryReasoningCircuitStore(), failed = vi.spyOn(store, "failed"), succeeded = vi.spyOn(store, "succeeded");
    const primary = provider(), alternate = provider("alternate");
    const fallback = new ResilientEngine(alternate, new HeuristicEngine(), 1, store);
    const engine = new ResilientEngine(primary, fallback, 0, store);
    const listSources = vi.fn(), payFetch = vi.fn(), payCitations = vi.fn();
    const iterator = runAgent({ question: sqlite.question, budget: 0, researchMode: "quick" },
      { engine, db: { listSources }, gateway: { mode: "offline", payFetch, payCitations } } as unknown as AgentDeps);
    await iterator.next();
    await expect(iterator.next()).rejects.toBeInstanceOf(ResearchPlanningError);
    expect(transport).toHaveBeenCalledOnce(); expect(listSources).not.toHaveBeenCalled();
    expect(payFetch).not.toHaveBeenCalled(); expect(payCitations).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled(); expect(succeeded).not.toHaveBeenCalled();
    expect(reasoningAttempts(engine)).toMatchObject([{ step: "decompose", outcome: "failed", error: "output_validation", status: 422 }]);
    expect(reasoningAttempts(engine)).toHaveLength(1);
    // Valid JSON returns before local target validation; malformed/truncated JSON
    // fails inside chatJson. Both retain the billable provider-reported usage.
    expect(reasoningCalls(engine)).toMatchObject([{ outcome: typeof content === "string" || finish === "length" ? "failed" : "returned" }]);
    expect(reasoningCalls(engine)).toHaveLength(1);
    expect(reasoningUsage(engine)).toMatchObject([{ inputTokens: 23, outputTokens: 11 }]);
    expect(JSON.stringify({ attempts: reasoningAttempts(engine), calls: reasoningCalls(engine), usage: reasoningUsage(engine) })).not.toContain("Private-provider-body");
    expect(alternate.calls).toEqual([]);
    transport.mockImplementation(async () => response({ claims: sqlite.claims }));
    expect(await new ResilientEngine(provider(), fallback, 0, store).decompose(sqlite.question)).toEqual(sqlite.claims);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("preserves a prior failure and half-open lease on request-local planning refusal", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1001);
    const primary = provider(), store = new MemoryReasoningCircuitStore(), key = JSON.stringify([primary.name, "decompose"]);
    await store.failed(key, { transient: true, now: 0, failureThreshold: 1, baseCooldownMs: 1000, maxCooldownMs: 10000 });
    const failed = vi.spyOn(store, "failed"), succeeded = vi.spyOn(store, "succeeded");
    vi.stubGlobal("fetch", vi.fn(async () => response({ claims: Array.from({ length: 9 }, (_, i) => `Target ${i}?`) })));
    await expect(new ResilientEngine(primary, provider("alternate"), 0, store).decompose(sqlite.question)).rejects.toBeInstanceOf(ResearchPlanningError);
    expect(failed).not.toHaveBeenCalled(); expect(succeeded).not.toHaveBeenCalled();
    expect((await store.acquire(key, 1002, 1000)).allowed).toBe(false);
    expect((await store.failed(key, { transient: true, now: 1002, failureThreshold: 1, baseCooldownMs: 1000, maxCooldownMs: 10000 })).failures).toBe(2);
  });

  it("continues normal transport fallback for planning without classifying it as a scope refusal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport = vi.fn().mockResolvedValueOnce(new Response("private-provider-body", { status: 503 }))
      .mockImplementation(async () => response({ claims: systemd.claims }));
    vi.stubGlobal("fetch", transport);
    const store = new MemoryReasoningCircuitStore(), failed = vi.spyOn(store, "failed");
    const engine = new ResilientEngine(provider(), provider("alternate"), 0, store);
    expect(await engine.decompose(systemd.question)).toEqual(systemd.claims);
    expect(transport).toHaveBeenCalledTimes(2); expect(failed).toHaveBeenCalledOnce();
    expect(reasoningAttempts(engine)).toMatchObject([{ error: "provider", status: 503 }, { outcome: "served" }]);
  });
});

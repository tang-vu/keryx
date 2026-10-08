import { describe, expect, it } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";
import { ReasoningOutputLimitError } from "./reasoning-engine";

class Engine extends JsonChatEngine {
  readonly name = "fixture";
  protected supportsDecisionBrief() { return true; }
  requests: { system: string; user: Record<string, unknown> }[] = [];
  constructor(private readonly mode: "valid" | "negative" | "missing" | "outage" | "malformed" | "extra" = "valid") { super(); }
  protected async chatJson(_model: string, system: string, user: string) {
    const data = JSON.parse(user);
    this.requests.push({ system, user: data });
    if (this.requests.length === 1) {
      if (this.mode === "malformed") return { answer: "Unsupported prose [S1]" };
      return { facts: [{ id: "f1", targetIndex: 0, text: "The queue permits duplicates.", quoteIds: ["q0_0"], support: 0.8 }],
        actions: [{ id: "a1", text: "Tolerate duplicates.", premiseIds: ["f1"], conditions: ["If this queue is used."] }] };
    }
    if (this.mode === "outage") throw new Error("Private supplier error");
    return { digest: data.packet.digest, facts: this.mode === "missing" ? [] : [
      { id: "f1", status: this.mode === "negative" ? "unsupported" : "supported", support: 0.7,
        quotes: [{ quoteId: "q0_0", status: "supported", support: 0.7 }] }],
      actions: [{ id: "a1", status: "supported" }], ...(this.mode === "extra" ? { summary: "Unreviewed assertion" } : {}) };
  }
}
const input = { question: "How should retries work?", subClaims: ["Are duplicates possible?"], answerFormat: "decision-brief" as const,
  gathered: [{ sourceId: "q", sourceName: "Queue", marker: "S1", text: "The queue permits duplicates. Handlers must tolerate duplicates." }] };

describe("two-pass bounded decision-brief engine", () => {
  it.each(["generation", "review"] as const)("retains an explicit %s output stop without exposing a brief or retrying", async stage => {
    class LimitEngine extends Engine {
      callsMade = 0;
      protected async chatJson(model: string, system: string, user: string) {
        if (++this.callsMade === (stage === "generation" ? 1 : 2)) throw new ReasoningOutputLimitError(4096);
        return super.chatJson(model, system, user);
      }
    }
    const engine = new LimitEngine(), result = await engine.synthesize(input);
    expect(engine.callsMade).toBe(stage === "generation" ? 1 : 2);
    expect(result.synthesisOutputLimit).toEqual({ stage, outputTokenLimit: 4096 });
    expect(result.synthesisFailure).toBe(stage);
    expect(result.answer).toBe(""); expect(result.evidence).toEqual([]);
    expect(result.decisionBrief).toBeUndefined();
  });
  it("reviews the complete immutable packet and exposes only a marker envelope before delivery", async () => {
    const engine = new Engine(); const result = await engine.synthesize(input);
    expect(engine.requests).toHaveLength(2); expect(result.evidenceReview).toBe("completed");
    expect(result.answer).toBe("[S1]"); expect(result.conflicts).toEqual([]);
    expect(result.decisionBrief?.actions).toEqual(["a1"]);
    expect(result.evidence[0].support).toBe(0.7);
    const review = JSON.stringify(engine.requests[1].user);
    expect(review).toContain("Handlers must tolerate duplicates.");
    expect(review).toContain("If this queue is used.");
  });
  it("cascades a negative full-fact review to actions and evidence", async () => {
    const result = await new Engine("negative").synthesize(input);
    expect(result.decisionBrief?.actions).toEqual([]); expect(result.evidence).toEqual([]);
  });
  it.each(["missing", "outage", "malformed", "extra"] as const)("fails closed on %s without leaking a draft or retrying generation", async mode => {
    const engine = new Engine(mode); const result = await engine.synthesize(input);
    expect(result.answer).toBe(""); expect(result.evidence).toEqual([]);
    expect(result.citedMarkers).toEqual([]); expect(result.decisionBrief).toBeUndefined();
    expect(result.evidenceReview).toBe("unavailable");
    expect(result.synthesisFailure).toBe(mode === "malformed" ? "generation" : "review");
    expect(JSON.stringify(result)).not.toContain("Private supplier error");
    expect(engine.requests).toHaveLength(mode === "malformed" ? 1 : 2);
  });
  it("distinguishes missing input from generation and review without making a supplier call", async () => {
    const engine = new Engine();
    const result = await engine.synthesize({ ...input, gathered: [] });
    expect(result.synthesisFailure).toBe("input");
    expect(result.evidence).toEqual([]);
    expect(engine.requests).toHaveLength(0);
  });
  it("does not report a failure when a valid generation finds no facts", async () => {
    class NoFactsEngine extends Engine {
      protected async chatJson(_model: string, _system: string, _user: string) {
        return { facts: [], actions: [] };
      }
    }
    const result = await new NoFactsEngine().synthesize(input);
    expect(result.evidenceReview).toBe("completed");
    expect(result.synthesisFailure).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import {
  lastUserQuestion,
  buildAnswerContent,
  buildCompletion,
  buildChunk,
  keryxMeta,
  traceLine,
  type ChatMessage,
} from "./openai-compat";
import type { QueryRun, TraceStep } from "./types";

function makeRun(overrides: Partial<QueryRun> = {}): QueryRun {
  return {
    id: "q-123",
    question: "What is Arc?",
    budget: 0.05,
    engine: "llm:deepseek-chat",
    subClaims: [],
    decisions: [],
    citations: [
      { marker: "S1", sourceId: "s1", sourceName: "Latent Space", weight: 0.6, reward: 0.012, rationale: "core" },
      { marker: "S2", sourceId: "s2", sourceName: "Agent Weekly", weight: 0.4, reward: 0.008, rationale: "support" },
    ],
    answer: "Arc is an EVM L1 for stablecoin payments.",
    totalSpent: 0.02,
    totalToCreators: 0.02,
    trace: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("lastUserQuestion", () => {
  it("takes the last user message (string content)", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "be terse" },
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "what is x402?" },
    ];
    expect(lastUserQuestion(msgs)).toBe("what is x402?");
  });

  it("extracts text from the vision array content form", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "explain" }, { type: "text", text: "Arc" }] },
    ];
    expect(lastUserQuestion(msgs)).toBe("explain Arc");
  });

  it("falls back to the last non-empty message when no user turn has text", () => {
    const msgs: ChatMessage[] = [{ role: "assistant", content: "hello there" }];
    expect(lastUserQuestion(msgs)).toBe("hello there");
  });

  it("returns empty string for missing/empty messages", () => {
    expect(lastUserQuestion(undefined)).toBe("");
    expect(lastUserQuestion([])).toBe("");
  });
});

describe("buildAnswerContent", () => {
  it("appends a creators-paid footer naming each cited source and reward", () => {
    const c = buildAnswerContent(makeRun());
    expect(c).toContain("Arc is an EVM L1");
    expect(c).toContain("Latent Space — $0.0120");
    expect(c).toContain("Agent Weekly — $0.0080");
    expect(c).toContain("Total to creators: $0.0200");
  });

  it("omits the footer when nothing was cited", () => {
    const run = makeRun({ citations: [], totalToCreators: 0 });
    expect(buildAnswerContent(run)).toBe(run.answer);
  });
});

describe("buildCompletion", () => {
  it("produces a valid OpenAI ChatCompletion with the keryx extension", () => {
    const out = buildCompletion(makeRun(), "keryx");
    expect(out.id).toBe("chatcmpl-q-123");
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0]!.finish_reason).toBe("stop");
    expect(out.choices[0]!.message.content).toContain("Arc is an EVM L1");
    expect(out.keryx.creatorsPaid).toBe(2);
    expect(out.keryx.totalToCreators).toBe(0.02);
    expect(out.keryx.dispatchUrl).toContain("/dispatch/q-123");
  });
});

describe("buildChunk", () => {
  it("defaults finish_reason to null and passes the delta through", () => {
    const ch = buildChunk("chatcmpl-1", "keryx", { content: "hi" });
    expect(ch.object).toBe("chat.completion.chunk");
    expect(ch.choices[0]!.delta).toEqual({ content: "hi" });
    expect(ch.choices[0]!.finish_reason).toBeNull();
  });

  it("merges an extra vendor field on the terminal chunk", () => {
    const ch = buildChunk("chatcmpl-1", "keryx", {}, "stop", { keryx: { a: 1 } }) as Record<string, unknown>;
    expect(ch.keryx).toEqual({ a: 1 });
    expect((ch.choices as { finish_reason: string }[])[0]!.finish_reason).toBe("stop");
  });
});

describe("traceLine", () => {
  it("renders a step as a bracketed phase line", () => {
    const step: TraceStep = { phase: "decide", message: "BUY Latent Space ($0.002)", ts: Date.now() };
    expect(traceLine(step)).toBe("[decide] BUY Latent Space ($0.002)\n");
  });
});

describe("keryxMeta", () => {
  it("summarizes citations and totals", () => {
    const m = keryxMeta(makeRun());
    expect(m.citations).toHaveLength(2);
    expect(m.citations[0]).toEqual({ source: "Latent Space", weight: 0.6, reward: 0.012 });
    expect(m.engine).toBe("llm:deepseek-chat");
  });
});

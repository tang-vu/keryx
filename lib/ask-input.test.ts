import { describe, expect, it } from "vitest";
import { MAX_ASK_QUESTION_CHARS, parseAskQuestion, parseResearchMode, isWellFormedAskText } from "./ask-input";

describe("parseAskQuestion", () => {
  it("trims a bounded question", () => {
    expect(parseAskQuestion("  How does x402 settle?  ")).toEqual({
      success: true,
      question: "How does x402 settle?",
    });
  });

  it("rejects empty, non-string, and oversized input", () => {
    expect(parseAskQuestion("   ")).toMatchObject({ success: false });
    expect(parseAskQuestion(42)).toMatchObject({ success: false });
    expect(parseAskQuestion("x".repeat(MAX_ASK_QUESTION_CHARS + 1))).toMatchObject({
      success: false,
      error: expect.stringContaining(String(MAX_ASK_QUESTION_CHARS)),
    });
  });
});

describe("parseResearchMode", () => {
  it("accepts explicit modes and preserves Deep for missing or crafted API values", () => {
    expect(parseResearchMode("quick")).toBe("quick");
    expect(parseResearchMode("deep")).toBe("deep");
    expect(parseResearchMode(undefined)).toBe("deep");
    expect(parseResearchMode("turbo")).toBe("deep");
  });
});

describe("public request text before payment", () => {
  it.each(["question\0text", "\ud800question", "question\udfff", "valid \ud83d\udd12 then \ud800"])("rejects unsupported text without repairing its bytes", value => {
    expect(isWellFormedAskText(value)).toBe(false);
    expect(parseAskQuestion(value)).toMatchObject({ success: false, error: "question contains an invalid text character" });
  });
  it.each(["T\u00e0i li\u1ec7u \ud83d\udd12 ti\u1ebfng Vi\u1ec7t", "literal \\u0000 and \\ud800", "e\u0301", "line one\nline two"])("preserves supported Unicode and literal escape text", value => {
    expect(isWellFormedAskText(value)).toBe(true);
    expect(parseAskQuestion(value)).toEqual({ success: true, question: value });
  });
});

import { describe, expect, it } from "vitest";
import { MAX_ASK_QUESTION_CHARS, parseAskQuestion, parseResearchMode } from "./ask-input";

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

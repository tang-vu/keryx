import { describe, expect, it } from "vitest";
import { MAX_ASK_QUESTION_CHARS, parseAskQuestion } from "./ask-input";

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

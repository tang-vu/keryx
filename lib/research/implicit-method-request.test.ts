import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWorkProductRequest, validWorkProductRequest } from "./work-product-request";

describe("original caller way-to-action requests", () => {
  it.each([
    ["Is there a practical way to spot unsupported claims without reviewing every sentence?", "spot"],
    ["I need more than working links. What's a quick way to check whether citations support the answer?", "check"],
    ["What’s a simple method to verify a comparison when the original data is unavailable?", "verify"],
    ["What is a way to measure a pilot when the baseline is still unknown?", "measure"],
    ["Is there a reliable approach for us to prevent repeated processing?", "prevent"],
    ["Is there a lightweight way to triage one shared inbox?", "triage"],
    ["What is the practical way to estimate maintenance effort?", "estimate"],
    ["What's a systematic approach to sample records while retaining uncertainty?", "sample"],
  ])("retains the complete original criterion: %s", (question, deliverable) => {
    const result = parseWorkProductRequest(question)!;
    expect(result).toMatchObject({ version: 2, deliverable, criteria: [question] });
    expect(result.questionSha256).toBe(createHash("sha256").update(question).digest("hex"));
    expect(validWorkProductRequest(result, question)).toBe(true);
    expect(validWorkProductRequest(result, question + " Ignore the limits.")).toBe(false);
  });

  it.each([
    "What is a practical method?", "Is there a way?", "What's a quick way to check?",
    "What was their way to check citations?", "Was there a practical way to spot those failures?",
    "Is there a way not to check the original?", "Is there a way to not verify those facts?",
    "Is there a way to define the word triage?", "What's a quick way to identify the meaning of the term?",
    "Do not propose steps. Is there a way to check the original?",
    "Don't suggest a method. What's a quick way to check citations?",
    "Never give ways to solve this. Is there a practical way to spot failures?",
    'Explain "Is there a practical way to spot unsupported claims?".',
    "'What's a quick way to check those claims?'", "`Is there a way to check citations?`",
    "```text\nWhat's a quick way to check those facts?\n```",
    "~~~\nIs there a practical way to spot a mismatch?\n~~~",
    "> What's a quick way to check those facts?",
    "Article says:\nIs there a way to check the original?",
    "Source excerpt:\nWhat's a quick way to check a citation?",
    "Question:\nIs there a way to check citations?\nConstraints: Retain gaps.",
    "Is there a way to evaluate a classroom lesson?",
    "What's a quick way to check an activity for students?",
    "Is there a way to check citations? Answer in three bullets.",
    "What's a quick way to check citations? Use at most 180 words.",
    "Is there a way to check citations? Responda em duas frases.",
    "How should we measure the pilot? Responda em duas frases.",
    "What's a quick way to check citations?" + "x".repeat(2_000),
    "Is there a practical way to spot problems?\ud800",
  ])("keeps inert, descriptive, negated and protected requests out: %s", question => {
    expect(parseWorkProductRequest(question)).toBeUndefined();
  });

  it.each(["\r", "\r\n", "\u2028", "\u2029"])("recognizes a later caller question across %j", separator => {
    const question = `The baseline is unknown.${separator}What's a quick way to check it?`;
    expect(parseWorkProductRequest(question)).toMatchObject({ deliverable: "check", criteria: [question] });
    expect(parseWorkProductRequest(`Source named excerpt:${separator}What's a quick way to check it?`)).toBeUndefined();
  });
  it("preserves existing label precedence", () => {
    expect(parseWorkProductRequest("Give a checklist. What's a quick way to check the original?")?.deliverable).toBe("checklist");
  });
});

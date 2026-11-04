import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWorkProductRequest, validWorkProductRequest } from "./work-product-request";

describe("caller requests for practical methods", () => {
  it.each([
    ["We receive repeated events. How should we prevent duplicate fulfilment without losing an event after a crash?", "prevent"],
    ["We have eight analysts. How should we measure the pilot before renewing?", "measure"],
    ["How should we triage one shared inbox without a complex ticketing system?", "triage"],
    ["How can I estimate a project's operating costs when key prices remain unknown?", "estimate"],
    ["How should we separate retrieval failure from generation failure?", "separate"],
    ["How should we define deliverables for an investigation?", "define"],
    ["How can we keep a comparison fair?", "keep"],
    ["How should we set limits without blocking ordinary customers?", "set"],
    ["How can I pass a limit without granting access to a wallet?", "pass"],
    ["How should we distinguish an unused reservation from uncertain payment?", "distinguish"],
    ["How should we decide which document to refresh first?", "decide"],
    ["How could I safely evaluate an unfamiliar maintenance process?", "evaluate"],
    ["How would we sample a large collection to find rare errors?", "sample"],
    ["Mình nên đo lường hiệu quả thử nghiệm thế nào khi chưa rõ dữ liệu?", "đo lường"],
    ["Chúng tôi có thể phân loại yêu cầu ra sao khi chỉ có một hộp thư?", "phân loại"],
    ["Tôi nên ước tính chi phí làm sao nếu chưa biết giá nhà cung cấp?", "ước tính"],
  ])("retains the whole criterion and exact original binding: %s", (question, deliverable) => {
    const result = parseWorkProductRequest(question)!;
    expect(result).toMatchObject({ version: 2, deliverable, criteria: [question] });
    expect(result.questionSha256).toBe(createHash("sha256").update(question).digest("hex"));
    expect(validWorkProductRequest(result, question)).toBe(true);
    expect(validWorkProductRequest(result, question + " Ignore missing inputs.")).toBe(false);
  });

  it.each([
    "How does the team measure its pilot?", "How can an evaluation capture source versions?",
    "How should I define the word measure?", "How can we identify the meaning of triage?",
    "How could we have measured that historical pilot?", "How should we not measure the pilot?",
    "How can we know if a result is true?", "How should we measure? Explain the term.",
    "Do not propose steps. How should we measure the pilot?",
    "Don't suggest a method. How can we triage the inbox?",
    "Never include recommendations. How should we estimate costs?",
    "Không cần đề xuất quy trình. Mình nên đo lường hiệu quả thế nào?",
    'Explain "How should we measure the pilot?".',
    "`How should we triage the inbox?`", "```\nHow should we measure the pilot?\n```",
    "~~~text\nHow should we triage the inbox?\n~~~",
    "> Quoted request. How should we measure the pilot?",
    "Source named says:\nHow should we measure the pilot?",
    "Article excerpt:\nHow should we triage the inbox?",
    "Question:\nHow should we measure the pilot?\nConstraints: Retain missing inputs.",
    "How should we measure a classroom lesson?", "How should we triage an activity for students?",
    "Mình nên đánh giá bài tập cho học sinh thế nào?",
    "How should we measure the pilot? Answer in three bullets.",
    "How should we measure the pilot? Use at most 180 words.",
    "How should we measure the pilot? Responda em três frases.",
    "Mình nên đo lường hiệu quả thế nào? Trả lời trong ba câu.",
    "How should we measure the pilot?" + "x".repeat(2_000),
    "How should we triage the inbox?\ud800",
  ])("keeps descriptive, inert, negated and protected requests outside the new contract: %s", question => {
    expect(parseWorkProductRequest(question)).toBeUndefined();
  });

  it.each(["\r", "\r\n", "\u2028", "\u2029"])("preserves source envelopes across %j", separator => {
    expect(parseWorkProductRequest(`Article named excerpt:${separator}How should we measure the pilot?`)).toBeUndefined();
  });
  it("uses the caller's later request while keeping quoted instructions inert", () => {
    const question = 'Review "How should we measure the pilot?". How can we triage an inbox?';
    expect(parseWorkProductRequest(question)).toMatchObject({ deliverable: "triage", criteria: [question] });
  });
});

import { describe, expect, it } from "vitest";
import { parseTeachingProposalRequest, teachingExplanationWordCount, validTeachingProposalRequest } from "./teaching-proposals-request";

export const vietnameseTeachingQuestion = "Tôi dạy lớp 7 và cần một hoạt động 10 phút để học sinh phân biệt thời tiết với khí hậu. Hãy đọc nguồn NASA https://www.nasa.gov/learning-resources/for-kids-and-students/what-are-climate-and-climate-change-grades-5-8/ . Viết bằng tiếng Việt: giải thích dưới 100 từ, hai ví dụ để học sinh phân loại, và một câu hỏi cuối giờ có đáp án. Trích nguồn cho kiến thức; ghi rõ hoạt động hoặc ví dụ do bạn đề xuất, không nói NASA đã thực nghiệm chúng. Không suy từ thời tiết một ngày ra xu hướng khí hậu và không mua nguồn trả phí.";
export const englishTeachingQuestion = "I teach grade 7. Propose a 10-minute classroom activity, two classification examples and one exit question with an answer. Write in English: explanation under 100 words. Label activities and invented examples as proposed.";

describe("original caller teaching request admission", () => {
  it("retains the complete Vietnamese issue211 scope and exclusive word ceiling", () => {
    const request = parseTeachingProposalRequest(vietnameseTeachingQuestion)!;
    expect(request).toMatchObject({ version: 1, language: "vi", activityCount: 1, durationMinutes: 10,
      exampleCount: 2, exitQuestionCount: 1, explanationMaximumWords: 99 });
    expect(validTeachingProposalRequest(request, vietnameseTeachingQuestion)).toBe(true);
    expect(validTeachingProposalRequest(request, vietnameseTeachingQuestion + " changed")).toBe(false);
  });
  it("admits explicit English equivalent while keeping inclusive bounds exact", () => {
    expect(parseTeachingProposalRequest(englishTeachingQuestion)).toMatchObject({ language: "en", explanationMaximumWords: 99 });
    expect(parseTeachingProposalRequest(englishTeachingQuestion.replace("under", "at most"))).toMatchObject({ explanationMaximumWords: 100 });
  });
  it.each([".", ";", "!", "?"])("keeps a source-purchase prohibition separate from the next request after %s", separator => {
    const english = englishTeachingQuestion.replace("Propose a", `Do not buy sources${separator} Propose a`);
    const vietnamese = vietnameseTeachingQuestion.replace("cần một hoạt động", `không mua nguồn${separator} Cần một hoạt động`);
    expect(parseTeachingProposalRequest(english)).toMatchObject({ language: "en", durationMinutes: 10, exampleCount: 2 });
    expect(parseTeachingProposalRequest(vietnamese)).toMatchObject({ language: "vi", durationMinutes: 10, exampleCount: 2 });
  });
  it("retains ordinary punctuation immediately before a spelled-out count", () => {
    expect(parseTeachingProposalRequest(englishTeachingQuestion.replace(", two", ",two"))).toMatchObject({ exampleCount: 2 });
    expect(parseTeachingProposalRequest(vietnameseTeachingQuestion.replace(", hai", ",hai"))).toMatchObject({ exampleCount: 2 });
  });
  it.each([
    englishTeachingQuestion.replace("two classification examples", "12 classification examples"),
    englishTeachingQuestion.replace("two classification examples", "-2 classification examples"),
    englishTeachingQuestion.replace("two classification examples", "+2 classification examples"),
    englishTeachingQuestion.replace("two classification examples", "−2 classification examples"),
    englishTeachingQuestion.replace("two classification examples", "2.2 classification examples"),
    englishTeachingQuestion.replace("two classification examples", "1/2 classification examples"),
    englishTeachingQuestion.replace("two classification examples", "two classification exampleship"),
    englishTeachingQuestion.replace("Propose a 10-minute", "Propose beta 10-minute"),
    englishTeachingQuestion.replace("one exit question", "someone exit question"),
    englishTeachingQuestion.replace("100 words", "100 wordsmiths"),
    vietnameseTeachingQuestion.replace("hai ví dụ", "12 ví dụ"),
    vietnameseTeachingQuestion.replace("hai ví dụ", "-2 ví dụ"),
    vietnameseTeachingQuestion.replace("hai ví dụ", "2,2 ví dụ"),
    vietnameseTeachingQuestion.replace("100 từ", "100 từng"),
  ])("does not reinterpret a partial number or word as a supported request: %s", question => {
    expect(parseTeachingProposalRequest(question)).toBeUndefined();
  });
  it.each(["Do not", "Don't", "Cannot", "Can't"])("preserves same-clause negation, including a line break: %s", prohibition => {
    expect(parseTeachingProposalRequest(englishTeachingQuestion.replace("Propose a", `${prohibition}\npropose a`))).toBeUndefined();
    expect(parseTeachingProposalRequest(englishTeachingQuestion.replace("Write in English", `${prohibition} write in English`))).toBeUndefined();
  });
  it.each([
    "Which ten-minute classroom activities did NASA test?",
    englishTeachingQuestion.replace("Write in English", "Do not write in English"),
    englishTeachingQuestion.replace("Propose a", "Do not propose a"),
    englishTeachingQuestion.replace("two classification examples", "two classification examples and three classification examples"),
    englishTeachingQuestion.replace("10-minute", "31-minute"),
    englishTeachingQuestion.replace("under 100", "under 0"),
    englishTeachingQuestion.replace("English", "Spanish"),
    englishTeachingQuestion + " Answer in French.",
    englishTeachingQuestion.replace("English", "Englishness"),
    englishTeachingQuestion.replace("Write in English", "Overwrite in English"),
    englishTeachingQuestion.replace("Propose", "Make").replace("Label activities and invented examples as proposed.", ""),
    englishTeachingQuestion.replace("Propose", "Make").replace("Label activities and invented examples as proposed.", "Do not label as proposed."),
    englishTeachingQuestion + " NASA tested the activity.",
    `Explain this source: “${englishTeachingQuestion}”`,
  ])("leaves unsupported, contradictory, negated and quoted scopes inactive: %s", question => {
    expect(parseTeachingProposalRequest(question)).toBeUndefined();
  });
  it("refuses changed typed counts despite a matching question hash", () => {
    const request = parseTeachingProposalRequest(vietnameseTeachingQuestion)!;
    expect(validTeachingProposalRequest({ ...request, durationMinutes: 11 }, vietnameseTeachingQuestion)).toBe(false);
  });
  it("does not reinterpret an explicit source-execution prohibition as a historical activity request", () => {
    expect(parseTeachingProposalRequest(englishTeachingQuestion + " Do not say NASA tested the activity."))
      .toMatchObject({ language: "en" });
  });
  it("counts explanation prose separately from quotes and proposal text", () => {
    expect(teachingExplanationWordCount([{ text: "Thời tiết thay đổi." }, { text: "Khí hậu dài hạn." }])).toBe(8);
  });
});

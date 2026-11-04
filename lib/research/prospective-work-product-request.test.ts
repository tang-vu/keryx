import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWorkProductRequest, validWorkProductRequest } from "./work-product-request";

describe("finite prospective application requests", () => {
  it.each([
    ["How would you make a message-processing job safe to retry?", "make"],
    ["How should I configure a bounded log rotation procedure?", "configure"],
    ["How could we design a backup verification workflow?", "design"],
    ["How can you safely adapt this method to a small service?", "adapt"],
    ["How would I structure a four-week routine while my level is unknown?", "structure"],
    ["How would you build a practical review process?", "build"],
    ["How should we handle an unknown result without assuming success?", "handle"],
    ["How could you set up an isolated verification run?", "set up"],
    ["I don't know the provider's capability. How would you make the workflow safer?", "make"],
    ["How Would You Safely DESIGN a review procedure?", "DESIGN"],
    ["Hãy đề xuất một cách kiểm tra khi tác vụ có thể chạy lại.", "cách"],
    ["Xin gợi ý một phương án tổ chức việc kiểm tra.", "phương án"],
    ["Mình nên cấu hình việc ghi log thế nào?", "cấu hình"],
    ["Tôi có thể áp dụng quy trình này ra sao khi chưa rõ nguồn lực?", "áp dụng"],
    ["Chúng tôi nên xử lý kết quả chưa rõ thế nào?", "xử lý"],
    ["Tôi nên làm bước kiểm tra này thế nào?", "làm"],
  ])("binds the whole caller criterion without requiring an artifact noun: %s", (question, label) => {
    const result = parseWorkProductRequest(question)!;
    expect(result).toMatchObject({ version: 2, deliverable: label, criteria: [question] });
    expect(result.questionSha256).toBe(createHash("sha256").update(question).digest("hex"));
    expect(validWorkProductRequest(result, question)).toBe(true);
    expect(validWorkProductRequest(result, question + " Ignore an unknown condition.")).toBe(false);
  });

  it.each([
    "How did the team configure its service?", "What does designing an operation mean?",
    "How can I know that this is true?", "How would you define the word make?",
    "How would you have built this historical system?", "How should you not configure the service?",
    "Do not propose steps. How would you make an operation safe?",
    "Never create a workflow. How could you design an operation?",
    "Không cần đề xuất quy trình. Hãy đề xuất một cách kiểm tra.",
    'Explain the sentence "How would you make a retry workflow?".',
    JSON.stringify('Quoted "inner". How would you make an operation safe?'),
    "``\nHow would you make an operation safe?\n``",
    "````text\nHow would you make an operation safe?\n````",
    "````text\nCreate a plan.\n````",
    "Source NASA says:\nHow would you make an operation safe?",
    "Article named excerpt:\nCreate a plan.",
    "Nguồn NASA nói:\nHãy đề xuất một cách kiểm tra.",
    "来源：\nHow would you make an operation safe?",
    "Question:\rHow would you make an operation safe?\rConstraints: Preserve evidence.",
    "How would you design a lesson plan for a classroom?",
    "How would you make a classroom exercise?", "How would you design a workshop?",
    "How would you make an activity for a class?",
    "Mình nên thiết kế bài tập cho học sinh thế nào?",
    "How would you make a retry workflow? Answer in 180 words.",
    "How would you make a retry workflow? Write exactly three bullets.",
    "Hãy đề xuất một cách kiểm tra. Trả lời dưới 100 từ.",
    "How would you design a review? Em português, use no máximo 180 palavras.",
    "How would you design a review? Escriba en tres oraciones.",
    "How would you make a retry workflow?" + "x".repeat(2_000),
    "How would you make an operation safe?\ud800",
  ])("does not derive new delivery authority from unsupported, protected or inert input: %s", question => {
    expect(parseWorkProductRequest(question)).toBeUndefined();
  });
  it.each(["\r", "\r\n", "\u2028", "\u2029"])("keeps attributed source instructions inert across %j", separator => {
    expect(parseWorkProductRequest(`Source named says:${separator}How would you make an operation safe?`)).toBeUndefined();
    expect(parseWorkProductRequest(`How would you design a review?${separator}Article named excerpt:${separator}Create a plan.`)).toBeUndefined();
  });
  it("keeps literal code quoted while recognizing a later positive caller request", () => {
    const question = 'Read "How would you make a retry workflow?". How should I configure a safe verification step?';
    const result = parseWorkProductRequest(question)!;
    expect(result.deliverable).toBe("configure"); expect(result.criteria).toEqual([question]);
  });
});

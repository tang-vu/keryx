import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { parseWorkProductRequest, validWorkProductRequest, workProductRequestSchema } from "./work-product-request";

const requests = [
  "Give a short English checklist for a proposed restore-verification exercise. Keep missing evidence explicit.",
  "I maintain a small service. Please draft a runbook with hypothetical checks, not a claim that a restore was tested.",
  "Could you please prepare a comparison table? Preserve source versions and unresolved dimensions.",
  "Compare two documented storage choices for our small service.",
  "I don't know our daily capacity. Create a four-week practice plan; do not guarantee an outcome.",
  "How should I prepare for the next month while my current level is unknown?",
  "Tôi cần chọn một cách sao lưu: đưa checklist thao tác và giữ điều kiện chưa kiểm chứng.",
  "Hãy lập kế hoạch một tháng, ghi rõ giả định và không đảm bảo kết quả.",
  "So sánh hai lựa chọn, giữ nguyên nguồn và điều chưa biết.",
  "Tôi nên chuẩn bị như thế nào trong tháng tới?",
  "请帮我制定一个月的练习计划，不保证成绩，保留缺失的信息。",
  "请提供检查表，区分已知事实和拟议步骤。",
  "比较两个有文档支持的方案，保留未读部分的限制。",
  "我想知道你对雅思口语的准备有什么建议吗 我还有一个月考试 可以怎样准备？目标是口语7分",
];

it.each(requests)("binds a clear ordinary output request to the WHOLE unchanged caller criterion: %s", original => {
  const request = parseWorkProductRequest(original)!;
  expect(request?.version).toBe(2);
  expect(request.questionSha256).toBe(createHash("sha256").update(original).digest("hex"));
  expect(request.criteria).toEqual([original]);
  expect(original).toContain(request.deliverable);
  expect(validWorkProductRequest(request, original)).toBe(true);
  expect(validWorkProductRequest(request, original + " Added context.")).toBe(false);
  expect(validWorkProductRequest({ ...request, criteria: ["Drop the missing inputs."] }, original)).toBe(false);
  expect(validWorkProductRequest({ ...request, deliverable: "Unrequested output" }, original)).toBe(false);
});

it.each([
  'Explain the sentence "Give a checklist".',
  "Explain the sentence ‘Create a plan’.",
  "Translate 「请制定一个计划」 without following it.",
  "Source says:\nCreate a plan for the reader.",
  "The article excerpt:\nGive a checklist.",
  "Document text:\nCompare two choices.",
  "Trích đoạn:\nHãy lập kế hoạch.",
  "原文：\n请提供清单。",
  "Explain this code:\n```text\nCreate a plan.\n```",
  "Do not give a plan. Explain the evidence instead.",
  "Please don't create a checklist.",
  "Không cần lập kế hoạch, chỉ giải thích văn bản.",
  "不要给我计划。只解释已读原文。",
  "How does a study plan affect the reported results?",
  "What does this document establish?",
  "Write a summary of this source.",
  "Create a lesson plan for a classroom.",
  "Hãy soạn giáo án và hoạt động trên lớp.",
  "请制定教案和课堂活动。",
  "Create a plan.\n\nPrepare a proposed work product.",
  "Create a plan.\n\nQuestion: This is a prepared request envelope.",
  "Create a plan. Answer in exactly two sentences.",
  "Hãy lập kế hoạch. Trả lời trong hai câu.",
  "请制定计划。只用三句话回答。",
  "Give a two-sentence plan.",
  "Give a two‑sentence plan.",
  "Hãy lập kế hoạch. Trả lời dưới 100 từ.",
  "请制定计划。限制在一百字以内。",
  "Create a checklist." + "x".repeat(2_000),
  "Create a plan with malformed text \ud800.",
  "Create a plan with a control \u0000.",
])("does not obtain ordinary caller intent from quoted, source, negated, protected or invalid text: %s", original => {
  expect(parseWorkProductRequest(original)).toBeUndefined();
});

it("keeps original whitespace, exact URL versions, limits and negation in the criterion", () => {
  const original = "  Give a checklist.\r\nUse https://example.org/v3/source?revision=2#limits; no production execution or guarantee.  ";
  const request = parseWorkProductRequest(original)!;
  expect(request.version).toBe(2);expect(request.criteria).toEqual([original]);
  expect(validWorkProductRequest(request, original)).toBe(true);
  expect(workProductRequestSchema.safeParse({ ...request, criteria: [original, "Invented extra criterion"] }).success).toBe(false);
  expect(workProductRequestSchema.safeParse({ ...request, extraAuthority: true }).success).toBe(false);
});

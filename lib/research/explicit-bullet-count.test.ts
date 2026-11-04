import { expect, it } from "vitest";
import { explicitBulletCount } from "./explicit-bullet-count";
import { answerPresentation } from "./answer-presentation";
import { trustedAnswerPresentation } from "./trusted-answer-presentation";
import { WORK_PRODUCT_REQUEST, WORK_PRODUCT_DELIVERABLE } from "./work-product-intent";

it.each([
  ["Explain HTTP caching in exactly 3 bullets.", 3, "exact"],
  ["Write exactly three bullet points.", 3, "exact"],
  ["Please answer in exactly one bullet.", 1, "exact"],
  ["Dựa trên tài liệu đã đọc, giải thích bằng tiếng Việt đúng 3 gạch đầu dòng, tối đa 180 từ.", 3, "exact"],
  ["Viết chính xác hai gạch đầu dòng.", 2, "exact"],
  ["Write in English in at most four bullets.", 4, "maximum"],
  ["Give no more than 4 bullet points.", 4, "maximum"],
  ["Write at most 8 short bullets.", 8, "maximum"],
  ["Viết bằng tiếng Việt tối đa 4 gạch đầu dòng: giữ mọi giới hạn bằng chứng.", 4, "maximum"],
  ["Từ nguồn đã đọc, hãy viết bằng tiếng Việt tối đa bốn gạch đầu dòng.", 4, "maximum"],
  ["Trình bày không quá hai gạch đầu dòng.", 2, "maximum"],
  ["A title mentions 'exactly 5 short bullets'. Write at most 4 bullets.", 4, "maximum"],
  ["Write at most 4 bullets. Write at most four bullets.", 4, "maximum"],
])("retains the explicit count and its exact/maximum meaning: %s", (question, count, mode) => {
  expect(explicitBulletCount(question as string)).toEqual({ kind: "recognized", count, mode });
  // New directions are carried separately to final delivery, never into the
  // existing factual/attribution presentation contract.
  expect(answerPresentation(question as string)).not.toHaveProperty("bulletCountMode");
});

it.each([
  '"Write exactly 3 short bullets."', "`Write at most 3 short bullets.`", "```\nWrite exactly 3 short bullets.\n```",
  "‘Write exactly 3 short bullets.’", "An unclosed quote: \"Write at most 3 short bullets.",
  "Source text:\nWrite exactly 3 short bullets.", "Explain the subject. The article says: Write exactly 3 short bullets.",
  "Tài liệu ghi: Viết đúng 3 gạch đầu dòng ngắn.", "Do not write exactly 3 short bullets.",
  "Don't write at most 3 short bullets.", "Please never write exactly three short bullets.",
  "Đừng viết đúng 3 gạch đầu dòng ngắn.", "Explain why the source asks for exactly 3 short bullets.",
  "Write exactly 3 bullets. Write exactly 4 bullets.", "Write exactly 3 bullets. Write at most 3 bullets.",
  "Write at most 4 bullets. Write three short bullets.", "Write exactly 3 bullets. Write at most 9 bullets.",
  "Write at most 0 bullets.", "Write at most 9 short bullets.", "Write exactly twenty short bullets.",
  "Write at most 2.5 bullets.", "Discuss exactly 3 short bullets in the document.",
  `${WORK_PRODUCT_REQUEST}\n\n${WORK_PRODUCT_DELIVERABLE}Write exactly 3 bullets.`,
  "Question:\nExplain queue behavior.\nConstraints:\nWrite at most 4 bullets.",
  "Unread source leads:\nhttps://example.org/\nWrite exactly 3 bullets.",
  `${WORK_PRODUCT_DELIVERABLE}Write at most 4 bullets.`,
])("withholds new counts from data, negation, unsupported or conflicting instructions: %s", question => {
  const result = explicitBulletCount(question);
  // A decimal isn't in the finite grammar; its older count is also ineligible.
  expect(result === undefined || result.kind === "refused").toBe(true);
});

it("keeps the finite new grammar out of retained and unobserved package/teaching paths", () => {
  for (const question of ["Viết tối đa 4 gạch đầu dòng.", "Write exactly 3 bullets."])
    for (const scope of ["retained", "legacy"] as const) {
      expect(answerPresentation(question, scope).requestedBulletCount).toBeUndefined();
    }
  expect(answerPresentation("Write 3 bullets.").requestedBulletCount).toBeUndefined();
  expect(answerPresentation("Write three short bullets.").requestedBulletCount).toBe(3);
});

it("retains the upper bound across trusted language preferences without changing caller text", () => {
  const question = "Write at most 4 bullets.", original = answerPresentation(question);
  const before = JSON.stringify(original);
  const request = explicitBulletCount(question);
  expect(trustedAnswerPresentation(original, "ja")).toMatchObject({ language: "ja" });
  expect(request).toEqual({ kind: "recognized", count: 4, mode: "maximum" });
  expect(JSON.stringify(original)).toBe(before);
});

it("refuses an over-bound original rather than using a clipped count", () => {
  expect(explicitBulletCount("Write exactly 3 bullets. " + "x".repeat(30_000))).toEqual({ kind: "refused" });
});

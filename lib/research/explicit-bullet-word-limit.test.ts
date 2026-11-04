import { expect, it } from "vitest";
import { explicitBulletWordLimit } from "./explicit-bullet-word-limit";

const recordedQuestion = "Tôi đang viết client HTTP có cache. Dựa trên tài liệu MDN chính thức về ETag và If-None-Match, giải thích bằng tiếng Việt đúng 3 gạch đầu dòng, tối đa 180 từ: ETag dùng để làm gì; khi nào GET với If-None-Match nhận 304 và client xử lý body thế nào; vì sao không được dùng weak ETag cho kiểm tra If-Match. Dẫn nguồn ở mỗi gạch đầu dòng và giữ nguyên tên header. Chỉ dùng nguồn miễn phí.";
it("recognizes the whole recorded Vietnamese caller request without inferring missing evidence", () => {
  expect(explicitBulletWordLimit(recordedQuestion, "vi")).toBe(180);
});
it.each([
  ["Write exactly 3 bullets, at most 180 words.", "en"],
  ["Write at most 3 bullets, no more than 180 words: explain the queue.", "en"],
  ["Write exactly three bullets. Keep the answer within 180 words.", "en"],
  ["Write exactly three bullets. Respond in at most 180 words.", "en"],
  ["Viết đúng ba gạch đầu dòng, không quá 180 từ.", "vi"],
  ["Trả lời bằng tiếng Việt tối đa 3 gạch đầu dòng. Hãy trả lời tối đa 180 từ.", "vi"],
  ["Viết đúng ba gạch đầu dòng, tối đa 180 từ. Trả lời tối đa 180 từ.", "vi"],
] as const)("accepts finite joint request %s", (question, language) => {
  expect(explicitBulletWordLimit(question, language)).toBe(180);
});
it.each([
  'Read "Write exactly 3 bullets, at most 180 words."',
  "`Write exactly 3 bullets, at most 180 words.`",
  "> Write exactly 3 bullets, at most 180 words.",
  "~~~text\nWrite exactly 3 bullets, at most 180 words.\n~~~",
  "~~~text\nWrite exactly 3 bullets, at most 180 words.",
  "```text\nWrite exactly 3 bullets, at most 180 words.\n```",
  "The source says: Write exactly 3 bullets, at most 180 words.",
  "Do not write exactly 3 bullets, at most 180 words.",
  "Write exactly 3 bullets. Do not\nkeep the answer within 180 words.",
  "Write exactly 3 bullets. Don't explicitly\nkeep the answer within 180 words.",
  "Write exactly 3 bullets. Don't ever\nkeep the answer within 180 words.",
  "Write exactly 3 bullets. Do not ever explicitly\nkeep the answer within 180 words.",
  "Write exactly 3 bullets, at most 180 words, excluding citations.",
  "Write exactly 3 bullets, at most 180 words. Keep the answer within 90 words.",
  "Write exactly 3 bullets, at most 0 words.",
  "Write exactly 3 bullets, at most 0180 words.",
  "Write exactly 3 bullets, at most 180.5 words.",
  "Write exactly 3 bullets, at most 2001 words.",
  "Write exactly 3 bullets, at least 180 words.",
  "Write exactly 3 bullets. The article has 180 words.",
  "Write three short bullets, at most 180 words.",
  "Write exactly 3 bullets, at most 180 words. Answer in German.",
  "Write exactly 3 bullets, at most 180 words. Write in French.",
])("refuses quoted, negated, conflicting or unsupported %s", question => {
  expect(explicitBulletWordLimit(question, "en")).toBeUndefined();
});
it.each([
  "Viết đúng 3 gạch đầu dòng. Đừng\ntrả lời tối đa 180 từ.",
  "Viết đúng 3 gạch đầu dòng. Đừng bao giờ\ntrả lời tối đa 180 từ.",
  "Viết đúng 3 gạch đầu dòng. Không bao giờ\ntrả lời tối đa 180 từ.",
  "Viết đúng 3 gạch đầu dòng, tối đa 180 từ, không tính trích dẫn.",
  "Nguồn nói: Viết đúng 3 gạch đầu dòng, tối đa 180 từ.",
])("refuses unsupported Vietnamese directives %s", question => {
  expect(explicitBulletWordLimit(question, "vi")).toBeUndefined();
});
it("does not infer a contract for other presentation languages or oversized requests", () => {
  expect(explicitBulletWordLimit("Write exactly 3 bullets, at most 180 words.", "fr")).toBeUndefined();
  expect(explicitBulletWordLimit(recordedQuestion + " ".repeat(30_000), "vi")).toBeUndefined();
});

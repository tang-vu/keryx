import { expect, it } from "vitest";
import retained from "../../scripts/fixtures/deliverable-teacher-public-c700-e719b085.json";
import type { TeachingProposalDelivery, TeachingProposalGap } from "./teaching-proposals";
import { parseTeachingProposalRequest } from "./teaching-proposals-request";
import { teachingProposalAnswer } from "./teaching-proposals-presentation";

function delivery(reason: TeachingProposalGap["reason"], language: "vi" | "en" = "vi"): TeachingProposalDelivery {
  return { version: 1, request: { ...parseTeachingProposalRequest(retained.question)!, language },
    proposals: [], admittedStatements: [], gaps: [{ reason }], explanationWords: 0, complete: false };
}

it.each(["missing-premise", "final-premise-withheld"] as const)("gives a bounded factual repair for %s without asserting a source fact", reason => {
  const answer = teachingProposalAnswer(delivery(reason));
  expect(answer).toContain("bằng chứng cuối cùng chưa đủ");
  expect(answer).toContain("các mục kiến thức còn thiếu ở phần trả lời trên với nguồn gốc bạn đã yêu cầu");
  expect(answer).toContain("tìm đoạn trực tiếp trả lời từng mục");
  expect(answer).toContain("tình huống giả định không thay thế bằng chứng");
  expect(answer).not.toContain("NASA");
  expect(answer).not.toContain("ngân sách");
  expect(answer).not.toContain("thử lại tự động");
});

it.each(["review-unavailable", "review-rejected", "invalid-proposals", "requested-count", "explanation-word-limit"] as const)(
  "does not misdiagnose %s as missing factual support", reason => {
    const answer = teachingProposalAnswer(delivery(reason));
    expect(answer).not.toContain("Thiếu kiến thức làm cơ sở:");
    expect(answer).not.toContain("tìm đoạn trực tiếp trả lời từng mục");
  });

it("gives English callers the same non-authorizing factual repair", () => {
  const answer = teachingProposalAnswer(delivery("final-premise-withheld", "en"));
  expect(answer).toContain("A factual prerequisite is missing:");
  expect(answer).toContain("the original source you requested");
  expect(answer).toContain("invented scenarios cannot replace evidence");
  expect(answer).not.toContain("NASA");
});

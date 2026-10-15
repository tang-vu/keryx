import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { applyEvidenceReview as applyReview } from "../llm/evidence-review";
import type { ProposedEvidence } from "../llm/reasoning-engine";
import type { QueryRun } from "../types";
import { finalizeAnswerLanguage, recordedAnswerLanguage, projectCompletedAnswerLanguage, readCompletedAnswerLanguage } from "./answer-language-provenance";
import { languageReviewedProposals, reviewedStatementLanguage } from "./answer-language-review";

const proposal: ProposedEvidence = { claimIndex: 0, marker: "S1", quote: "Original café\r\n“bytes” [S99]", support: 0.9, statement: "A bounded finding.", statementSupport: 1 };
const answer = "Một kết quả có giới hạn.\nOriginal café\r\n“bytes” [S99]";
const applyEvidenceReview = (rows: ProposedEvidence[], response: unknown, indexes?: ReadonlySet<number>) => applyReview(rows, response, indexes, true);
const run = (packet?: unknown) => ({ answer, trace: packet ? [{ phase: "done", ts: 0, message: "Done", detail: { answerLanguage: packet } }] : [] }) as QueryRun;

it.each(["en", "vi", "pt", "es"] as const)("projects only the existing %s packet bound to query and final bytes", language => {
  const packet = finalizeAnswerLanguage({ answer, rendererLanguage: language, statements: [], proposals: [] })!;
  const original = { ...run(packet), id: "completed-original" }, before = JSON.stringify(original);
  const projected = projectCompletedAnswerLanguage(original)!;
  expect(projected).toEqual({ ...packet, queryId: original.id });
  expect(readCompletedAnswerLanguage(projected, original.id, answer)).toEqual(projected);
  for (const invalid of [undefined, null, [], [projected, projected], { language },
    { ...projected, format: "future" }, { ...projected, queryId: "foreign" },
    { ...projected, humanApproved: true }, { ...projected, scope: "quotes" },
    { ...projected, language: "UNKNOWN" }, { ...projected, answerSha256: "0x00" }]) {
    expect(readCompletedAnswerLanguage(invalid, original.id, answer)).toBeUndefined();
  }
  expect(readCompletedAnswerLanguage(projected, "foreign", answer)).toBeUndefined();
  expect(readCompletedAnswerLanguage(projected, original.id, answer.normalize("NFD"))).toBeUndefined();
  expect(projectCompletedAnswerLanguage({ ...original, answer: answer + " " })).toBeUndefined();
  expect(projectCompletedAnswerLanguage({ ...original, trace: [...original.trace, ...original.trace] })).toBeUndefined();
  expect(projectCompletedAnswerLanguage({ ...original, trace: [] })).toBeUndefined();
  expect(JSON.stringify(original)).toBe(before);
});

it("does not grant authority to provider generation properties, clones or mutated rows", () => {
  expect(reviewedStatementLanguage({ ...proposal, statementLanguage: "vi" } as ProposedEvidence)).toBeUndefined();
  expect(reviewedStatementLanguage(applyReview([proposal], { reviews: [{ index: 0, support: 1, statementSupport: 1, statementLanguage: "vi" }] })[0])).toBeUndefined();
  const reviewed = applyEvidenceReview([proposal], { reviews: [{ index: 0, support: 0.8, statementSupport: 0.8, statementLanguage: "vi" }] });
  expect(reviewedStatementLanguage(reviewed[0])).toBe("vi");
  expect(reviewedStatementLanguage(structuredClone(reviewed[0]))).toBeUndefined();
  reviewed[0].statement += " Changed.";
  expect(reviewedStatementLanguage(reviewed[0])).toBeUndefined();
});

it("rejects missing, duplicate, excluded, mixed and unsupported language observations", () => {
  for (const statementLanguage of [undefined, "UNKNOWN", "pt-BR", "fr", { language: "vi" }]) {
    const reviewed = applyEvidenceReview([proposal], { reviews: [{ index: 0, support: 1, statementSupport: 1, statementLanguage }] });
    expect(languageReviewedProposals(reviewed, "vi")).toEqual([]);
    expect(reviewed[0].quote).toBe(proposal.quote);
    expect(reviewed[0].support).toBe(0.9);
  }
  const row = { index: 0, support: 1, statementSupport: 1, statementLanguage: "vi" };
  expect(reviewedStatementLanguage(applyEvidenceReview([proposal], { reviews: [row, row] })[0])).toBeUndefined();
  expect(reviewedStatementLanguage(applyEvidenceReview([proposal], { reviews: [row] }, new Set())[0])).toBeUndefined();
});

it.each(["en", "vi", "pt", "es"] as const)("binds %s observation and deterministic renderer to exact final UTF-8 bytes", language => {
  const proposals = applyEvidenceReview([proposal], { reviews: [{ index: 0, support: 1, statementSupport: 1, statementLanguage: language }] });
  const statements = [{ claimIndex: 0, marker: "S1", quote: proposal.quote, text: proposal.statement! }];
  const packet = finalizeAnswerLanguage({ answer, rendererLanguage: language, statements, proposals })!;
  expect(packet.answerSha256).toBe("0x" + createHash("sha256").update(answer, "utf8").digest("hex"));
  expect(recordedAnswerLanguage(run(packet))).toBe(language);
  expect(recordedAnswerLanguage({ ...run(packet), answer: answer.normalize("NFD") })).toBeUndefined();
  expect(finalizeAnswerLanguage({ answer, rendererLanguage: language === "vi" ? "en" : "vi", statements, proposals })).toBeUndefined();
});

it("keeps historical/changed/future/conflicting records unknown without question guessing", () => {
  expect(recordedAnswerLanguage(run())).toBeUndefined();
  const packet = finalizeAnswerLanguage({ answer, rendererLanguage: "vi", statements: [], proposals: [] })!;
  expect(recordedAnswerLanguage(run({ ...packet, humanApproved: true }))).toBeUndefined();
  expect(recordedAnswerLanguage(run({ ...packet, format: "future" }))).toBeUndefined();
  expect(recordedAnswerLanguage({ ...run(packet), trace: [...run(packet).trace, ...run(packet).trace] })).toBeUndefined();
  expect(recordedAnswerLanguage(run({ language: "vi" }))).toBeUndefined();
  expect(recordedAnswerLanguage(run({ ...packet, language: { toString: () => "vi" } }))).toBeUndefined();
  expect(recordedAnswerLanguage(run({ ...packet, method: { toString: () => "deterministic-renderer" } }))).toBeUndefined();
  expect(recordedAnswerLanguage({ ...run(), trace: [null, {}, { phase: "done", detail: [] }] } as unknown as QueryRun)).toBeUndefined();
});

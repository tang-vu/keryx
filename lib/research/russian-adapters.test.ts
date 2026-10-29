import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { recordedReportPreview } from "../i18n/recorded-report-preview";
import type { QueryRun } from "../types";
import { shippedUiLocales, preparedLocales } from "../i18n/locales";

const answer = "Сохранённый исходный ответ. “Original source {count} 1 source cited” [S1]";
function retained(): Pick<QueryRun, "answer" | "trace"> {
  return { answer, trace: [{ phase: "done", ts: 0, message: "Synthetic byte-bound recorded fixture", detail: {
    answerLanguage: { format: "keryx-answer-language-v1", scope: "generated-prose", language: "ru", method: "deterministic-renderer",
      answerSha256: "0x" + createHash("sha256").update(answer, "utf8").digest("hex") },
  } }] };
}

it.each([
  [0, "источников процитировано"], [1, "источник процитирован"], [2, "источника процитировано"],
  [4, "источника процитировано"], [5, "источников процитировано"], [11, "источников процитировано"],
  [21, "источник процитирован"], [22, "источника процитировано"], [25, "источников процитировано"],
] as const)("keeps correct recorded Russian count %s beside unchanged original and financial bytes", (count, label) => {
  const run = retained(), before = JSON.stringify(run), preview = recordedReportPreview(run);
  expect(preview.answerLanguage).toBe("ru");
  expect(preview.citedLabel(count)).toBe(label);
  const metadata = preview.metadataCopy({ count, historical: true, bibliographic: false, confidence: "Low",
    spent: "0.123456", creators: "0.000001", excerpt: answer });
  expect(metadata.description).toContain(`${count} ${label} · $0.123456 spent`);
  expect(metadata.description).toContain(answer);
  expect(metadata.description).toMatch(/^Arc testnet historical · Low confidence/);
  expect(metadata.openGraph).toContain("$0.123456 spent · $0.000001 to creators");
  expect(JSON.stringify(run)).toBe(before);
});

it("keeps Russian answer support separate from web UI enrollment and unchanged historical bytes", () => {
  expect(preparedLocales).not.toContain("ru");
  expect(shippedUiLocales).toEqual(["en"]);
  const run = retained();
  run.answer += " Changed.";
  expect(recordedReportPreview(run).answerLanguage).toBe("und");
  expect(recordedReportPreview(run).presentationLanguage).toBe("en");
});

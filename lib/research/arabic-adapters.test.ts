import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { recordedReportPreview } from "../i18n/recorded-report-preview";
import type { QueryRun } from "../types";
import { shippedUiLocales, preparedLocales } from "../i18n/locales";
import { formatAmount, formatSigningUsdc, selectPlural } from "../display/recorded-usdc.mjs";

const answer = "هذه إجابة أصلية محفوظة. “Original source {count} 1 source cited” [S1]";
function retained(): Pick<QueryRun, "answer" | "trace"> {
  return { answer, trace: [{ phase: "done", ts: 0, message: "Synthetic byte-bound recorded fixture", detail: {
    answerLanguage: { format: "keryx-answer-language-v1", scope: "generated-prose", language: "ar", method: "deterministic-renderer",
      answerSha256: "0x" + createHash("sha256").update(answer, "utf8").digest("hex") },
  } }] };
}

it.each([
  [0, "zero", "مصادر مستشهد بها"], [1, "one", "مصدر مستشهد به"], [2, "two", "مصدران مستشهد بهما"],
  [3, "few", "مصادر مستشهد بها"], [10, "few", "مصادر مستشهد بها"], [11, "many", "مصدرًا مستشهدًا به"],
  [99, "many", "مصدرًا مستشهدًا به"], [100, "other", "مصدر مستشهد به"], [101, "other", "مصدر مستشهد به"],
] as const)("keeps Arabic count %s beside exact source and financial bytes", (count, category, label) => {
  const run = retained(), before = JSON.stringify(run), preview = recordedReportPreview(run);
  expect(preview.answerLanguage).toBe("ar");
  expect(selectPlural(count, "ar")).toBe(category);
  expect(preview.citedLabel(count)).toBe(label);
  const metadata = preview.metadataCopy({ count, historical: true, bibliographic: false, confidence: "Low",
    spent: "0.123456", creators: "0.000001", excerpt: answer });
  expect(metadata.description).toContain(`${count} ${label} · $0.123456 spent`);
  expect(metadata.description).toContain(answer);
  expect(metadata.description).toMatch(/^Arc testnet historical · Low confidence/);
  expect(metadata.openGraph).toContain("$0.123456 spent · $0.000001 to creators");
  expect(JSON.stringify(run)).toBe(before);
});

it.each([1, 49, 1000001, 1234000001, "9007199254740991"])("keeps all recorded and signing digits for %s", micros => {
  expect(formatAmount(micros, { denomination: "USDC" }, "ar"))
    .toBe(formatAmount(micros, { denomination: "USDC" }, "en"));
  const signing = formatSigningUsdc(micros);
  expect(signing).toMatch(/^\d+\.\d{6} USDC$/u);
  expect(signing).not.toMatch(/[\u0600-\u06ff\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
});

it.each([undefined, null, "1.2", "01", "9007199254740992", -1, 0.1, NaN, -0])("refuses invalid exact Arabic display input %s", micros => {
  expect(formatAmount(micros, { denomination: "USDC" }, "ar")).toBe("Amount unavailable");
  expect(formatSigningUsdc(micros)).toBe("Amount unavailable");
});

it("keeps Arabic answer identity independent from UI enrollment and changed historical bytes", () => {
  expect(preparedLocales).not.toContain("ar");
  expect(shippedUiLocales).toEqual(["en"]);
  const run = retained();
  run.answer += " Changed.";
  expect(recordedReportPreview(run).answerLanguage).toBe("und");
  expect(recordedReportPreview(run).presentationLanguage).toBe("en");
});

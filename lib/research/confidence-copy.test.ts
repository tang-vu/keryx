import { describe, expect, it } from "vitest";
import { confidenceBanner, evidenceConfidenceReason, ordinaryConfidence } from "./confidence-copy";

describe("ordinary confidence copy", () => {
  it.each([
    ["en", "Low confidence", "Evidence assessment"],
    ["vi", "Độ tin cậy thấp", "Đánh giá bằng chứng"],
    ["pt", "Baixa confiança", "Avaliação das evidências"],
    ["es", "Confianza baja", "Evaluación de las evidencias"],
  ] as const)("uses %s throughout the notice without promoting the assessment", (language, label, assessmentLabel) => {
    const assessment = evidenceConfidenceReason(language, { kind: "incomplete" });
    for (const delivery of ["summary", "excerpts"] as const) {
      const verdict = ordinaryConfidence(language, delivery, assessment);
      expect(verdict.level).toBe("Low");
      expect(verdict.reason).toContain(`${assessmentLabel}: ${assessment}`);
      const before = JSON.stringify(verdict), original = "Exact admitted statement and original excerpt [S1].";
      expect(confidenceBanner(original, verdict, language)).toBe(`> ⚠ ${label} — ${verdict.reason}. ${language === "en" ? "Treat this as provisional." : language === "vi" ? "Kết quả chưa hoàn chỉnh." : language === "pt" ? "Trate este resultado como provisório." : "Trate este resultado como provisional."}\n\n${original}`);
      expect(JSON.stringify(verdict)).toBe(before);
    }
    const unavailable = ordinaryConfidence(language, "unavailable", assessment);
    expect(unavailable.level).toBe("Low");
    expect(unavailable.reason).not.toContain(assessmentLabel);
    expect(confidenceBanner("Kept", { level: "Moderate", reason: assessment }, language)).toBe("Kept");
  });

  it.each(["vi", "pt", "es"] as const)("keeps recorded counts and limitations in %s evidence rationales", language => {
    for (const kind of ["unresolved-conflict", "gaps", "publisher-groups", "limited-sources"] as const) {
      const localized = evidenceConfidenceReason(language, { kind, count: 3 });
      expect(localized).toContain("3");
      expect(localized).not.toBe(evidenceConfidenceReason("en", { kind, count: 3 }));
    }
    for (const kind of ["no-citation", "no-coverage", "incomplete", "explained-conflict"] as const)
      expect(evidenceConfidenceReason(language, { kind })).not.toBe(evidenceConfidenceReason("en", { kind }));
  });
});

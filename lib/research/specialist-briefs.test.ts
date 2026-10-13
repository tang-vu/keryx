import { describe, expect, it } from "vitest";
import { MAX_ASK_QUESTION_CHARS, parseAskQuestion } from "../ask-input";
import { SPECIALIST_BRIEF_IDS, prepareSpecialistBrief } from "./specialist-briefs";
import { a2aResearchPackageForVersion } from "../a2a/research-package-definition";

const input = () => ({ track: "api-platform", decision: "Compare API A and API B for our queue.",
  context: "TypeScript, one small team.", sourceLeads: ["https://example.org/docs"] });

describe("specialist request preparation", () => {
  it.each(SPECIALIST_BRIEF_IDS)("creates an existing-service request for %s without money or authority", track => {
    const result = prepareSpecialistBrief({ ...input(), track });
    expect(parseAskQuestion(result.request.question).success).toBe(true);
    expect(a2aResearchPackageForVersion("deep", result.request.packageVersion)).not.toBeNull();
    expect(result.request).not.toHaveProperty("budget");
    expect(result.request).not.toHaveProperty("payTo");
    expect(result.request.question).toContain("Unread source leads:");
    expect(result.acceptanceChecklist).toHaveLength(3);
  });
  it("preserves caller wording and labels leads without inventing read evidence", () => {
    const result = prepareSpecialistBrief({ ...input(), decision: "  Que choisir pour notre projet ?  " });
    expect(result.request.question).toContain("Question: Que choisir pour notre projet ?");
    expect(result.request.question).not.toContain("verified source");
  });
  it.each(["http://example.org", "javascript:alert(1)", "https://user:password@example.org/docs"])("refuses unsafe lead %s", lead => {
    expect(() => prepareSpecialistBrief({ ...input(), sourceLeads: [lead] })).toThrow();
  });
  it("refuses extra financial fields, unknown tracks and excess source scope", () => {
    expect(() => prepareSpecialistBrief({ ...input(), serviceFee: 3 })).toThrow();
    expect(() => prepareSpecialistBrief({ ...input(), track: "all" })).toThrow();
    expect(() => prepareSpecialistBrief({ ...input(), sourceLeads: Array(3).fill("https://example.org") })).toThrow();
  });
  it.each(SPECIALIST_BRIEF_IDS)("keeps the complete maximum accepted %s request inside the shared limit", track => {
    const result = prepareSpecialistBrief({ track, decision: "q".repeat(450), context: "c".repeat(250),
      sourceLeads: [`https://example.org/${"a".repeat(140)}`, `https://example.org/${"b".repeat(140)}`] });
    expect(result.request.question.length).toBeLessThanOrEqual(MAX_ASK_QUESTION_CHARS);
    expect(result.request.question).toContain("q".repeat(450));
  });
});

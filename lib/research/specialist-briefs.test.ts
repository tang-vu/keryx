import { describe, expect, it } from "vitest";
import { MAX_ASK_QUESTION_CHARS, parseAskQuestion } from "../ask-input";
import { SPECIALIST_BRIEF_IDS, prepareSpecialistBrief } from "./specialist-briefs";
import { a2aResearchPackageForVersion } from "../a2a/research-package-definition";

const input = () => ({ track: "api-platform", decision: "Compare API A and API B for our queue.",
  context: "TypeScript, one small team.", sourceLeads: ["https://example.org/docs"] });
const custom = () => ({ deliverable: "A source-backed checklist, with unverified actions separated.",
  reviewCriteria: ["Retain the exact version and conditions.", "Show missing inputs and proposals."] });
const forTrack = (track: string) => ({ ...input(), track, ...(track === "custom" ? custom() : {}) });

describe("specialist request preparation", () => {
  it.each(SPECIALIST_BRIEF_IDS)("creates an existing-service request for %s without money or authority", track => {
    const result = prepareSpecialistBrief(forTrack(track));
    expect(parseAskQuestion(result.request.question).success).toBe(true);
    expect(a2aResearchPackageForVersion("deep", result.request.packageVersion)).not.toBeNull();
    expect(result.request).not.toHaveProperty("budget");
    expect(result.request).not.toHaveProperty("payTo");
    expect(result.request.question).toContain("Unread source leads:");
    expect(result.acceptanceChecklist).toHaveLength(track === "custom" ? 2 : 3);
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
      ...(track === "custom" ? { deliverable: "d".repeat(160), reviewCriteria: ["a".repeat(100), "b".repeat(100), "c".repeat(100)] } : {}),
      sourceLeads: [`https://example.org/${"a".repeat(140)}`, `https://example.org/${"b".repeat(140)}`] });
    expect(result.request.question.length).toBeLessThanOrEqual(MAX_ASK_QUESTION_CHARS);
    expect(result.request.question).toContain("q".repeat(450));
  });
  it.each([
    ["Choose between SQLite and PostgreSQL for a small service.", "A decision table with backup and recovery gaps."],
    ["Investigate delayed webhook delivery for our integration.", "An investigation checklist; distinguish hypotheses from observed events."],
    ["Prepare activities for a lesson on the Moon.", "A lesson outline separating sourced facts and proposed activities."],
  ])("preserves the requested workflow beyond the preset topics: %s", (decision, deliverable) => {
    const result = prepareSpecialistBrief({ ...forTrack("custom"), decision, deliverable });
    expect(result.request.question).toContain(decision);
    expect(result.request.question).toContain(`Requested deliverable (caller request, not evidence): ${deliverable}`);
    expect(result.request.question).toContain("Caller review criteria (not findings or recorded acceptance):");
    for (const criterion of custom().reviewCriteria) expect(result.request.question).toContain(criterion);
    expect(result.acceptanceChecklist).toEqual(custom().reviewCriteria);
    expect(result.request.question).not.toContain("Prepare an API integration note.");
    expect(Object.keys(result.request).sort()).toEqual(["packageVersion", "question", "researchMode", "responseMode"]);
  });
  it.each([
    { deliverable: "" }, { deliverable: "d".repeat(161) }, { reviewCriteria: [] },
    { reviewCriteria: [" "] }, { reviewCriteria: ["a".repeat(101)] },
    { reviewCriteria: ["a", "b", "c", "d"] }, { reviewCriteria: "One string is not a checklist" },
    { acceptance: true }, { budget: 20 }, { payTo: "0x123" },
  ])("refuses invalid custom scope and authority fields: %j", change => {
    expect(() => prepareSpecialistBrief({ ...forTrack("custom"), ...change })).toThrow();
  });
  it("requires explicit custom output criteria and refuses them on a preset", () => {
    expect(() => prepareSpecialistBrief({ ...input(), track: "custom" })).toThrow();
    expect(() => prepareSpecialistBrief({ ...input(), ...custom() })).toThrow();
  });
});

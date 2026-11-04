import { describe, expect, it } from "vitest";
import { buildEvidenceLedger } from "./evidence-ledger";
import { finalizeGroundedAnswer } from "./answer-grounding";
import { selectCitedStatements } from "./cited-statements";
import { fixtureEvidenceSpans } from "../../test-support/evidence-fixtures";
import type { GatheredContent, ProposedEvidence } from "../llm/reasoning-engine";

const question = "Tôi viết client HTTP. Dựa trên tài liệu MDN chính thức về ETag, giải thích cách dùng và giữ nguyên tên header.";
const quote = "An entity tag identifies a particular representation version.";
function fixture(url: string | undefined, originalQuestion = question, extra: Partial<GatheredContent> = {}) {
  const source: GatheredContent = { sourceId: "source-one", sourceName: "MDN documentation", marker: "S1", text: quote, itemUrl: url, ...extra };
  const evidence = fixtureEvidenceSpans([source], [{ claimIndex: 0, marker: "S1", quote, support: 0.95,
    statement: "A representation version is identified by an entity tag.", statementSupport: 0.95 }]);
  const input = { question: originalQuestion, subClaims: ["What does an entity tag identify?"], gathered: [source],
    answer: "A representation version is identified by an entity tag [S1].", declaredMarkers: ["S1"], proposedEvidence: evidence,
    finalAssessment: [{ claim: "What does an entity tag identify?", coverage: 0.95, coveredBy: ["S1"] }] };
  return { input, evidence, source, ledger: buildEvidenceLedger(input) };
}
describe("named publisher eligibility and delivery", () => {
  it.each(["https://rednafi.com/http/etag/", undefined, "https://developer.mozilla.org.attacker.example/docs"])("drops an incompatible original from answer, coverage and rewards: %s", url => {
    const f = fixture(url); expect([...f.ledger.acceptedMarkers]).toEqual([]); expect(f.ledger.evidence).toEqual([]);
    expect(f.ledger.claimCoverage[0]).toMatchObject({ coverage: 0, coveredBy: [] }); expect(f.ledger.droppedEvidence).toBe(1);
    const statements = selectCitedStatements(f.evidence, f.ledger); expect(statements).toEqual([]);
    const answer = finalizeGroundedAnswer({ ...f.input, ledger: f.ledger, statements });
    expect(answer).not.toContain(quote); expect(answer).not.toContain("[S1]"); expect(answer).not.toContain(f.evidence[0].statement);
    expect(f.source.text).toBe(quote); expect(f.input.proposedEvidence).toEqual(f.evidence);
  });
  it("retains a matching eligible original without claiming semantic or publication truth", () => {
    const f = fixture("https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag");
    expect([...f.ledger.acceptedMarkers]).toEqual(["S1"]); expect(f.ledger.evidence[0]).toMatchObject({ qualifiesForAnswer: true, qualifiesForReward: true, support: 0.95 });
    expect(selectCitedStatements(f.evidence, f.ledger)).toHaveLength(1);
  });
  it("keeps public-reference no-reward status on the expected namespace", () => {
    const f = fixture("https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag", question, { sourceKind: "public-reference", publicDeliveryKind: "excerpt" });
    expect(f.ledger.evidence[0]).toMatchObject({ qualifiesForAnswer: true, qualifiesForReward: false });
  });
  it("cannot acquire a new publisher requirement from a model-created target", () => {
    const f = fixture("https://independent.example/article", "Explain entity tags.");
    f.input.subClaims = ["Use official MDN documentation to explain entity tags."];
    expect([...buildEvidenceLedger(f.input).acceptedMarkers]).toEqual(["S1"]);
  });
  it("keeps all existing span, support and final-assessment authorization refusals", () => {
    const f = fixture("https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag");
    for (const proposedEvidence of [[{ ...f.evidence[0], quoteSpan: undefined }], [{ ...f.evidence[0], support: 0.39 }], [{ ...f.evidence[0], quote: "A fabricated external statement.", quoteSpan: { start: 0, end: 30 } }]])
      expect([...buildEvidenceLedger({ ...f.input, proposedEvidence: proposedEvidence as ProposedEvidence[] }).acceptedMarkers]).toEqual([]);
    expect([...buildEvidenceLedger({ ...f.input, rewardAuthorizationAvailable: false }).acceptedMarkers]).toEqual([]);
  });
  it("an illustrative flag cannot bypass a caller's publisher requirement", () => {
    const f = fixture("https://independent.example/article");
    expect([...buildEvidenceLedger({ ...f.input, allowIllustrativeDemo: true }).acceptedMarkers]).toEqual([]);
  });
  it("preserves ordinary and clearly mixed-source behavior", () => {
    for (const request of ["Explain entity tags.", "Use official MDN docs. Then summarize user forum experiences."])
      expect([...fixture("https://independent.example/article", request).ledger.acceptedMarkers]).toEqual(["S1"]);
  });
});

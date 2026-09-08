import { describe, expect, it } from "vitest";
import { applyEvidenceReview } from "./evidence-review";
import { JsonChatEngine } from "./json-chat-engine";

const proposals = [{ claimIndex: 0, marker: "S1", quote: "A related procedure.", support: 0.8 }];
describe("evidence relevance review", () => {
  it("can lower but never increase original support", () => {
    expect(applyEvidenceReview(proposals, { reviews: [{ index: 0, support: 0.2 }] })[0].support).toBe(0.2);
    expect(applyEvidenceReview(proposals, { reviews: [{ index: 0, support: 1 }] })[0].support).toBe(0.8);
  });
  it.each([undefined, {}, { reviews: [] }, { reviews: [{ index: 99, support: 1 }] },
    { reviews: [{ index: 0, support: 1 }, { index: 0, support: 0.9 }] },
    { reviews: [{ index: 0, support: "1" }] }])("withholds support for missing or ambiguous review %j", (response) => {
    expect(applyEvidenceReview(proposals, response)[0].support).toBe(0);
  });
  it("does not let a review outside the bounded input authorize evidence", () => {
    const many = Array.from({ length: 33 }, () => proposals[0]);
    expect(applyEvidenceReview(many, { reviews: [{ index: 32, support: 1 }] })[32].support).toBe(0);
  });
  it("preserves the written answer when the reviewer fails, without authorizing rewards", async () => {
    class Engine extends JsonChatEngine {
      readonly name = "test";
      calls = 0;
      protected async chatJson() {
        if (++this.calls === 2) throw new Error("review timeout");
        return { answer: "A draft [S1].", citedMarkers: ["S1"], evidence: [{ claimIndex: 0, marker: "S1", quoteId: "q0_0", support: 1 }] };
      }
    }
    const engine = new Engine();
    const result = await engine.synthesize({ question: "What happens?", subClaims: ["What happens?"],
      gathered: [{ sourceId: "s1", sourceName: "Source", marker: "S1", text: "A source describes what happens." }] });
    expect(engine.calls).toBe(2);
    expect(result.answer).toBe("A draft [S1].");
    expect(result.evidenceReview).toBe("unavailable");
    expect(result.evidence[0].support).toBe(0);
  });
});

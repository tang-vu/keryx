import { expect, it } from "vitest";
import { buildEvidenceLedger } from "./evidence-ledger";
import { finalizeGroundedAnswer } from "./answer-grounding";
import type { GatheredContent } from "../llm/reasoning-engine";

// Short retained R09 excerpt: its occurrence does not make it evidence for Weng.
const quote = "CAVA receipts can remain local hash receipts, or they can be extended with stronger substrates:";
const requestedId = "2606.02668v1";
function read(itemUrl: string, extra: Partial<GatheredContent> = {}): GatheredContent {
  return { marker: "S1", sourceId: "paper", sourceName: "Original paper", sourceKind: "public-reference", itemUrl, text: quote, ...extra };
}
function ledger(source: GatheredContent, target = `What does arXiv ${requestedId} state about audit evidence?`) {
  return buildEvidenceLedger({ subClaims: [target], gathered: [source], answer: `${quote} [S1]`, declaredMarkers: ["S1"],
    proposedEvidence: [{ claimIndex: 0, marker: "S1", quote, support: 0.9 }],
    finalAssessment: [{ claim: target, coverage: 0.9, coveredBy: ["S1"] }] });
}

it("rejects the retained R09 CAVA HTML quote assigned to the Weng exact-paper target", () => {
  const result = ledger(read("https://arxiv.org/html/2607.13716v1"));
  expect(result.evidence).toEqual([]);
  expect(result.acceptedMarkers.size).toBe(0);
  expect(result.claimCoverage[0]).toMatchObject({ coverage: 0, coveredBy: [] });
  expect(result.droppedEvidence).toBe(1);
  expect(finalizeGroundedAnswer({ question: "Compare exact papers", answer: `${quote} [S1]`, ledger: result })).not.toContain(quote);
});

it.each(["abs", "pdf", "html"])("retains legitimate same-paper %s evidence and exact version", format => {
  const source = read(`https://arxiv.org/${format}/${requestedId}`);
  const result = ledger(source);
  expect(result.evidence[0]).toMatchObject({ qualifiesForAnswer: true, qualifiesForReward: false, itemUrl: source.itemUrl });
  expect(result.claimCoverage[0]).toMatchObject({ coverage: 0.9, coveredBy: ["S1"] });
  expect(ledger(read(`https://arxiv.org/${format}/2606.02668v2`)).evidence).toEqual([]);
  expect(ledger(read(`https://arxiv.org/${format}/2606.02668`)).evidence).toEqual([]);
  expect(ledger(source, `Methods in https://arxiv.org/${format}/${requestedId}`).evidence[0]?.qualifiesForAnswer).toBe(true);
});

it("accepts PDF suffixes and legacy exact identifiers without replacing their versions", () => {
  expect(ledger(read(`https://arxiv.org/pdf/${requestedId}.pdf`)).evidence[0]?.qualifiesForAnswer).toBe(true);
  expect(ledger(read("https://arxiv.org/pdf/hep-th/9901001v2.pdf"), "Methods in arXiv:hep-th/9901001v2").evidence[0]?.qualifiesForAnswer).toBe(true);
  expect(ledger(read("https://arxiv.org/pdf/hep-th/9901001v3.pdf"), "Methods in arXiv:hep-th/9901001v2").evidence).toEqual([]);
});

it.each(["hep-th/9901001v2", "math.GT/0307245v1"])("binds a bare legacy target %s to the exact observed original", id => {
  const target = `Methods in ${id}`;
  expect(ledger(read(`https://arxiv.org/pdf/${id}`), target).evidence[0]?.qualifiesForAnswer).toBe(true);
  expect(ledger(read(`https://arxiv.org/pdf/${id.replace(/v\d+$/, "v9")}`), target).evidence).toEqual([]);
  expect(ledger(read(`https://arxiv.org/pdf/${requestedId}`), target).evidence).toEqual([]);
});

it("retains exact-paper rejection for unspaced explicit arXiv prefixes", () => {
  for (const id of [requestedId, "hep-th/9901001v2"]) {
    const target = `Methods in arXiv${id}`;
    expect(ledger(read(`https://arxiv.org/pdf/${id}`), target).evidence[0]?.qualifiesForAnswer).toBe(true);
    expect(ledger(read("https://arxiv.org/html/2607.13716v1"), target).evidence).toEqual([]);
  }
});

it.each([
  "https://arxiv.org/html/2607.13716v1?paper=arxiv:2606.02668v1",
  "https://arxiv.org/html/2607.13716v1#https://arxiv.org/abs/2606.02668v1",
  "https://arxiv.org/html/2606.02668?paper=arxiv:2606.02668v1",
  "https://arxiv.org/html/2606.02668v1.other", "https://arxiv.org/html/2606.02668v1/appendix",
  "https://arxiv.org/html/2606.02668v1.pdf", "https://arxiv.org/abs/2606.02668v0",
  "https://arxiv.org.evil.example/html/2606.02668v1", "https://arxiv.org@evil.example/html/2606.02668v1",
  "https://evil.example/?url=https://arxiv.org/abs/2606.02668v1",
  "https://arxiv.org:444/html/2606.02668v1", "http://arxiv.org/html/2606.02668v1",
  "https://name:password@arxiv.org/html/2606.02668v1", "https://arxiv.org/html/%32%36%30%36.02668v1",
  "https://arxiv.org/html/2606.02668v1%2Fextra", "arxiv:2606.02668v1", "",
])("cannot admit an unknown, spoofed or mismatching original URL %s through discovery metadata", itemUrl => {
  const result = ledger(read(itemUrl, { itemTitle: `arXiv ${requestedId}`, scholarly: { provider: "arxiv", arxivId: requestedId,
    recordUrl: "https://export.arxiv.org/api/query", retrievedAt: "2026-10-04", title: `arXiv ${requestedId}`, authors: [], workType: "preprint", peerReview: "unknown" } }));
  expect(result.evidence).toEqual([]);
  expect(result.acceptedMarkers.size).toBe(0);
});

it("never uses absent-URL metadata, title or body references as original-document identity", () => {
  const source = read(`https://arxiv.org/pdf/${requestedId}`, { itemTitle: `arXiv ${requestedId}`, text: `${quote} arXiv ${requestedId}`,
    scholarly: { provider: "arxiv", arxivId: requestedId, recordUrl: "https://export.arxiv.org/api/query", retrievedAt: "2026-10-04", title: "Paper", authors: [], workType: "preprint", peerReview: "unknown" } });
  delete source.itemUrl;
  expect(ledger(source).evidence).toEqual([]);
});

it("takes identity from the observed URL path and preserves non-paper evidence policy", () => {
  expect(ledger(read(`https://arxiv.org/html/${requestedId}?other=arxiv:2607.13716v1#appendix`)).evidence[0]?.qualifiesForAnswer).toBe(true);
  const secondary = read("https://publisher.example/article");
  expect(ledger(secondary, "What does the supplied source say about audit evidence?").evidence[0]?.qualifiesForAnswer).toBe(true);
});

it("cannot authorize a creator reward for wrong-paper or unknown-version evidence", () => {
  for (const itemUrl of ["https://arxiv.org/html/2607.13716v1", "https://arxiv.org/html/2606.02668"]) {
    const result = ledger(read(itemUrl, { sourceKind: undefined }));
    expect(result.evidence.some(item => item.qualifiesForReward)).toBe(false);
    expect(result.claimCoverage[0].coveredBy).toEqual([]);
  }
});

it("does not let a marker admitted for its own paper qualify a different paper's target", () => {
  const subClaims = [`Audit evidence in arXiv:${requestedId}`, "Audit evidence in arXiv:2607.13716v1"];
  const result = buildEvidenceLedger({ subClaims, gathered: [read("https://arxiv.org/html/2607.13716v1")],
    answer: `Both papers [S1].`, declaredMarkers: ["S1"],
    proposedEvidence: subClaims.map((_, claimIndex) => ({ claimIndex, marker: "S1", quote, support: 0.9 })),
    finalAssessment: subClaims.map(claim => ({ claim, coverage: 0.9, coveredBy: ["S1"] })) });
  expect(result.acceptedMarkers.has("S1")).toBe(true);
  expect(result.evidence.map(item => item.claimIndex)).toEqual([1]);
  expect(result.claimCoverage[0]).toMatchObject({ coverage: 0, coveredBy: [] });
  const answer = finalizeGroundedAnswer({ question: "Compare papers", answer: "Both papers [S1].", ledger: result });
  expect(answer.split("### Research target 2")[0]).not.toContain(quote);
  expect(answer.split("### Research target 2")[1]).toContain(quote);
});

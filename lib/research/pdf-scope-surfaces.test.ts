import { expect, it } from "vitest";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { surfaceResearch } from "./surface-result";
import { gatheredArticle } from "../web-research/article-reader";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import type { QueryRun } from "../types";

it("carries original PDF scope through the real evidence ledger, API/MCP projection and integrity-bound receipt without a payment", () => {
  const quote = "This original page reports only the observed experiment.";
  const scope = { format: "keryx-pdf-text-scope-v1" as const, pagesRead: 3, totalPages: 3, pagesWithoutText: [2], textLimitReached: false };
  const gathered = { ...gatheredArticle("public:pdf", { text: quote, title: "Original PDF", finalUrl: "https://example.org/original.pdf",
    kind: "pdf", truncated: false, pdfTextScope: scope }), marker: "S1" };
  expect(gathered.webProvenance?.truncated).toBe(false);
  const ledger = buildEvidenceLedger({ question: "What was read?", subClaims: ["Observed experiment"], gathered: [gathered],
    answer: "The observed result is bounded [S1].", declaredMarkers: ["S1"],
    proposedEvidence: [{ claimIndex: 0, marker: "S1", quote, quoteSpan: { start: 0, end: quote.length }, support: 0.8 }] });
  expect(ledger.evidence[0].webProvenance?.pdfTextScope).toEqual(scope);
  expect(ledger.evidence[0].qualifiesForAnswer).toBe(true); expect(ledger.evidence[0].qualifiesForReward).toBe(false);
  const run: QueryRun = { id: "pdf-scope-fixture", question: "What was read?", budget: 0.05, engine: "isolated-fixture",
    subClaims: ["Observed experiment"], answer: "The observed result is bounded [S1].", decisions: [],
    citations: [{ ...gathered, weight: 1, reward: 0, rationale: "Observed public text only" }],
    evidence: ledger.evidence, claimCoverage: ledger.claimCoverage, totalSpent: 0, totalToCreators: 0,
    trace: [], createdAt: "2026-10-22T00:00:00.000Z", paymentMode: "offline" };
  const projected = surfaceResearch(run);
  expect(projected.citations[0].webProvenance?.pdfTextScope).toEqual(scope);
  expect(projected.evidence[0].webProvenance?.pdfTextScope).toEqual(scope);
  const receipt = buildResearchReceipt(run, []), original = JSON.stringify(receipt);
  expect(receipt.payload.citations[0].webProvenance?.pdfTextScope).toEqual(scope);
  expect(receipt.payload.claims[0].evidence[0].webProvenance?.pdfTextScope).toEqual(scope);
  expect(verifyResearchReceipt(JSON.parse(original)).valid).toBe(true);
  gathered.webProvenance!.pdfTextScope!.pagesWithoutText[0] = 1;
  expect(JSON.stringify(receipt)).toBe(original);
  expect(projected.citations[0].webProvenance?.pdfTextScope?.pagesWithoutText).toEqual([2]);
  expect(verifyResearchReceipt(receipt).valid).toBe(true);
  const changed = JSON.parse(original); changed.payload.citations[0].webProvenance.pdfTextScope.pagesWithoutText = [1];
  expect(verifyResearchReceipt(changed).valid).toBe(false);
});

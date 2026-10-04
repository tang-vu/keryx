import { expect, it } from "vitest";
import { buildEvidenceLedger } from "./evidence-ledger";
import type { GatheredContent, ProposedEvidence } from "../llm/reasoning-engine";

// Synthetic examples model the retained client failure shape. These are not a
// reconstruction of the original read text, whose offsets were not retained.
const quote = "Copying a live database requires a consistent snapshot.";
const source: GatheredContent = { marker: "S1", sourceId: "owned", sourceName: "Example", text: quote };
const proposal: ProposedEvidence = { marker: "S1", claimIndex: 0, quote, support: 1,
  quoteSpan: { start: 0, end: quote.length } };
function ledger(read = source, row = proposal, question = "Explain backups.", claim = "Backup consistency") {
  return buildEvidenceLedger({ question, subClaims: [claim], gathered: [read], answer: "Safe copying [S1].",
    declaredMarkers: ["S1"], proposedEvidence: [row], finalAssessment: [{ claim, coverage: 1, coveredBy: ["S1"] }] });
}

it.each([undefined, { start: 1, end: quote.length }, { start: 0, end: quote.length + 1 },
  { start: NaN, end: quote.length }, { start: 0.5, end: quote.length }])("rejects missing or invalid source span %j despite optimistic support", quoteSpan => {
  const result = ledger(source, { ...proposal, quoteSpan });
  expect(result.evidence).toEqual([]);
  expect(result.acceptedMarkers.size).toBe(0);
  expect(result.claimCoverage[0].coverage).toBe(0);
});

it("rejects a mid-sentence excerpt even if it is exact and includes terminal punctuation", () => {
  const prefix = "Only after closing every writer, ";
  const read = { ...source, text: prefix + quote };
  expect(ledger(read, { ...proposal, quoteSpan: { start: prefix.length, end: read.text.length } }).evidence).toEqual([]);
});

it("rejects the incomplete final fragment and a truncated extraction edge", () => {
  const fragment = "The reader must make a completely";
  expect(ledger({ ...source, text: fragment }, { ...proposal, quote: fragment,
    quoteSpan: { start: 0, end: fragment.length } }).evidence).toEqual([]);
  const truncated = { ...source, webProvenance: { retrievedAt: "2026-10-05", publisherGroup: "example.org",
    normalizedBodyHash: "synthetic", extraction: "html" as const, truncated: true } };
  expect(ledger(truncated).evidence).toEqual([]);
});

it("withholds forum evidence and rewards for an explicit document request on either original question or target", () => {
  const read = { ...source, itemUrl: "https://sqlite.org/forum/info/example" };
  for (const [question, claim] of [["Use official SQLite documentation to explain backups.", "Backup consistency"],
    ["Explain backups.", "Use official SQLite documentation to explain consistency."]]) {
    const result = ledger(read, proposal, question, claim);
    expect(result.evidence).toEqual([]);
    expect(result.claimCoverage[0].coveredBy).toEqual([]);
  }
  expect(ledger(read).evidence[0]?.qualifiesForReward).toBe(true);
});

it("does not expose private source offsets or context in the public ledger", () => {
  const result = ledger();
  expect(result.evidence[0]?.qualifiesForReward).toBe(true);
  expect(result.evidence[0]).not.toHaveProperty("quoteSpan");
  expect(result.evidence[0]).not.toHaveProperty("context");
});

import { describe, expect, it } from "vitest";
import { buildOriginalFulfillmentQualityReviewInput } from "./original-fulfillment-review-input";
import { buildEvidenceReviewInput } from "./evidence-review-input";
import { enrollSupplementalSpans } from "./supplemental-span-capability";
import type { GatheredContent, ProposedEvidence } from "./reasoning-engine";
import type { QuoteOption } from "./quote-options";
import { qualityStatements, qualityTargets } from "./original-fulfillment-quality-fixture";

function fixture() {
  const statements = qualityStatements();
  const gathered: GatheredContent[] = ["S1", "S2", "S3", "S4"].map(marker => ({ marker, sourceId: `synthetic:${marker}`,
    sourceName: `Synthetic ${marker}`, text: statements.filter(row => row.marker === marker).map(row => row.quote).join("\n\n"),
    sourceKind: "public-reference", creatorRewardEligible: false }));
  const options: QuoteOption[] = statements.map((row, index) => {
    const source = gathered.find(source => source.marker === row.marker)!;
    const start = source.text.indexOf(row.quote), end = start + row.quote.length;
    const contextStart = Math.max(0, start - 400), contextEnd = Math.min(source.text.length, end + 400);
    return { quoteId: `synthetic-${index}`, marker: row.marker, text: row.quote, start, end,
      sourceId: source.sourceId, contextStart, contextEnd, context: source.text.slice(contextStart, contextEnd),
      prefixOmitted: contextStart > 0, suffixOmitted: contextEnd < source.text.length };
  });
  const proposals: ProposedEvidence[] = statements.map((row, index) => ({ claimIndex: row.claimIndex, marker: row.marker,
    quote: row.quote, quoteSpan: { start: options[index].start, end: options[index].end }, support: 0.9, statement: row.text }));
  const supplementalCapability = enrollSupplementalSpans(gathered, options, () => {});
  return { proposals, options, gathered, subClaims: qualityTargets, supplementalCapability };
}
describe("private full-source independent review transport", () => {
  it("keeps every source and row once without dropping bindings to fit the same 32k ceiling", () => {
    const input = fixture(), output = buildOriginalFulfillmentQualityReviewInput(input), packet = JSON.parse(output.json);
    expect(output.reviewedIndexes.size).toBe(29);
    expect(packet.evidence.map((row: { index: number }) => row.index)).toEqual(Array.from({ length: 29 }, (_, index) => index));
    expect(packet.sources).toHaveLength(4);
    expect(packet.researchTargets).toEqual(qualityTargets.map((question, claimIndex) => ({ claimIndex, question })));
    for (const row of packet.evidence) {
      expect(row).not.toHaveProperty("question");
      expect(packet.researchTargets.find((target: { claimIndex: number }) => target.claimIndex === row.claimIndex).question)
        .toBe(input.subClaims[input.proposals[row.index].claimIndex]);
    }
    for (const source of input.gathered) expect(packet.sources.find((row: { marker: string }) => row.marker === source.marker).context.text).toBe(source.text);
    expect(packet.evidence.every((row: { sourceRef: string }) => packet.sources.some((source: { marker: string }) => source.marker === row.sourceRef))).toBe(true);
    expect(Buffer.byteLength(output.json)).toBeLessThan(32000);
    expect(packet.schema).toContain("statementSupport");
    // The ordinary packet retains its own historical bounded omission behavior.
    expect(JSON.parse(buildEvidenceReviewInput(input).json)).not.toHaveProperty("sources");
  });
  it.each(["quote", "offset", "context", "source-identity", "capability", "target-index"])("refuses the entire private packet on %s drift", mutation => {
    const input = fixture();
    if (mutation === "quote") input.proposals[0].quote += " Unstated guarantee.";
    if (mutation === "offset") input.proposals[0].quoteSpan!.start++;
    if (mutation === "context") input.options[0].context += " Added text.";
    if (mutation === "source-identity") input.options[0].sourceId = "another-source";
    if (mutation === "capability") input.supplementalCapability = {} as typeof input.supplementalCapability;
    if (mutation === "target-index") input.proposals[0].claimIndex = 5;
    expect(() => buildOriginalFulfillmentQualityReviewInput(input)).toThrow(/incomplete review binding/);
  });
  it("transports all29 bounded statements and every target once without truncation", () => {
    const input = fixture();
    for (const proposal of input.proposals) proposal.statement = "x".repeat(240);
    const output = buildOriginalFulfillmentQualityReviewInput(input), packet = JSON.parse(output.json);
    expect(output.reviewedIndexes.size).toBe(29);
    expect(packet.evidence.every((row: { statement: string }) => row.statement === "x".repeat(240))).toBe(true);
    expect(packet.researchTargets).toHaveLength(5);
  });
  it("refuses full-body overflow rather than slicing a source or removing a requested row", () => {
    const input = fixture(); input.gathered[0].text += "x".repeat(32000);
    for (const option of input.options.filter(option => option.marker === "S1")) option.suffixOmitted = true;
    input.supplementalCapability = enrollSupplementalSpans(input.gathered, input.options, () => {});
    expect(() => buildOriginalFulfillmentQualityReviewInput(input)).toThrow(/input bound exceeded/);
  });
});

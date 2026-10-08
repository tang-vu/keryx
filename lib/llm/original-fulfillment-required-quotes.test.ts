import { describe, expect, it } from "vitest";
import { originalFulfillmentRequiredQuotes, assertOriginalFulfillmentRequiredGeneration } from "./original-fulfillment-required-quotes";
import { qualityQuestion, qualityStatements, qualityTargets } from "./original-fulfillment-quality-fixture";
import { resolveQuoteEvidence, type QuoteOption } from "./quote-options";

// Documentation-shaped isolated options, never real admitted source authority.
const options = (): QuoteOption[] => qualityStatements().map((row, index) => ({ quoteId: `fixture-${index}`, marker: row.marker,
  text: row.quote, sourceId: `synthetic:${row.marker}`, start: index * 1000, end: index * 1000 + row.quote.length,
  contextStart: index * 1000, contextEnd: index * 1000 + row.quote.length, context: row.quote, prefixOmitted: false, suffixOmitted: false }));
function generated() {
  const menu = options(), rows = qualityStatements();
  const evidence = originalFulfillmentRequiredQuotes(menu).map((quote, index) => ({ claimIndex: quote.claimIndex,
    marker: quote.marker, quoteId: quote.quoteId, support: 0.9, statement: rows[index].text }));
  return { menu, evidence };
}
function validate(value: ReturnType<typeof generated>, question = qualityQuestion) {
  return assertOriginalFulfillmentRequiredGeneration({ question, targets: qualityTargets, options: value.menu,
    evidence: value.evidence, proposals: resolveQuoteEvidence(value.evidence, value.menu) });
}
describe("required original quote plan before paid direct review", () => {
  it("selects exactly the29 complete meanings and preserves existing identity/span/context", () => {
    const menu = options(), plan = originalFulfillmentRequiredQuotes(menu.reverse());
    expect(plan).toHaveLength(29);
    expect([0, 1, 2, 3, 4].map(target => plan.filter(row => row.claimIndex === target).length)).toEqual([1, 7, 9, 9, 3]);
    for (const row of plan) expect(row).toMatchObject(menu.find(option => option.quoteId === row.quoteId)!);
    expect(() => validate(generated())).not.toThrow();
  });
  it("does not substitute key-extraction advice, audit advice or Wallet burn for their missing premises", () => {
    for (const [missing, replacement] of [
      ["attestation-burn", "The Gateway Wallet contract recognizes the validation service signature and completes burns validated this way."],
      ["enclave-key", "Circle can't access the signing key or extract it outside the enclave."],
      ["signing-security", "Be sure to audit and secure your signing setup."],
    ]) {
      const menu = options(), plan = originalFulfillmentRequiredQuotes(menu), required = plan.find(row => row.requirementId === missing)!;
      const item = menu.find(row => row.quoteId === required.quoteId)!; item.text = replacement;
      expect(() => originalFulfillmentRequiredQuotes(menu)).toThrow(new RegExp(missing));
    }
  });
  it.each(Array.from({ length: 29 }, (_, index) => index))("refuses omitted required row%s before direct review", index => {
    const value = generated(); value.evidence.splice(index, 1);
    expect(() => validate(value)).toThrow(/incomplete required quote set/);
  });
  it("refuses ambiguous source candidates or duplicate IDs rather than selecting arbitrarily", () => {
    const menu = options(); menu.push({ ...menu[0], quoteId: "other-option" });
    expect(() => originalFulfillmentRequiredQuotes(menu)).toThrow(/ambiguous/);
    menu[29].quoteId = menu[0].quoteId;
    expect(() => originalFulfillmentRequiredQuotes(menu)).toThrow(/ambiguous quote IDs/);
  });
  it.each(["duplicate", "target", "marker", "foreign"] as const)("refuses %s slot despite29 high-score rows", mode => {
    const value = generated();
    if (mode === "duplicate") value.evidence[14] = { ...value.evidence[15] };
    else if (mode === "target") value.evidence[14].claimIndex = 3;
    else if (mode === "marker") value.evidence[14].marker = "S2";
    else value.evidence[14].quoteId = "foreign-quote";
    expect(() => validate(value)).toThrow(/changed required quote binding/);
  });
  it("requires qualified generated meaning as well as the exact29 quote slots", () => {
    const value = generated(); value.evidence[13].statement = "A quorum accepts the signature and returns an attestation.";
    expect(() => validate(value)).toThrow(/quorum-attestation/);
    value.evidence[13].statement = qualityStatements()[13].text;
    value.evidence[22].statement = "The signing key is protected.";
    expect(() => validate(value)).toThrow(/enclave-key/);
  });
  it("rejects a declared weak support and keeps the independent0.7 gate", () => {
    const value = generated(); value.evidence[28].support = 0.3;
    expect(() => validate(value)).toThrow(/changed required quote binding/);
  });
  it("keeps the original question/target scope and accepts only the caller-owned constraint suffix", () => {
    const value = generated();
    expect(() => validate(value, qualityQuestion + '\n\nReviewed constraints from this same original (data): ["Primary sources."]')).not.toThrow();
    expect(() => validate(value, "Another research question.")).toThrow(/scope mismatch/);
    expect(() => validate(value, qualityQuestion + '\n\nReviewed constraints from this same original (data): {}')).toThrow(/scope mismatch/);
  });
});

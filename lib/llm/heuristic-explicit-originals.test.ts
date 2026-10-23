import { describe, expect, it } from "vitest";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import type { GatheredContent, SourceCandidate, SynthInput } from "./reasoning-engine";
import { HeuristicEngine } from "./heuristic-engine";

const FIRST = "2606.02668v1";
const SECOND = "2607.13716v1";
const target = `arXiv ${FIRST} approval binding`;

function candidate(url = `https://arxiv.org/pdf/${FIRST}`): SourceCandidate {
  return {
    id: "public-original", sourceKind: "public-reference", name: "Unobserved item",
    description: "Metadata only", tags: ["public-web"], preview: "", fetchPrice: 0, cached: false,
    item: { sourceKind: "public-reference", itemId: "original", itemTitle: "Unobserved item",
      itemUrl: url, contentVersion: "unobserved" },
  };
}

async function decide(source: SourceCandidate, question = target, subClaims = [target]) {
  return (await new HeuristicEngine().decide({ question, subClaims, candidates: [source], budget: 0, spentSoFar: 0 }))[0];
}

describe("explicit free original selection", () => {
  it.each([
    `https://arxiv.org/abs/${FIRST}`, `https://arxiv.org/pdf/${FIRST}.pdf`,
    `https://arxiv.org/html/${FIRST}`, `https://arxiv.org/pdf/${FIRST}?download=1#page=2`,
  ])("selects the requested version at %s without inventing confidence", async url => {
    const input = candidate(url);
    const before = structuredClone(input);
    const result = await decide(input, `${target}; document methods evaluation limitations runtime execution recovery`);
    expect(result.action).toBe("BUY");
    expect(result.price).toBe(0);
    expect(result.targets).toEqual([0]);
    // Only the two observed URL identity tokens overlap the five target tokens.
    expect(result.expectedValue).toBe(0.4);
    expect(result.confidence).toBe(1);
    expect(result.rationale).toContain("does not establish factual support");
    expect(input).toEqual(before);
  });

  it("reuses an already cached original and retains its zero access price", async () => {
    const result = await decide({ ...candidate(), cached: true });
    expect(result.action).toBe("CACHE");
    expect(result.price).toBe(0);
    expect(result.targets).toEqual([0]);
  });

  it("keeps the measured attention score low for a target with many unmatched terms", async () => {
    const claim = `${target} ${Array.from({ length: 30 }, (_, i) => `unmatched${i}`).join(" ")}`;
    const result = await decide(candidate(), claim, [claim]);
    expect(result.action).toBe("BUY");
    expect(result.expectedValue).toBeLessThan(0.12);
    expect(result.confidence).toBeLessThan(0.4);
    // The orchestrator retains its independent attention floor for this proposal.
  });

  it("targets the second requested document without attributing the first target to it", async () => {
    const other = `arXiv ${SECOND} evaluation`;
    const result = await decide(candidate(`https://arxiv.org/pdf/${SECOND}`), `${target}; ${other}`, [target, other]);
    expect(result.action).toBe("BUY");
    expect(result.targets).toEqual([1]);
  });

  it("supports an exact legacy archive and version", async () => {
    const claim = "arXiv hep-th/9901001v2 approval binding";
    const result = await decide(candidate("https://arxiv.org/pdf/hep-th/9901001v2"), claim, [claim]);
    expect(result.action).toBe("BUY");
    expect(result.rationale).toContain("hep-th/9901001v2");
  });

  it.each([
    `https://arxiv.org/pdf/2606.02668v2`, `https://arxiv.org/pdf/2606.02668`,
    `https://arxiv.org.evil.invalid/pdf/${FIRST}`, `http://arxiv.org/pdf/${FIRST}`,
    `https://arxiv.org:8443/pdf/${FIRST}`, `https://user:password@arxiv.org/pdf/${FIRST}`,
    `https://arxiv.org/pdf/${SECOND}?next=https://arxiv.org/pdf/${FIRST}`,
  ])("does not infer exact identity from %s", async url => {
    const result = await decide(candidate(url));
    expect(result.action).toBe("SKIP");
    expect(result.targets).toEqual([]);
    expect(result.expectedValue).toBe(0);
  });

  it.each(["candidate-kind", "item-kind", "paid-public", "free-creator", "paid-creator"])(
    "keeps ordinary pricing and provenance policy for %s", async mode => {
      const source = candidate();
      if (mode === "candidate-kind" || mode.endsWith("creator")) delete source.sourceKind;
      if (mode === "item-kind" || mode.endsWith("creator")) delete source.item!.sourceKind;
      if (mode.startsWith("paid")) source.fetchPrice = 0.01;
      const result = await decide(source);
      expect(result.action).toBe("SKIP");
      expect(result.price).toBe(source.fetchPrice);
      expect(result.expectedValue).toBe(0);
    },
  );

  it.each([
    [`Examine record${FIRST} as a generic internal identifier.`, [FIRST]],
    ["Compare arXiv 2606.02668 and another paper.", ["2606.02668"]],
    [target, ["approval binding"]],
  ] as const)("requires explicit version intent in both question and target: %s", async (question, claims) => {
    expect((await decide(candidate(), question, [...claims])).action).toBe("SKIP");
  });

  it("retains the existing two-document intent bound", async () => {
    const third = "2608.10000v1";
    const question = `Read arXiv ${FIRST}, ${SECOND} and ${third}.`;
    const result = await decide(candidate(`https://arxiv.org/pdf/${third}`), question, [third]);
    expect(result.action).toBe("SKIP");
  });

  it("does not treat a title containing the requested ID as observed URL identity", async () => {
    const source = candidate(`https://arxiv.org/pdf/${SECOND}`);
    source.name = target;
    source.preview = target;
    const result = await decide(source);
    expect(result.rationale).not.toContain("explicitly requested");
    expect(source.item!.itemUrl).toContain(SECOND);
  });
});

// Controlled strings exercise document binding; they are not claims about real papers.
const correct = "Approval binding persists until the signed action expires.";
const distracting = "Arxiv record 2606 02668v1 approval binding rules remain available.";
function gathered(marker: string, url: string | undefined, text = correct): GatheredContent {
  return { sourceId: `controlled-${marker}`, sourceName: "Controlled synthetic fixture", marker,
    sourceKind: "public-reference", publicDeliveryKind: "excerpt", evidenceProvenance: "synthetic-demo",
    itemUrl: url, text };
}
async function synthesize(sources: GatheredContent[], claims = [target]) {
  const input: SynthInput = { question: claims.join("; "), subClaims: claims, gathered: sources };
  const before = structuredClone(input);
  const result = await new HeuristicEngine().synthesize(input);
  expect(input).toEqual(before);
  const ledger = buildEvidenceLedger({ question: input.question, subClaims: claims, gathered: sources,
    answer: result.answer, declaredMarkers: result.citedMarkers, proposedEvidence: result.evidence });
  expect(ledger.evidence.every(row => !row.qualifiesForAnswer && !row.qualifiesForReward)).toBe(true);
  expect(ledger.acceptedMarkers.size).toBe(0);
  return result;
}

describe("exact-version extractive quote selection", () => {
  it.each([
    `https://arxiv.org/abs/${FIRST}`, `https://arxiv.org/pdf/${FIRST}.pdf`,
    `https://arxiv.org/html/${FIRST}`, `https://arxiv.org/pdf/${FIRST}?download=1#page=2`,
  ])("chooses an eligible quote before a stronger wrong-document match: %s", async url => {
    const result = await synthesize([
      gathered("S1", url), gathered("S2", `https://arxiv.org/pdf/${SECOND}`, distracting),
    ]);
    expect(result.citedMarkers).toEqual(["S1"]);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ claimIndex: 0, marker: "S1", quote: correct, support: 0.4 });
    const span = result.evidence[0].quoteSpan!;
    expect(correct.slice(span.start, span.end)).toBe(result.evidence[0].quote);
  });

  it.each([
    undefined, `https://arxiv.org/pdf/2606.02668v2`, `https://arxiv.org/pdf/2606.02668`,
    `https://arxiv.org.evil.invalid/pdf/${FIRST}`, `http://arxiv.org/pdf/${FIRST}`,
    `https://user:password@arxiv.org/pdf/${FIRST}`,
    `https://arxiv.org/pdf/${SECOND}?next=https://arxiv.org/pdf/${FIRST}`,
  ])("returns an uncited selection gap when the requested version was not read: %s", async url => {
    const result = await synthesize([gathered("S1", url), gathered("S2", `https://arxiv.org/pdf/${SECOND}`, distracting)]);
    expect(result.evidence).toEqual([]);
    expect(result.citedMarkers).toEqual([]);
    expect(result.answer).toBe("No excerpt was selected for these requested document versions.");
  });

  it.each(["", "Quotations remain unrelated to every requested keyword."])(
    "does not fabricate a quote or fallback citation from an empty or irrelevant body", async text => {
      const result = await synthesize([gathered("S1", `https://arxiv.org/pdf/${FIRST}`, text)]);
      expect(result.evidence).toEqual([]);
      expect(result.citedMarkers).toEqual([]);
    },
  );

  it("keeps each target scoped while allowing an unconstrained target to select another source", async () => {
    const result = await synthesize([
      gathered("S1", `https://arxiv.org/pdf/${FIRST}`),
      gathered("S2", `https://arxiv.org/pdf/${SECOND}`, distracting),
    ], [target, "record available"]);
    expect(result.evidence.map(row => [row.claimIndex, row.marker])).toEqual([[0, "S1"], [1, "S2"]]);
  });

  it("retains single-best selection for a target listing both documents", async () => {
    const result = await synthesize([
      gathered("S1", `https://arxiv.org/pdf/${FIRST}`),
      gathered("S2", `https://arxiv.org/pdf/${SECOND}`, distracting),
    ], [`arXiv ${FIRST} and ${SECOND} approval binding`]);
    expect(result.evidence).toHaveLength(1);
    expect(result.citedMarkers).toEqual(["S2"]);
  });

  it("retains ordinary generic-target fallback and empty-source behavior", async () => {
    const fallback = await synthesize([gathered("S1", `https://arxiv.org/pdf/${FIRST}`)], ["unmatched background topic"]);
    expect(fallback.answer).toBe(`${correct}… [S1]`);
    expect(fallback.citedMarkers).toEqual(["S1"]);
    expect(fallback.evidence).toEqual([]);
    expect((await synthesize([])).citedMarkers).toEqual([]);
  });
});

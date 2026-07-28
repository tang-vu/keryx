import { describe, expect, it } from "vitest";
import {
  buildEvidenceLedger,
  removeUnsupportedCitationMarkers,
} from "./evidence-ledger";
import type {
  ClaimSufficiency,
  GatheredContent,
  ProposedEvidence,
} from "../llm/reasoning-engine";

const gathered: GatheredContent[] = [
  {
    sourceId: "source-1",
    sourceName: "Source One",
    marker: "S1",
    text: "Circle burns USDC on the source domain.\nAn attestation authorizes minting on the destination.",
  },
  {
    sourceId: "source-2",
    sourceName: "Source Two",
    marker: "S2",
    text: "Gateway batches many signed transfers before settlement.",
  },
];

const claims = [
  "CCTP burns USDC on the source domain.",
  "An attestation authorizes minting on the destination.",
];

function assessment(
  coverage = 0.9,
): ClaimSufficiency[] {
  return claims.map((claim) => ({
    claim,
    coverage,
    coveredBy: ["S1"],
  }));
}

function evidence(
  over: Partial<ProposedEvidence> = {},
): ProposedEvidence {
  return {
    claimIndex: 0,
    marker: "S1",
    quote: "Circle burns USDC on the source domain.",
    support: 0.8,
    ...over,
  };
}

describe("buildEvidenceLedger", () => {
  it("accepts only an inline, declared marker backed by an exact source quote", () => {
    const ledger = buildEvidenceLedger({
      subClaims: claims,
      gathered,
      answer: "CCTP burns USDC before minting [S1].",
      declaredMarkers: ["S1"],
      proposedEvidence: [evidence()],
      finalAssessment: assessment(),
    });

    expect([...ledger.acceptedMarkers]).toEqual(["S1"]);
    expect(ledger.evidence[0]).toMatchObject({
      sourceId: "source-1",
      qualifiesForReward: true,
      support: 0.8,
    });
    expect(ledger.claimCoverage[0]).toMatchObject({
      coverage: 0.8,
      coveredBy: ["S1"],
    });
  });

  it("normalizes whitespace but does not accept a paraphrased or fabricated quote", () => {
    const ledger = buildEvidenceLedger({
      subClaims: claims,
      gathered,
      answer: "CCTP burns USDC [S1].",
      declaredMarkers: ["S1"],
      proposedEvidence: [
        evidence({
          quote:
            "Circle burns USDC on the source domain. An attestation authorizes minting on the destination.",
        }),
        evidence({ quote: "CCTP locks funds in a custodial vault." }),
      ],
      finalAssessment: assessment(),
    });

    expect(ledger.evidence).toHaveLength(1);
    expect(ledger.droppedEvidence).toBe(1);
  });

  it("withholds reward when any leg of the citation contract is missing", () => {
    const notInline = buildEvidenceLedger({
      subClaims: claims,
      gathered,
      answer: "CCTP burns USDC.",
      declaredMarkers: ["S1"],
      proposedEvidence: [evidence()],
      finalAssessment: assessment(),
    });
    const notDeclared = buildEvidenceLedger({
      subClaims: claims,
      gathered,
      answer: "CCTP burns USDC [S1].",
      declaredMarkers: [],
      proposedEvidence: [evidence()],
      finalAssessment: assessment(),
    });
    const tooWeak = buildEvidenceLedger({
      subClaims: claims,
      gathered,
      answer: "CCTP burns USDC [S1].",
      declaredMarkers: ["S1"],
      proposedEvidence: [evidence({ support: 0.39 })],
      finalAssessment: assessment(),
    });
    const assessmentUnavailable = buildEvidenceLedger({
      subClaims: claims,
      gathered,
      answer: "CCTP burns USDC [S1].",
      declaredMarkers: ["S1"],
      proposedEvidence: [evidence()],
      finalAssessment: assessment(),
      rewardAuthorizationAvailable: false,
    });

    expect([...notInline.acceptedMarkers]).toEqual([]);
    expect([...notDeclared.acceptedMarkers]).toEqual([]);
    expect([...tooWeak.acceptedMarkers]).toEqual([]);
    expect([...assessmentUnavailable.acceptedMarkers]).toEqual([]);
    expect(tooWeak.claimCoverage[0]?.coverage).toBe(0);
  });

  it("rejects oversized evidence excerpts even when they occur in the source", () => {
    const quote = "x".repeat(241);
    const ledger = buildEvidenceLedger({
      subClaims: [claims[0]!],
      gathered: [{ ...gathered[0]!, text: quote }],
      answer: "Claim [S1].",
      declaredMarkers: ["S1"],
      proposedEvidence: [evidence({ quote })],
      finalAssessment: [assessment()[0]!],
    });

    expect(ledger.evidence).toEqual([]);
    expect(ledger.droppedEvidence).toBe(1);
  });

  it("bounds final coverage by both the assessment and strongest verified evidence", () => {
    const ledger = buildEvidenceLedger({
      subClaims: claims,
      gathered,
      answer: "CCTP burns USDC [S1].",
      declaredMarkers: ["S1"],
      proposedEvidence: [
        evidence({ support: 0.95 }),
        evidence({
          claimIndex: 1,
          quote:
            "An attestation authorizes minting on the destination.",
          support: 0.6,
        }),
      ],
      finalAssessment: [
        { claim: claims[0]!, coverage: 0.5, coveredBy: ["S1"] },
        { claim: claims[1]!, coverage: 0.9, coveredBy: ["S1"] },
      ],
    });

    expect(ledger.claimCoverage.map((item) => item.coverage)).toEqual([
      0.5, 0.6,
    ]);
  });

  it("drops evidence for unknown markers and out-of-range claim indexes", () => {
    const ledger = buildEvidenceLedger({
      subClaims: claims,
      gathered,
      answer: "Unsupported [S9].",
      declaredMarkers: ["S9"],
      proposedEvidence: [
        evidence({ marker: "S9" }),
        evidence({ claimIndex: 99 }),
      ],
      finalAssessment: assessment(),
    });

    expect(ledger.evidence).toEqual([]);
    expect(ledger.droppedEvidence).toBe(2);
    expect([...ledger.acceptedMarkers]).toEqual([]);
  });

  it("removes rejected markers from the public answer", () => {
    expect(
      removeUnsupportedCitationMarkers(
        "Grounded [S1], unsupported [S2], unknown [S9].",
        new Set(["S1"]),
      ),
    ).toBe("Grounded [S1], unsupported, unknown.");
  });
});

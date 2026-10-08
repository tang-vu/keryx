import { describe, expect, it } from "vitest";

import {
  buildResearchReceipt,
  canonicalJson,
  verifyResearchReceipt,
} from "./research-receipt";
import type { PaymentRecord, QueryRun } from "./types";

it("roundtrips immutable public web provenance through a portable receipt", () => {
  const original = run(); const provenance = { retrievedAt: "2026-10-01T00:00:00Z", publisherGroup: "publisher.example", normalizedBodyHash: "a".repeat(64), extraction: "pdf" as const, truncated: true };
  original.citations[0] = { ...original.citations[0], sourceKind: "public-reference", webProvenance: provenance, reward: 0 };
  const receipt = buildResearchReceipt(original, []);
  const exported = JSON.parse(JSON.stringify(receipt));
  expect(exported.payload.citations[0].webProvenance).toEqual(provenance); expect(verifyResearchReceipt(exported).valid).toBe(true);
});

it("retains a deep immutable scholarly metadata snapshot and exact abstract-only scope without payout authority", () => {
  const original = run(); const scholarly = { provider: "crossref" as const, recordUrl: "https://api.crossref.org/works/10.1234%2Fpaper", retrievedAt: "2026-10-01T00:00:00Z",
    title: "Observed paper", authors: ["Ada Lovelace"], authorNames: [{ given: "Ada", family: "Lovelace" }], doi: "10.1234/paper", workType: "journal-article" as const,
    peerReview: "unknown" as const, evidenceScope: "publisher-page" as const };
  original.citations[0] = { ...original.citations[0], sourceKind: "public-reference", scholarly, reward: 0 };
  const receipt = buildResearchReceipt(original, []), exported = JSON.parse(JSON.stringify(receipt));
  expect(exported.payload.citations[0].scholarly).toEqual(scholarly); expect(verifyResearchReceipt(exported).valid).toBe(true);
  scholarly.authors[0] = "Later changed name"; scholarly.authorNames[0].family = "Changed";
  expect(receipt.payload.citations[0].scholarly?.authors[0]).toBe("Ada Lovelace");
  expect(receipt.payload.citations[0].scholarly?.authorNames?.[0].family).toBe("Lovelace");
});

function run(overrides: Partial<QueryRun> = {}): QueryRun {
  return {
    id: "dispatch-1",
    question: "How does a portable research receipt work?",
    budget: 0.05,
    researchMode: "quick",
    evidencePortfolio: {
      policy: "claim-coverage-v1",
      eligibleCandidates: 1,
      attentionLimit: 2,
      fetchBudgetUsdc: 0.025,
      selectedAssetIds: ["item:item-1"],
      selectedBuyUsdc: 0.01,
      unusedFetchBudgetUsdc: 0.015,
      predictedCoveredClaims: 2,
      claims: [
        { claimIndex: 0, selectedCandidateIds: ["item:item-1"], predictedCoverage: 0.8 },
        { claimIndex: 1, selectedCandidateIds: ["item:item-1"], predictedCoverage: 0.8 },
      ],
      outcome: {
        readAssetIds: ["item:item-1"],
        evidenceAssetIds: ["item:item-1"],
        nonqualifyingReads: 0,
        unreadSelected: 0,
        groundedClaims: 1,
        evidenceYield: 1,
      },
    },
    engine: "llm:test",
    subClaims: ["The receipt binds evidence.", "Settlement remains independently classified."],
    decisions: [
      {
        sourceId: "source-1",
        sourceName: "Source One",
        action: "BUY",
        expectedValue: 0.8,
        price: 0.01,
        confidence: 0.9,
        rationale: "Directly addresses both claims.",
        targets: [0, 1],
        itemId: "item-1",
        itemTitle: "Receipt design",
        itemUrl: "https://source.test/receipt",
        contentVersion: "sha256:article",
      },
    ],
    citations: [
      {
        marker: "S1",
        sourceId: "source-1",
        sourceName: "Source One",
        weight: 1,
        reward: 0.005,
        rationale: "Only qualifying source.",
        itemId: "item-1",
        itemTitle: "Receipt design",
        itemUrl: "https://source.test/receipt",
        contentVersion: "sha256:article",
      },
    ],
    evidence: [
      {
        claimIndex: 0,
        claim: "The receipt binds evidence.",
        marker: "S1",
        sourceId: "source-1",
        sourceName: "Source One",
        quote: "A portable receipt binds the exact evidence span.",
        support: 0.8,
        qualifiesForReward: true,
        itemId: "item-1",
        contentVersion: "sha256:article",
      },
    ],
    claimCoverage: [
      { claimIndex: 0, claim: "The receipt binds evidence.", coverage: 0.8, coveredBy: ["S1"] },
      {
        claimIndex: 1,
        claim: "Settlement remains independently classified.",
        coverage: 0,
        coveredBy: [],
      },
    ],
    answer: "The exported answer is bound to evidence [S1].",
    totalSpent: 0.015,
    totalToCreators: 0.015,
    trace: [],
    createdAt: "2026-08-23T00:00:00.000Z",
    confidence: { level: "Moderate", reason: "one claim remains uncovered" },
    paymentMode: "real",
    settledPayments: 2,
    pendingPayments: 0,
    ...overrides,
  };
}

function payment(
  kind: "fetch" | "citation",
  amountUsdc: number,
  status: PaymentRecord["settlementStatus"],
  overrides: Partial<PaymentRecord> = {},
): PaymentRecord {
  return {
    id: `private-row-${kind}`,
    kind,
    queryId: "dispatch-1",
    sourceId: "source-1",
    sourceName: "Source One",
    payer: "0xreader-session",
    payee: "0xcreator",
    amountUsdc,
    network: "eip155:5042002",
    settled: status === "settled",
    settlementStatus: status,
    authorizationId: "private-authorization-correlation",
    txHash: status === "settled" ? `circle-${kind}` : null,
    createdAt: kind === "fetch" ? "2026-08-23T00:00:01.000Z" : "2026-08-23T00:00:02.000Z",
    itemId: "item-1",
    contentVersion: "sha256:article",
    ...overrides,
  };
}

describe("portable research receipt", () => {
  it("separates operating fee rows while including both outbound kinds in ledger completeness", () => {
    const fee = payment("citation", 0.004, "settled", { kind: "operating-fee", sourceId: "keryx:operating-fee",
      sourceName: "Keryx operating fee", payee: "0xfounder", txHash: "circle-operating" });
    const rows = [payment("citation", 0.002, "settled"), fee];
    const receipt = buildResearchReceipt(run({ settledPayments: 2 }), rows);
    expect(receipt.payload.settlement).toMatchObject({ status: "settled", ledgerCompleteness: "complete",
      expectedRecordedPaymentsAtFinish: 2, settledCreatorPayments: 1, settledCreators: 1,
      settledCreatorUsdc: 0.002, settledOperatingPayments: 1, settledOperatingFeeUsdc: 0.004,
      operatingPayments: [{ kind: "operating-fee", funding: "keryx-sponsored", payee: "0xfounder", circleTransferId: "circle-operating" }] });
    expect(receipt.payload.settlement.creatorPayments).toHaveLength(1);
    expect(buildResearchReceipt(run({ settledPayments: 2 }), rows.slice(0, 1)).payload.settlement.status).toBe("incomplete");
    expect(verifyResearchReceipt(receipt).valid).toBe(true);
    const tampered = structuredClone(receipt);
    tampered.payload.settlement.operatingPayments![0].amountUsdc = 0.01;
    expect(verifyResearchReceipt(tampered).valid).toBe(false);
    expect(() => buildResearchReceipt(run({ settledPayments: 2 }), [rows[0], { ...fee, txHash: null }]))
      .toThrow("operating fee settlement evidence is missing");
  });

  it("keeps pending, failed and simulated operating amounts out of settled creator and fee totals", () => {
    for (const status of ["pending", "failed", "simulated"] as const) {
      const receipt = buildResearchReceipt(run({ paymentMode: status === "simulated" ? "offline" : "real",
        settledPayments: 0, pendingPayments: status === "simulated" ? 0 : 1 }),
      [payment("citation", 0.004, status, { kind: "operating-fee", sourceId: "keryx:operating-fee" })]);
      expect(receipt.payload.settlement.settledCreatorUsdc).toBe(0);
      expect(receipt.payload.settlement.settledOperatingFeeUsdc).toBe(0);
      expect(receipt.payload.settlement.creatorPayments).toHaveLength(0);
      expect(receipt.payload.settlement.operatingPayments![0].status).toBe(status);
    }
    expect(buildResearchReceipt(run({ paymentMode: undefined, settledPayments: undefined }), [])
      .payload.settlement.operatingPayments).toBeUndefined();
  });
  it("binds agency, claims, exact assets and settled creator rows in a deterministic digest", () => {
    const rows = [payment("citation", 0.005, "settled"), payment("fetch", 0.01, "settled")];
    const receipt = buildResearchReceipt(run(), rows);
    const reordered = buildResearchReceipt(run(), [...rows].reverse());

    expect(receipt.integrity.digest).toBe(reordered.integrity.digest);
    expect(verifyResearchReceipt(receipt)).toMatchObject({ valid: true });
    expect(receipt.payload.dispatch.answerSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.payload.agency.decisions[0]).toMatchObject({ action: "BUY", targets: [0, 1] });
    expect(receipt.payload.agency.evidencePortfolio).toMatchObject({
      policy: "claim-coverage-v1",
      selectedAssetIds: ["item:item-1"],
      selectedBuyUsdc: 0.01,
      outcome: { evidenceYield: 1, groundedClaims: 1 },
    });
    expect(receipt.payload.claims[0]).toMatchObject({ coverage: 0.8, coveredBy: ["S1"] });
    expect(receipt.payload.claims[0]?.evidence[0]).toMatchObject({
      marker: "S1",
      contentVersion: "sha256:article",
      qualifiesForReward: true,
    });
    expect(receipt.payload.settlement).toMatchObject({
      status: "settled",
      ledgerCompleteness: "complete",
      settledCreatorPayments: 2,
      settledCreatorUsdc: 0.015,
      settledAccessUsdc: 0.01,
      settledCitationUsdc: 0.005,
    });

    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("0xreader-session");
    expect(serialized).not.toContain("private-authorization-correlation");
    expect(serialized).not.toContain("private-row-");
    expect(serialized).toContain("circle-fetch");
  });

  it("ignores rows from another dispatch and fails closed on contradictory payment state", () => {
    const valid = payment("fetch", 0.01, "settled");
    const anotherRun = payment("citation", 9, "settled", { queryId: "dispatch-2" });
    const receipt = buildResearchReceipt(
      run({ settledPayments: 1 }),
      [anotherRun, valid],
    );
    expect(receipt.payload.settlement).toMatchObject({
      ledgerCompleteness: "complete",
      recordedCreatorPayments: 1,
      settledCreatorUsdc: 0.01,
    });

    expect(() =>
      buildResearchReceipt(run({ settledPayments: 1 }), [
        { ...valid, settled: false, settlementStatus: "settled" },
      ]),
    ).toThrow(/settled flag conflicts/);
  });

  it("detects any change to the exported payload", () => {
    const receipt = buildResearchReceipt(run(), [
      payment("fetch", 0.01, "settled"),
      payment("citation", 0.005, "settled"),
    ]);
    const tampered = structuredClone(receipt);
    tampered.payload.dispatch.answer = "A modified answer.";

    expect(verifyResearchReceipt(tampered)).toMatchObject({
      valid: false,
      reason: "payload digest mismatch",
    });

    expect(verifyResearchReceipt({ ...receipt, claimedSignature: "not-covered" })).toMatchObject({
      valid: false,
      reason: "receipt has unsupported top-level fields",
    });
  });

  it("keeps pending and offline amounts out of Circle-settled totals", () => {
    const real = buildResearchReceipt(
      run({ settledPayments: 1, pendingPayments: 1 }),
      [payment("fetch", 0.01, "settled"), payment("citation", 0.005, "pending")],
    );
    expect(real.payload.settlement).toMatchObject({
      status: "pending",
      ledgerCompleteness: "complete",
      settledCreatorUsdc: 0.01,
      pendingCreatorUsdc: 0.005,
    });

    const offline = buildResearchReceipt(
      run({ paymentMode: "offline", settledPayments: 0, pendingPayments: 0 }),
      [payment("fetch", 0.01, "simulated"), payment("citation", 0.005, "simulated")],
    );
    expect(offline.payload.settlement).toMatchObject({
      mode: "offline",
      status: "offline",
      ledgerCompleteness: "not_applicable",
      settledCreatorUsdc: 0,
      simulatedCreatorUsdc: 0.015,
    });
  });

  it("accepts a pending authorization becoming a definitive Circle failure without inventing spend", () => {
    const receipt = buildResearchReceipt(
      run({ totalSpent: 0, totalToCreators: 0, settledPayments: 0, pendingPayments: 1 }),
      [payment("fetch", 0.01, "failed")],
    );
    expect(receipt.payload.settlement).toMatchObject({
      status: "failed",
      ledgerCompleteness: "complete",
      settledCreatorUsdc: 0,
      failedCreatorUsdc: 0.01,
    });
  });

  it("labels missing durable rows as incomplete instead of trusting aggregate run totals", () => {
    const receipt = buildResearchReceipt(run({ settledPayments: 2 }), [
      payment("fetch", 0.01, "settled"),
    ]);
    expect(receipt.payload.settlement).toMatchObject({
      status: "incomplete",
      ledgerCompleteness: "incomplete",
      expectedRecordedPaymentsAtFinish: 2,
      recordedCreatorPayments: 1,
      settledCreatorUsdc: 0.01,
    });
  });

  it("does not guess that a historical zero-payment dispatch was an offline simulation", () => {
    const receipt = buildResearchReceipt(
      run({ paymentMode: undefined, settledPayments: undefined, pendingPayments: undefined }),
      [],
    );
    expect(receipt.payload.settlement).toMatchObject({
      mode: "legacy",
      status: "none",
      ledgerCompleteness: "legacy",
      settledCreatorUsdc: 0,
    });
  });

  it("canonicalizes object key order recursively and rejects unsupported numbers", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
    expect(() => canonicalJson({ amount: Number.NaN })).toThrow(/non-finite/);
  });
});


it("projects accepted public evidence with no invented creator payment or settled status", () => {
  const original = run();
  const publicRun = run({ paymentMode: "real", paymentAttempts: 0, settledPayments: 0, totalSpent: 0, totalToCreators: 0,
    decisions: original.decisions.map((decision) => ({ ...decision, sourceId: "public:publisher", sourceKind: "public-reference", publicDeliveryKind: "excerpt", action: "CACHE", price: 0 })),
    citations: original.citations.map((citation) => ({ ...citation, sourceId: "public:publisher", sourceKind: "public-reference", publicDeliveryKind: "excerpt", reward: 0 })),
    evidence: original.evidence?.map((item) => ({ ...item, sourceId: "public:publisher", sourceKind: "public-reference", publicDeliveryKind: "excerpt", qualifiesForAnswer: true, qualifiesForReward: false })),
  });
  const receipt = buildResearchReceipt(publicRun, []);
  expect(receipt.payload.citations[0]).toMatchObject({ sourceKind: "public-reference", publicDeliveryKind: "excerpt", rewardPlannedUsdc: 0 });
  expect(receipt.payload.claims[0]?.evidence[0]).toMatchObject({ qualifiesForAnswer: true, qualifiesForReward: false, sourceKind: "public-reference" });
  expect(receipt.payload.settlement.creatorPayments).toEqual([]);
  expect(receipt.payload.settlement.status).toBe("none");
  expect(verifyResearchReceipt(receipt).valid).toBe(true);
});

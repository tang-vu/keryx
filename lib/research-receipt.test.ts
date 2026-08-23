import { describe, expect, it } from "vitest";

import {
  buildResearchReceipt,
  canonicalJson,
  verifyResearchReceipt,
} from "./research-receipt";
import type { PaymentRecord, QueryRun } from "./types";

function run(overrides: Partial<QueryRun> = {}): QueryRun {
  return {
    id: "dispatch-1",
    question: "How does a portable research receipt work?",
    budget: 0.05,
    researchMode: "quick",
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
  it("binds agency, claims, exact assets and settled creator rows in a deterministic digest", () => {
    const rows = [payment("citation", 0.005, "settled"), payment("fetch", 0.01, "settled")];
    const receipt = buildResearchReceipt(run(), rows);
    const reordered = buildResearchReceipt(run(), [...rows].reverse());

    expect(receipt.integrity.digest).toBe(reordered.integrity.digest);
    expect(verifyResearchReceipt(receipt)).toMatchObject({ valid: true });
    expect(receipt.payload.dispatch.answerSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.payload.agency.decisions[0]).toMatchObject({ action: "BUY", targets: [0, 1] });
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

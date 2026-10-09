import { describe, expect, it } from "vitest";
import { captureLedgerRun } from "./capture";
import { formatLedgerMicros } from "./contracts";
import { ledgerDigest, projectOperatorLedger } from "./projection";
import { verifyOperatorLedger, operatorLedgerCsv, operatorLedgerJson } from "./export";
import { ledgerFixture, ledgerPayment, ledgerRun, LEDGER_FIXTURE_TIME } from "./test-fixture";

describe("public observed transfer books", () => {
  it("posts exact matched legs with equal debit/credit and no private or profit fields", () => {
    const result = ledgerFixture();
    expect(result.payload.trialBalance).toEqual({ debitMicroUsdc: "15700", creditMicroUsdc: "15700", balanced: true });
    expect(result.payload.entries.map(row => row.account)).toEqual(["recipient:access", "sender:treasury"]);
    expect(result.payload.jobs[0]).toMatchObject({ customerCohort: "unknown", legCoverage: "matched-finish-count", marginMicroUsdc: null, purchasePriceMicroUsdc: null });
    expect(result.payload.scope).toMatchObject({ coverage: "partial", allBusinessBooks: false, consistency: "separate-read-snapshots" });
    expect(result.payload.position).toEqual({ balanceMicroUsdc: null, obligationsMicroUsdc: null, overlapMicroUsdc: null, safeSpendMicroUsdc: "0", status: "unknown" });
    expect(verifyOperatorLedger(result)).toEqual(result);
    const text = operatorLedgerJson(result);
    for (const privateText of [ledgerRun().question, ledgerRun().answer, "PRIVATE-RATIONALE", ledgerPayment().payer, ledgerPayment().payee, "auth-one", "payment-one"])
      expect(text).not.toContain(privateText);
  });

  it.each([NaN, Infinity, -0, -1, 0.0000001, 0, 9007199254.740992])("refuses unsafe/nonpositive legacy amount %s without rounding", amountUsdc => {
    if (!Number.isFinite(amountUsdc)) { expect(() => ledgerFixture(undefined, [ledgerPayment({ amountUsdc })])).toThrow(); return; }
    const result = ledgerFixture(undefined, [ledgerPayment({ amountUsdc })]);
    expect(result.payload.entries).toEqual([]); expect(result.payload.jobs[0].legs[0]).toMatchObject({ state: "uncertain", reason: "invalid-amount" });
    expect(result.payload.trialBalance.debitMicroUsdc).toBe("0");
  });

  it("supports aggregate integer totals beyond the single legacy safe-number bound", () => {
    const amountUsdc = 9007199254.74099;
    const a = ledgerPayment({ amountUsdc }), b = ledgerPayment({ id: "payment-two", authorizationId: "auth-two", txHash: "33333333-3333-4333-8333-333333333333", amountUsdc });
    const result = ledgerFixture([ledgerRun({ settledPayments: 2 })], [a, b]);
    expect(result.payload.trialBalance.debitMicroUsdc).toBe("18014398509481980");
    expect(formatLedgerMicros(result.payload.trialBalance.debitMicroUsdc)).toBe("18014398509.481980 USDC");
    expect(verifyOperatorLedger(result)).toEqual(result);
  });

  it("separates browser sponsorship/unknown/offline roles without Operator-expense or outside inference", () => {
    const browser = ledgerRun({ fundingOwner: "browser", askerFunded: true, asker: `0x${"c".repeat(40)}`,
      provenance: { version: 1, surface: "web", ownershipMethod: "session" } });
    const result = ledgerFixture([browser]);
    expect(result.payload.entries[1].account).toBe("sender:browser"); expect(result.payload.settledByFunding.browser.accessMicroUsdc).toBe("15700");
    expect(result.payload.settledByFunding.treasury.accessMicroUsdc).toBe("0"); expect(result.payload.business.outsideRevenueMicroUsdc).toBeNull();
    for (const run of [ledgerRun({ fundingOwner: undefined }), ledgerRun({ fundingOwner: "browser" }), ledgerRun({ fundingOwner: "treasury", askerFunded: true })])
      expect(ledgerFixture([run]).payload.jobs[0].funding).toBe("unknown");
    const offline = ledgerFixture([ledgerRun({ paymentMode: "offline" })]);
    expect(offline.payload.entries).toEqual([]); expect(offline.payload.jobs[0].legs[0].reason).toBe("offline-funding");
  });

  it.each([
    ledgerRun({ origin: "a2a" }), ledgerRun({ id: "a2a_original" }), ledgerRun({ provenance: undefined }),
    ledgerRun({ provenance: { version: 1, surface: "remote-mcp", ownershipMethod: "api-key" } }),
    ledgerRun({ provenance: { version: 1, surface: "web", ownershipMethod: "verified-payer" } }),
    ledgerRun({ provenance: { version: 1, surface: "web", ownershipMethod: "session" } }), ledgerRun({ asker: `0x${"d".repeat(40)}` }),
  ])("excludes absent/foreign/ambiguous public provenance without a wallet-absence heuristic", run => {
    expect(captureLedgerRun(run)).toBeNull(); expect(ledgerFixture([run]).payload.jobs).toEqual([]);
  });

  it.each(["pending", "failed", "simulated"] as const)("keeps %s out of settlement postings", settlementStatus => {
    const result = ledgerFixture([ledgerRun({ pendingPayments: settlementStatus === "pending" ? 1 : 0, settledPayments: 0 })],
      [ledgerPayment({ settled: false, settlementStatus })]);
    expect(result.payload.jobs[0].legs[0].state).toBe(settlementStatus); expect(result.payload.entries).toEqual([]);
    expect(result.payload.jobs[0].confirmedNetMicroUsdc).toBeNull(); expect(result.payload.jobs[0].marginMicroUsdc).toBeNull();
  });

  it("preserves known settled legs while pending/missing legs leave the job incomplete", () => {
    const pending = ledgerPayment({ id: "payment-two", authorizationId: "auth-two", settled: false, settlementStatus: "pending", txHash: null });
    const result = ledgerFixture([ledgerRun({ pendingPayments: 1 })], [ledgerPayment(), pending]);
    expect(result.payload.jobs[0]).toMatchObject({ legCoverage: "incomplete", pendingLegs: 1, settled: { accessMicroUsdc: "15700" } });
    expect(result.payload.entries).toHaveLength(2);
    expect(ledgerFixture([ledgerRun({ settledPayments: 2 })]).payload.jobs[0].legCoverage).toBe("incomplete");
  });

  it.each([
    { id: undefined, reason: "missing-identity" }, { txHash: null, reason: "missing-settlement-evidence" },
    { txHash: "not-a-confirmation", reason: "missing-settlement-evidence" }, { settled: false, reason: "inconsistent-state" },
    { settlementStatus: undefined, reason: "inconsistent-state" }, { authorizationPhase: "prepared" as const, reason: "inconsistent-state" },
    { sourceId: "foreign-source", reason: "source-binding" }, { itemId: "unbound-version", reason: "source-binding" },
    { contentVersion: "sha256:unbound", reason: "source-binding" }, { network: "eip155:5042", reason: "foreign-network" },
  ])("refuses original/evidence/state/source/network gap $reason", ({ reason, ...changes }) => {
    const result = ledgerFixture(undefined, [ledgerPayment(changes)]);
    expect(result.payload.jobs[0].legs[0]).toMatchObject({ state: "uncertain", reason }); expect(result.payload.entries).toEqual([]);
  });

  it("requires exact retained article/version binding and excludes synthetic evidence", () => {
    const run = ledgerRun(); run.decisions[0] = { ...run.decisions[0], itemId: "article", contentVersion: "sha256:original" };
    const payment = ledgerPayment({ itemId: "article", contentVersion: "sha256:original" });
    expect(ledgerFixture([run], [payment]).payload.entries).toHaveLength(2);
    run.decisions[0].evidenceProvenance = "synthetic-demo";
    expect(ledgerFixture([run], [payment]).payload.jobs[0].legs[0].reason).toBe("synthetic-demo");
  });

  it("keeps same-ID foreign network originals separate without order-dependent masking", () => {
    const selected = ledgerPayment(), foreign = ledgerPayment({ network: "eip155:5042", amountUsdc: 0.03 });
    const forward = ledgerFixture(undefined, [selected, foreign]), reverse = ledgerFixture(undefined, [foreign, selected]);
    expect(forward).toEqual(reverse);
    expect(forward.payload.trialBalance.debitMicroUsdc).toBe("15700");
    expect(forward.payload.jobs[0].legs).toHaveLength(2);
    expect(new Set(forward.payload.jobs[0].legs.map(leg => leg.id)).size).toBe(2);
    expect(forward.payload.jobs[0].legs.find(leg => leg.reason === "foreign-network")?.amountMicroUsdc).toBeNull();
  });

  it("binds access to recorded BUY and rewards to actual citations rather than interchangeable source references", () => {
    const payment = ledgerPayment({ kind: "citation" });
    expect(ledgerFixture(undefined, [payment]).payload.jobs[0].legs[0].reason).toBe("source-binding");
    const citation = { sourceId: payment.sourceId, sourceName: "Not exported", marker: "S1", weight: 1, reward: payment.amountUsdc, rationale: "PRIVATE-RATIONALE" };
    const run = ledgerRun({ citations: [citation] });
    expect(ledgerFixture([run], [payment]).payload.settledByFunding.treasury.rewardMicroUsdc).toBe("15700");
    for (const action of ["SKIP", "CACHE"] as const) {
      const changed = ledgerRun(); changed.decisions[0].action = action;
      expect(ledgerFixture([changed], [ledgerPayment()]).payload.jobs[0].legs[0].reason).toBe("source-binding");
    }
  });

  it("deduplicates identical originals and quarantines conflicting ID/authorization records in either order", () => {
    const p = ledgerPayment();
    expect(ledgerFixture(undefined, [p, { ...p }]).payload.trialBalance.debitMicroUsdc).toBe("15700");
    for (const other of [ledgerPayment({ amountUsdc: 0.02 }), ledgerPayment({ id: "other-payment", txHash: "44444444-4444-4444-8444-444444444444" })]) {
      const forward = ledgerFixture(undefined, [p, other]), reverse = ledgerFixture(undefined, [other, p]);
      expect(forward).toEqual(reverse); expect(forward.payload.entries).toEqual([]);
      expect(forward.payload.jobs[0].legs.every(leg => leg.reason === "conflicting-identity" && leg.amountMicroUsdc === null)).toBe(true);
    }
  });

  it("does not accuse distinct legitimate batched originals of identity conflict or invent individual chain proof", () => {
    const a = ledgerPayment(), b = ledgerPayment({ id: "batched-two", authorizationId: "auth-two", amountUsdc: 0.02 });
    const result = ledgerFixture([ledgerRun({ settledPayments: 2 })], [a, b]);
    expect(result.payload.jobs[0].legs.map(leg => leg.reason)).toEqual(["shared-settlement-reference", "shared-settlement-reference"]);
    expect(result.payload.jobs[0].legs.map(leg => leg.amountMicroUsdc).sort()).toEqual(["15700", "20000"]);
    expect(result.payload.entries).toEqual([]); expect(result.payload.jobs[0].legCoverage).toBe("incomplete");
  });

  it("binds sponsored fees to the actual retained beneficiary/amount and never calls them outside revenue", () => {
    const fee = ledgerPayment({ kind: "operating-fee", sourceId: "keryx:operating-fee" });
    const run = ledgerRun({ operatingFee: { policy: "public-citation-operating-fee-v1", beneficiary: fee.payee,
      amountUsdc: fee.amountUsdc, allocations: [], status: "settled", paymentId: fee.id } });
    const result = ledgerFixture([run], [fee]);
    expect(result.payload.settledByFunding.treasury.sponsoredFeeMicroUsdc).toBe("15700"); expect(result.payload.business.outsideRevenueMicroUsdc).toBeNull();
    expect(ledgerFixture([run], [{ ...fee, payee: `0x${"f".repeat(40)}` }]).payload.entries).toEqual([]);
    expect(ledgerFixture([run], [{ ...fee, id: "same-amount-other-original" }]).payload.entries).toEqual([]);
    expect(ledgerFixture([{ ...run, operatingFee: { ...run.operatingFee!, paymentId: undefined } }], [fee]).payload.entries).toEqual([]);
  });

  it("never republishes inbound purchase amounts or arbitrary private recovery fields", () => {
    const p = ledgerPayment({ kind: "inbound", amountUsdc: 912.123456 });
    const result = ledgerFixture(undefined, [p]);
    expect(result.payload.jobs[0].legs[0].amountMicroUsdc).toBeNull();
    expect(operatorLedgerJson(result)).not.toMatch(/912123456/);
    for (const marker of [{ privateSupplierKey: "SECRET-HOLD" }, null, undefined]) {
      const run = { ...ledgerRun(), originalFulfillment: marker, extraPrivateNote: "SECRET-NOTE" };
      expect(captureLedgerRun(run)).toBeNull();
      expect(ledgerFixture([run as ReturnType<typeof ledgerRun>], [p]).payload.jobs).toEqual([]);
    }
  });

  it("exports balanced integer CSV and catches tampering even with a recomputed digest", () => {
    const result = ledgerFixture();
    const rows = operatorLedgerCsv(result).trim().split("\r\n").map(row => row.split(",").map(cell => cell.slice(1, -1)));
    expect(rows).toHaveLength(3); expect(rows[1][9]).toBe("15700"); expect(rows[2][10]).toBe("15700");
    const changed = structuredClone(result); changed.payload.entries[0].debitMicroUsdc = "20000";
    changed.integrity.digest = ledgerDigest(changed.payload); expect(() => verifyOperatorLedger(changed)).toThrow("voucher binding");
    expect(() => verifyOperatorLedger(result, `sha256:${"0".repeat(64)}`)).toThrow("digest mismatch");
    const leaked = structuredClone(result) as unknown as { payload: Record<string, unknown> }; leaked.payload.question = "secret";
    expect(() => verifyOperatorLedger(leaked)).toThrow();
  });

  it("rejects resource/window bounds before processing and leaves finish counts unknown when absent", () => {
    const run = captureLedgerRun(ledgerRun())!;
    const base = { network: "eip155:5042002", days: 7, readStartedAt: LEDGER_FIXTURE_TIME, readCompletedAt: LEDGER_FIXTURE_TIME,
      runs: [run], payments: [], runLimitReached: false, paymentLimitReached: false };
    expect(() => projectOperatorLedger({ ...base, runs: Array(251).fill(run) })).toThrow();
    expect(() => projectOperatorLedger({ ...base, payments: Array(1001).fill({}) })).toThrow();
    expect(() => projectOperatorLedger({ ...base, days: 32 })).toThrow();
    expect(ledgerFixture([ledgerRun({ settledPayments: undefined })]).payload.jobs[0].legCoverage).toBe("unknown");
  });

  it("serializes spreadsheet-formula-like public IDs as literal CSV text without changing JSON or micro amounts", () => {
    const id = "-1-1", result = ledgerFixture([ledgerRun({ id })], [ledgerPayment({ queryId: id })]);
    const rows = operatorLedgerCsv(result).trim().split("\r\n").map(row => row.split(",").map(cell => cell.slice(1, -1)));
    expect(rows[1][6]).toBe("'-1-1"); expect(rows[2][6]).toBe("'-1-1");
    expect(rows[1][9]).toBe("15700"); expect(rows[2][10]).toBe("15700");
    expect(verifyOperatorLedger(JSON.parse(operatorLedgerJson(result)), result.integrity.digest).payload.jobs[0].id).toBe(id);
  });
});

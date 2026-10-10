import { describe, expect, it } from "vitest";
import { auditArray } from "./input-contract";
import { summarizeUsage, type AuditUsageRun, type AuditUsagePayment } from "./usage-summary";
const network = "eip155:5042", wallet = `0x${"a".repeat(40)}`;
const since = "2026-10-01T00:00:00.000Z", until = "2026-10-11T00:00:00.000Z";
const run = (id: string): AuditUsageRun => ({ id, network, createdAt: since, classification: { cohort: "unknown", payment: "unknown" } });
const payment = (id: string, queryId: string): AuditUsagePayment => ({ id, queryId, network, kind: "fetch", payee: wallet,
  amountUsdc: "0.000001", settled: true, settlementStatus: "settled", txHash: "synthetic-recorded-reference" });
const input = (count: number) => ({ network, since, until, runs: Array.from({ length: count }, (_, i) => run(String(i))),
  payments: Array.from({ length: count }, (_, i) => payment(String(i), String(i))) });
describe("finite usage summary consumer profiles", () => {
  it("keeps the default audit limits at 2,000 for both collections", () => {
    expect(summarizeUsage(input(2000)).columns[3]).toMatchObject({ researchRuns: 2000, settledPayments: 2000, settledMicros: "2000" });
    expect(() => summarizeUsage({ ...input(2001), payments: [] })).toThrow("Invalid audit collection");
    expect(() => summarizeUsage({ ...input(2001), runs: [run("0")] })).toThrow("Invalid audit collection");
    expect(() => auditArray(Array(2001))).toThrow("Invalid audit collection");
  });
  it("counts complete public windows above 2,000 without inventing people or funding", () => {
    expect(summarizeUsage(input(2101), "public-window").columns[3]).toMatchObject({ people: 0, researchRuns: 2101,
      payingRuns: 2101, unknownFundingPayingRuns: 2101, independentPayingRuns: 0, settledPayments: 2101, settledMicros: "2101" });
  });
  it("accepts the fixed run cap and refuses the next row", () => {
    const value = { ...input(10000), payments: [] };
    expect(summarizeUsage(value, "public-window").columns[3].researchRuns).toBe(10000);
    expect(() => summarizeUsage({ ...value, runs: [...value.runs, run("overflow")] }, "public-window")).toThrow("Invalid audit collection");
  });
  it("accepts the fixed payment cap and refuses the next row", () => {
    const value = { network, since, until, runs: [run("one")],
      payments: Array.from({ length: 50000 }, (_, i) => payment(String(i), "one")) };
    expect(summarizeUsage(value, "public-window").columns[3]).toMatchObject({ payingRuns: 1, settledPayments: 50000, settledMicros: "50000" });
    expect(() => summarizeUsage({ ...value, payments: [...value.payments, payment("overflow", "one")] }, "public-window"))
      .toThrow("Invalid audit collection");
  });
  it("refuses unknown or supplied bounds and preserves hostile-input rejection", () => {
    for (const profile of ["other", null, 100000, { runs: 100000, payments: 100000 }, Symbol("public-window")])
      expect(() => summarizeUsage(input(1), profile as never)).toThrow("Invalid usage summary profile");
    let read = false;
    const hostile = { ...input(1), get payments() { read = true; return []; } };
    expect(() => summarizeUsage(hostile, "public-window")).toThrow(); expect(read).toBe(false);
  });
});

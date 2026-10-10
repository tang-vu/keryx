import { describe, expect, it } from "vitest";
import { createTrustedUsageContext, newRunUsage } from "../research/usage-provenance";
import { decimalMicros } from "../research-audit/exact-units";
import { projectUsageCorpus, usageWindow, usageWindowSchema, UsageUnavailable, type UsageCorpus } from "./contracts";
const network = "eip155:5042", wallet = `0x${"a".repeat(40)}`, proof = "a".repeat(64);
const window = usageWindow(new URLSearchParams("since=2026-10-01"), network, new Date("2026-10-11T00:00:00.000Z"));
function corpus(): UsageCorpus {
  const usage = newRunUsage({ usageContext: createTrustedUsageContext(network,
    { actor: "outside", funding: "sponsored", scripted: false, actorEvidenceSha256: proof, fundingEvidenceSha256: proof }) }, network, []);
  return { complete: true, window, runs: [{ id: "outside", createdAt: window.since, usage,
    provenance: { version: 1, surface: "api", ownershipMethod: "api-key" }, actorId: wallet }],
    payments: [{ id: "one", queryId: "outside", network, kind: "fetch", amountUsdc: "0.000001", settled: true,
      settlementStatus: "settled", txHash: "synthetic-recorded-reference", payee: wallet }] };
}
describe("bounded usage corpus", () => {
  it("uses canonical UTC inclusive since/exclusive until, explicit single network and strict date/duplicate filters", () => {
    expect(usageWindow(new URLSearchParams("period=7d"), network, new Date(window.until)).since).toBe("2026-10-04T00:00:00.000Z");
    for (const params of ["network=other", "since=2026-02-30", "since=2026-10-01&period=7d", "network=eip155:5042&network=eip155:5042002", "period=0", "since=2027-01-01"])
      expect(() => usageWindow(new URLSearchParams(params), network, new Date(window.until))).toThrow();
    for (const value of [{ ...window, period: "all" }, { ...window, period: "7d" }, { ...window, since: "2026-10-01T00:00:00.001Z" }])
      expect(usageWindowSchema.safeParse(value).success).toBe(false);
    const input = corpus(); input.runs[0].createdAt = window.until;
    expect(() => projectUsageCorpus(input, window)).toThrow(UsageUnavailable);
  });
  it("separates sponsorship, counts only proved positive settled rows, and exposes no identities/proofs or invented outcomes", () => {
    const input = corpus();
    input.payments.push(...["pending", "simulated", "legacy", "fraction"].map(id => ({ ...input.payments[0], id,
      ...(id === "legacy" ? { txHash: null } : id === "fraction" ? { amountUsdc: "0.00000100000000000001" } : { settled: false, settlementStatus: id }) })));
    const result = projectUsageCorpus(input, window).summary;
    expect(result.columns.map(c => c.cohort)).toEqual(["outside", "team", "scripted", "unknown"]);
    expect(result.columns[0]).toMatchObject({ people: 1, researchRuns: 1, independentPayingRuns: 0, sponsoredPayingRuns: 1,
      settledPayments: 1, settledMicros: "1", acceptedDeliverables: null, medianTimeToFirstAnswerMs: null });
    expect(result.excludedPayments).toBe(4); expect(JSON.stringify(result)).not.toContain(wallet); expect(JSON.stringify(result)).not.toContain(proof);
    expect(decimalMicros("9007199254.740991")).toBe("9007199254740991");
    expect(decimalMicros("9007199254.740992")).toBeNull(); expect(decimalMicros("0.12345600000000000001")).toBeNull();
  });
  it("legacy network requires all payment rows to agree; cohort and unverified ownership remain unknown", () => {
    const input = corpus(); input.runs[0].usage = null; input.runs[0].provenance = null;
    expect(projectUsageCorpus(input, window).summary.columns[3]).toMatchObject({ people: 0, researchRuns: 1, unknownFundingPayingRuns: 1 });
    input.payments.push({ ...input.payments[0], id: "mixed", network: "not-canonical" });
    expect(projectUsageCorpus(input, window).summary.unattributedNetworkRuns).toBe(1);
    input.payments = []; expect(projectUsageCorpus(input, window).summary.unattributedNetworkRuns).toBe(1);
  });
  it("a verified configured team actor with a settled row has unknown funding unless a separate reviewed digest exists", () => {
    const input = corpus(); const row = input.runs[0];
    row.usage = newRunUsage({ asker: wallet, provenance: { version: 1, surface: "api", ownershipMethod: "api-key" } }, network, [wallet]);
    let column = projectUsageCorpus(input, window).summary.columns[1];
    expect(column).toMatchObject({ people: 1, researchRuns: 1, payingRuns: 1, teamFundedPayingRuns: 0, unknownFundingPayingRuns: 1 });
    row.usage = newRunUsage({ usageContext: createTrustedUsageContext(network,
      { actor: "team", funding: "treasury", scripted: false, fundingEvidenceSha256: proof }) }, network, [wallet]);
    column = projectUsageCorpus(input, window).summary.columns[1];
    expect(column).toMatchObject({ teamFundedPayingRuns: 1, unknownFundingPayingRuns: 0 });
  });
  it("projects both complete collections above 2,000 with exact settled totals", () => {
    const input = corpus(), original = input.runs[0], paid = input.payments[0];
    input.runs = Array.from({ length: 2101 }, (_, i) => ({ ...original, id: String(i) }));
    input.payments = input.runs.map(row => ({ ...paid, id: row.id, queryId: row.id }));
    expect(projectUsageCorpus(input, window).summary.columns[0]).toMatchObject({ people: 1, researchRuns: 2101,
      payingRuns: 2101, sponsoredPayingRuns: 2101, settledPayments: 2101, settledMicros: "2101" });
  });
  it("retains the 8 MiB domain limit even when collection counts fit", () => {
    const input = corpus(); input.payments = [];
    input.runs = Array.from({ length: 6000 }, (_, i) => ({ ...input.runs[0], id: String(i), usage: { fixture: "x".repeat(1800) } }));
    expect(() => projectUsageCorpus(input, window)).toThrow(UsageUnavailable);
  });
  it("refuses duplicate/foreign rows, partial corpus, wrong binding, overflow, rather than advertising a complete sample", () => {
    for (const input of [{ ...corpus(), complete: false }, { ...corpus(), window: { ...window, network: "eip155:5042002" } },
      { ...corpus(), runs: Array.from({ length: 10001 }, (_, i) => ({ ...corpus().runs[0], id: String(i) })) },
      { ...corpus(), payments: [{ ...corpus().payments[0], queryId: "foreign" }] },
      { ...corpus(), payments: [corpus().payments[0], corpus().payments[0]] }])
      expect(() => projectUsageCorpus(input, window)).toThrow(UsageUnavailable);
  });
});

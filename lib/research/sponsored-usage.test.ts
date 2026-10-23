import { describe, expect, it, vi } from "vitest";
import type { PaymentGateway } from "../payments/payment-gateway";
import { newRunUsage } from "./usage-provenance";
import { sponsoredUsageContext } from "./sponsored-usage";
import { projectUsageCorpus, usageWindow } from "../usage/contracts";

const network = "eip155:5042", payer = `0x${"a".repeat(40)}`, actor = `0x${"b".repeat(40)}`;
function gateway(mode: "real" | "offline" = "real"): PaymentGateway {
  return { mode, agentAddress: vi.fn(() => payer), ensureFunded: vi.fn(), payFetch: vi.fn(), payCitation: vi.fn() };
}
function input() {
  return { network, queryId: "server-generated-query", origin: "https://keryx.invalid", gateway: gateway(),
    sponsored: true, scripted: false, provenance: { version: 1, surface: "web", ownershipMethod: "unknown" },
    teamWallets: [] } as const;
}
function usage(value: Parameters<typeof sponsoredUsageContext>[0]) {
  return newRunUsage({ usageContext: sponsoredUsageContext(value), asker: value.asker, provenance: value.provenance }, network, value.teamWallets);
}

describe("trusted public-trial funding observation", () => {
  it("records treasury funding while the caller remains unclassified, with no financial side effects", () => {
    const value = input(), recorded = usage(value);
    expect(recorded).toMatchObject({ cohort: "unknown", payment: "team", actorEvidenceSha256: null });
    expect(recorded.fundingEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(value.gateway.ensureFunded).not.toHaveBeenCalled();
    expect(value.gateway.payFetch).not.toHaveBeenCalled();
    expect(value.gateway.payCitation).not.toHaveBeenCalled();
  });

  it("does not infer an outside actor or independent payment from a signed-in wallet", () => {
    const value = { ...input(), asker: actor, provenance: { version: 1, surface: "web", ownershipMethod: "session" } as const };
    expect(usage(value)).toMatchObject({ cohort: "unknown", payment: "team", actorEvidenceSha256: null });
    expect(usage({ ...value, teamWallets: [actor] })).toMatchObject({ cohort: "team", payment: "team" });
    expect(usage({ ...value, teamWallets: [actor], provenance: { ...value.provenance, ownershipMethod: "unknown" } }))
      .toMatchObject({ cohort: "unknown", payment: "team" });
  });

  it("keeps offline, browser-funded and other-network activity unproved without touching a signer", () => {
    for (const value of [{ ...input(), sponsored: false }, { ...input(), gateway: gateway("offline") },
      { ...input(), network: "eip155:5042002" as const }]) {
      expect(sponsoredUsageContext(value)).toBeUndefined();
      expect(value.gateway.agentAddress).not.toHaveBeenCalled();
    }
    expect(usage({ ...input(), gateway: { ...gateway(), agentAddress: () => { throw new Error("unavailable"); } } }))
      .toMatchObject({ cohort: "unknown", payment: "unknown" });
  });

  it("retains the controlled scripted cohort and only records proven trial funding", () => {
    expect(usage({ ...input(), scripted: true })).toMatchObject({ cohort: "scripted", payment: "team" });
    expect(usage({ ...input(), scripted: true, gateway: gateway("offline") }))
      .toMatchObject({ cohort: "scripted", payment: "unknown" });
  });

  it("binds the observation to the original query, selected payer and origin; copies cannot mint context", () => {
    const original = input(), context = sponsoredUsageContext(original)!;
    const first = newRunUsage({ usageContext: context }, network, []);
    for (const changed of [{ ...input(), queryId: "another-query" }, { ...input(), origin: "https://other.invalid" },
      { ...input(), gateway: { ...gateway(), agentAddress: () => actor } }]) {
      expect(usage(changed).fundingEvidenceSha256).not.toBe(first.fundingEvidenceSha256);
    }
    expect(newRunUsage({ usageContext: JSON.parse(JSON.stringify(context)) }, network, []))
      .toMatchObject({ cohort: "unknown", payment: "unknown", fundingEvidenceSha256: null });
  });

  it("counts a settled trial as team-funded in the unknown cohort, with no outside traction or invented acceptance", () => {
    const value = input(), recorded = usage(value);
    const window = usageWindow(new URLSearchParams(), network, new Date("2026-10-23T12:00:00.000Z"));
    const result = projectUsageCorpus({ complete: true, window, runs: [{ id: value.queryId,
      createdAt: "2026-10-23T11:00:00.000Z", usage: recorded, provenance: value.provenance, actorId: null }],
      payments: [{ id: "synthetic-payment", queryId: value.queryId, network, kind: "citation", amountUsdc: "0.025",
        settled: true, settlementStatus: "settled", txHash: "synthetic-recorded-reference", payee: actor }] }, window).summary;
    expect(result.columns.find(column => column.cohort === "unknown")).toMatchObject({ researchRuns: 1,
      payingRuns: 1, teamFundedPayingRuns: 1, independentPayingRuns: 0, unknownFundingPayingRuns: 0,
      acceptedDeliverables: null, medianTimeToFirstAnswerMs: null });
    expect(result.columns.find(column => column.cohort === "outside")).toMatchObject({ researchRuns: 0,
      independentPayingRuns: 0, acceptedDeliverables: null });
    expect(JSON.stringify(result)).not.toContain(recorded.fundingEvidenceSha256!);
    expect(JSON.stringify(result)).not.toContain(payer);
  });
});

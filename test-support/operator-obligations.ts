import type { ObligationScope, ObligationSnapshot } from "../lib/operator-obligations/contracts";
import { projectOperatorObligations } from "../lib/operator-obligations/projection";

export const OBLIGATION_FIXTURE_TIME = Date.parse("2026-10-09T08:00:00.000Z");
export const OBLIGATION_FIXTURE_OWNER = `0x${"1".repeat(40)}`;
export const OBLIGATION_FIXTURE_SCOPE: ObligationScope = Object.freeze({
  custodyWallet: `0x${"2".repeat(40)}`, signer: `0x${"2".repeat(40)}`,
  custodyRole: "public-hosted", storageIdentityDigest: "a".repeat(64), network: "eip155:5042",
  asset: "0x3600000000000000000000000000000000000000", compartment: "wallet",
});
export function obligationFixture(): ObligationSnapshot {
  const scope = OBLIGATION_FIXTURE_SCOPE, observedAt = new Date(OBLIGATION_FIXTURE_TIME).toISOString(), snapshotId = "fixture:original";
  const common = { scope, observedAt, snapshotId, verifiedOriginal: true };
  const fixture = { version: 1, snapshotId, scope, observedAt, source: "offline-fixture", consistency: "atomic", overlap: "resolved",
    domains: ["prepaid-work", "payment-originals", "creator-debt", "delivery-remedies", "refunds-withdrawals", "funding-originals", "provider-billing", "gas-fees"]
      .map(domain => ({ domain, coverage: "complete", originalId: `domain:${domain}`, evidenceId: `evidence:${domain}`, observedAt })),
    cash: [{ ...common, id: "cash:erc20", originalId: "cash:original", evidenceId: "balance:proof", balanceId: "wallet:balance", kind: "wallet-erc20", units: "micro-usdc", amount: "1000000", finalized: true }],
    liabilities: [{ ...common, id: "job:original", originalId: "job:original", evidenceId: "job:proof", category: "prepaid-job-cap", units: "micro-usdc", amount: "500000", outcome: "due", dueAt: null, confirmationId: null }],
    inclusions: [], policy: { originalId: "policy:original", evidenceId: "policy:proof", scope, snapshotId, observedAt,
      expiresAt: "2026-10-09T09:00:00.000Z", horizonAt: "2026-10-10T08:00:00.000Z", reviewed: true,
      reserveFloorMicroUsdc: "200000", operatingBudgetMicroUsdc: "100000", remainingOriginalCapacityMicroUsdc: "900000" } };
  // A literal detached JSON fixture, without shared references or authority from environment.
  return JSON.parse(JSON.stringify(fixture)) as ObligationSnapshot;
}
export function fixtureLiability(id: string, amount: string, category: ObligationSnapshot["liabilities"][number]["category"] = "payment-exposure") {
  const row = obligationFixture().liabilities[0];
  return { ...row, id, originalId: id, evidenceId: `${id}:proof`, amount, category };
}
export function nativeInspectionFixture() {
  const s = obligationFixture(); s.source = "native-journal"; s.consistency = "partial"; s.domains = []; s.cash = []; s.overlap = "unresolved"; s.policy = null;
  s.scope.compartment = "gateway"; s.liabilities.forEach(r => { r.scope.compartment = "gateway"; });
  return { version: 1 as const, readerWallet: OBLIGATION_FIXTURE_OWNER, projection: projectOperatorObligations(s, OBLIGATION_FIXTURE_TIME) };
}

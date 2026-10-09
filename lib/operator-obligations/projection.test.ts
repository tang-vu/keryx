import { describe, expect, it } from "vitest";
import { canonicalJson } from "../canonical-json";
import { obligationFixture, fixtureLiability, OBLIGATION_FIXTURE_TIME as NOW } from "../../test-support/operator-obligations";
import { projectOperatorObligations } from "./projection";
import type { ObligationSnapshot } from "./contracts";

const run = (s: ObligationSnapshot) => projectOperatorObligations(s, NOW);
const refused = (s: ObligationSnapshot, reason: string) => {
  const r = run(s); expect(r.status).toBe("unknown"); expect(r.reasons).toContain(reason);
  expect(r.safeNewSpendMicroUsdc).toBe("0"); expect(r.advisorySurplusMicroUsdc).toBe("0"); return r;
};
describe("exact nonauthorizing obligation projection", () => {
  it("matches the documented example and rounds native gas up rather than losing dust", () => {
    const s = obligationFixture(); const gas = fixtureLiability("gas:original", "9999000000000001", "gas-fee"); gas.units = "native-18";
    s.liabilities.push(gas); const r = run(s);
    expect(r.protectedMicroUsdc).toBe("510000"); expect(r.advisorySurplusMicroUsdc).toBe("190000"); expect(r.safeNewSpendMicroUsdc).toBe("100000");
    expect(r.advisoryOnly).toBe(true); expect(r.spendAuthority).toBe(false); expect(r.nativeComplete).toBe(false);
  });
  it("counts Arc native and ERC20 views once, with native dust floored for liquid cash", () => {
    const s = obligationFixture(); s.cash.push({ ...structuredClone(s.cash[0]), id: "cash:native", kind: "wallet-native", units: "native-18", amount: "1000000000000000001" });
    expect(run(s).liquidMicroUsdc).toBe("1000000"); expect(run(s).status).toBe("estimated");
  });
  it("preserves values above Number.MAX_SAFE_INTEGER exactly", () => {
    const s = obligationFixture(); s.cash[0].amount = "999999999999999999999999999999";
    s.liabilities[0].amount = "999999999999999999000000000000";
    expect(run(s).advisorySurplusMicroUsdc).toBe("999999699999");
  });
  it("never uses incoming mint, bridge value, vault mark or disputed funds as liquid", () => {
    const s = obligationFixture(); for (const kind of ["incoming-pending", "bridge-in-transit", "vault-quote", "disputed"] as const) {
      s.cash.push({ ...structuredClone(s.cash[0]), id: kind, originalId: kind, balanceId: kind, kind, amount: "400000", finalized: false });
    }
    const r = run(s); expect(r.liquidMicroUsdc).toBe("1000000"); expect(r.excludedNonLiquidMicroUsdc).toBe("1600000"); expect(r.advisorySurplusMicroUsdc).toBe("200000");
    s.cash[0].amount = "0"; expect(refused(s, "coverage-short").coverageShortfallMicroUsdc).toBe("700000");
  });
  it("deduplicates proved creator legs and redeemed slots without losing earlier due times", () => {
    const s = obligationFixture(); s.liabilities[0].dueAt = "2026-10-12T08:00:00.000Z";
    s.liabilities.push(fixtureLiability("reward:original", "50000", "creator-debt"), fixtureLiability("slot:original", "400000", "monthly-slot-cap"));
    s.inclusions = [{ childId: "reward:original", parentId: "job:original", kind: "creator-leg-in-job-cap", evidenceId: "membership:reward", snapshotId: s.snapshotId },
      { childId: "slot:original", parentId: "job:original", kind: "monthly-slot-redeemed-to-job", evidenceId: "redemption:original", snapshotId: s.snapshotId }];
    const r = run(s); expect(r.protectedMicroUsdc).toBe("500000"); expect(r.dueNowMicroUsdc).toBe("500000"); expect(r.dueWithinHorizonMicroUsdc).toBe("500000");
  });
  it("keeps unproved overlap conservatively double reserved and refuses surplus", () => {
    const s = obligationFixture(); s.liabilities.push(fixtureLiability("held:original", "50000")); s.overlap = "unresolved";
    expect(refused(s, "overlap-unresolved").protectedMicroUsdc).toBe("550000");
  });
  it("does not subtract a confirmed historical debit again; uncertain failed originals stay held", () => {
    const s = obligationFixture(); const confirmed = fixtureLiability("confirmed:original", "100000"); confirmed.outcome = "confirmed-debit"; confirmed.confirmationId = "confirmation:exact-original";
    s.liabilities.push(confirmed, { ...fixtureLiability("unknown:original", "50000"), outcome: "uncertain" });
    expect(run(s).protectedMicroUsdc).toBe("550000"); confirmed.confirmationId = null;
    s.liabilities[1] = confirmed; expect(refused(s, "unverified-outcome").protectedMicroUsdc).toBe("650000");
  });
  it("protects every private allocation, remedy, withdrawal, supplier and missing deadline now", () => {
    const s = obligationFixture(); const categories = ["delivery-remedy", "refund-withdrawal", "provider-commitment", "creator-debt", "payment-exposure"] as const;
    categories.forEach((category, i) => s.liabilities.push(fixtureLiability(`original:${i}`, "10000", category)));
    const r = run(s); expect(r.protectedMicroUsdc).toBe("550000"); expect(r.dueNowMicroUsdc).toBe("550000");
    s.liabilities[0].dueAt = "2026-10-20T08:00:00.000Z";
    expect(run(s).protectedMicroUsdc).toBe("550000"); expect(run(s).dueWithinHorizonMicroUsdc).toBe("50000");
  });
  it("stale original evidence releases neither a historical debit hold nor included creator hold", () => {
    const s = obligationFixture(), leg = fixtureLiability("leg:stale", "50000", "creator-debt");
    leg.observedAt = "2026-10-09T07:59:29.000Z"; s.liabilities.push(leg);
    s.inclusions.push({ childId: leg.id, parentId: s.liabilities[0].id, kind: "creator-leg-in-job-cap", evidenceId: "membership:stale", snapshotId: s.snapshotId });
    expect(refused(s, "stale-observation").protectedMicroUsdc).toBe("550000");
    s.inclusions = []; leg.outcome = "confirmed-debit"; leg.confirmationId = "confirmation:stale";
    expect(refused(s, "stale-observation").protectedMicroUsdc).toBe("550000");
  });
  it("bounds safe new work by original policy capacity, independently of cash", () => {
    const s = obligationFixture(); s.policy!.remainingOriginalCapacityMicroUsdc = "17";
    expect(run(s).safeNewSpendMicroUsdc).toBe("17"); expect(run(s).advisorySurplusMicroUsdc).toBe("200000");
  });
  it.each(["custodyWallet", "signer", "custodyRole", "storageIdentityDigest", "network", "compartment"] as const)("refuses foreign %s", field => {
    const s = obligationFixture(); const patch = { custodyWallet: `0x${"3".repeat(40)}`, signer: `0x${"4".repeat(40)}`, custodyRole: "private-hosted", storageIdentityDigest: "b".repeat(64), network: "eip155:5042002", compartment: "gateway" };
    Object.assign(s.liabilities[0].scope, { [field]: patch[field] }); refused(s, "foreign-binding");
  });
  it.each(["native-journal", "partial", "stale", "missing-domain", "partial-domain", "missing-policy", "unreviewed", "expired", "unknown-floor", "unknown-original"])("refuses %s rather than promising zero obligations", mode => {
    const s = obligationFixture(); let reason = "";
    if (mode === "native-journal") { s.source = "native-journal"; reason = "native-complete-unavailable"; }
    if (mode === "partial") { s.consistency = "partial"; reason = "partial-snapshot"; }
    if (mode === "stale") { s.liabilities[0].observedAt = "2026-10-09T07:59:29.000Z"; reason = "stale-observation"; }
    if (mode === "missing-domain") { s.domains.pop(); reason = "missing-domain"; }
    if (mode === "partial-domain") { s.domains[0].coverage = "unavailable"; reason = "partial-domain"; }
    if (mode === "missing-policy") { s.policy = null; reason = "missing-policy"; }
    if (mode === "unreviewed") { s.policy!.reviewed = false; reason = "policy-unreviewed"; }
    if (mode === "expired") { s.policy!.expiresAt = s.observedAt; reason = "policy-expired"; }
    if (mode === "unknown-floor") { s.policy!.reserveFloorMicroUsdc = null; reason = "missing-policy"; }
    if (mode === "unknown-original") { s.liabilities[0].verifiedOriginal = false; reason = "unverified-original"; }
    expect(refused(s, reason).protectedMicroUsdc).toBe("500000");
  });
  it.each(["missing", "excess", "self", "foreign-snapshot", "duplicate"])("refuses %s inclusion and keeps full holds", mode => {
    const s = obligationFixture(); s.liabilities.push(fixtureLiability("leg:original", mode === "excess" ? "500001" : "50000"));
    const link = { childId: "leg:original", parentId: "job:original", kind: "creator-leg-in-job-cap" as const, evidenceId: "membership:original", snapshotId: s.snapshotId };
    if (mode === "missing") link.parentId = "not-found";
    if (mode === "self") link.parentId = link.childId;
    if (mode === "foreign-snapshot") link.snapshotId = "other:snapshot";
    s.inclusions.push(link); if (mode === "duplicate") s.inclusions.push(structuredClone(link));
    expect(BigInt(refused(s, "ambiguous-inclusion").protectedMicroUsdc)).toBeGreaterThan(BigInt(500000));
  });
  it("conflicting duplicate originals fail independently of order, while identical duplicates deduplicate", () => {
    const s = obligationFixture(); s.liabilities.push(structuredClone(s.liabilities[0])); expect(run(s).protectedMicroUsdc).toBe("500000");
    s.liabilities[1].amount = "600000"; const a = refused(s, "conflicting-original"); s.liabilities.reverse(); const b = refused(s, "conflicting-original");
    expect(a.protectedMicroUsdc).toBe("1100000"); expect(b.protectedMicroUsdc).toBe(a.protectedMicroUsdc);
  });
  it("refuses cash alias mismatches and unverified cash", () => {
    const s = obligationFixture(); s.cash.push({ ...structuredClone(s.cash[0]), id: "cash:native", kind: "wallet-native", units: "native-18", amount: "2000000000000000000" });
    expect(refused(s, "cash-alias-mismatch").liquidMicroUsdc).toBeNull(); s.cash.pop(); s.cash[0].finalized = false;
    expect(refused(s, "cash-unverified").liquidMicroUsdc).toBeNull();
  });
  it("does not pool Gateway cash into wallet liquidity or unsupported FX", () => {
    const s = obligationFixture(); s.cash[0].kind = "gateway-available"; refused(s, "wrong-units");
    s.cash[0].scope.asset = "0xother" as ObligationSnapshot["scope"]["asset"]; expect(() => run(s)).toThrow();
  });
  it("rejects noncanonical/fractional/negative amount strings and oversized identities/arrays", () => {
    for (const amount of ["-1", "01", "0.1", "1e6", "9".repeat(31)]) { const s = obligationFixture(); s.cash[0].amount = amount; expect(() => run(s)).toThrow(); }
    const s = obligationFixture(); s.liabilities[0].originalId = "x".repeat(129); expect(() => run(s)).toThrow();
    s.liabilities = Array(1001).fill(null); expect(() => run(s)).toThrow();
  });
  it("explicitly refuses an aggregate beyond the supported 30-digit result bound without truncation", () => {
    const s = obligationFixture(); s.liabilities[0].amount = "9".repeat(30);
    s.liabilities.push(fixtureLiability("second:original", "9".repeat(30)));
    expect(() => run(s)).toThrow();
  });
  it("rejects getters/cycles without invoking untrusted code, and never mutates an immutable fixture", () => {
    const s = obligationFixture(); Object.defineProperty(s, "observedAt", { get() { throw new Error("getter invoked"); }, enumerable: true });
    expect(() => run(s)).toThrow("Invalid obligation input");
    const original = obligationFixture(), before = canonicalJson(original); Object.freeze(original); run(original); expect(canonicalJson(original)).toBe(before);
    const cycle: Record<string, unknown> = {}; cycle.self = cycle; expect(() => projectOperatorObligations(cycle, NOW)).toThrow("Invalid obligation input");
  });
});

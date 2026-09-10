import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ config: { networkId: "eip155:5042002", cctpDomain: 26 }, balance: vi.fn() }));
vi.mock("../config", () => ({ config: state.config }));
vi.mock("../gateway/gateway-balance", () => ({ getGatewayAvailableAtomic: state.balance }));
import { inspectPrivateTreasuryBacking } from "./private-treasury-backing";

const policy = { signer: `0x${"ab".repeat(20)}`, capacityMicros: "100000" };
const summary = { capacityMicros: "100000", allocatedMicros: "80000", unallocatedMicros: "20000", committedMicros: "30000",
  confirmedMicros: "18000", unresolvedOrProcessingMicros: "12000", conservativeBackingMicros: "82000",
  observation: "database-recorded" as const, chainFinalityVerified: false as const };
afterEach(() => { vi.clearAllMocks(); state.config.cctpDomain = 26; });

it("compares exact available micros to conservative coverage without interpreting unknown as zero", async () => {
  const db = { getPrivateTreasurySummary: vi.fn(async () => summary) };
  state.balance.mockResolvedValueOnce(null).mockResolvedValueOnce(BigInt(0)).mockResolvedValueOnce(BigInt(81999)).mockResolvedValueOnce(BigInt(82000));
  expect(await inspectPrivateTreasuryBacking(db, policy)).toEqual({ status: "balance-unavailable", checkoutReady: false });
  expect(await inspectPrivateTreasuryBacking(db, policy)).toMatchObject({ status: "insufficient", availableMicros: "0", requiredBackingMicros: "82000" });
  expect(await inspectPrivateTreasuryBacking(db, policy)).toMatchObject({ status: "insufficient" });
  expect(await inspectPrivateTreasuryBacking(db, policy)).toMatchObject({ status: "backed", unallocatedMicros: "20000", checkoutReady: false });
  expect(state.balance).toHaveBeenLastCalledWith(policy.signer);
});

it("requires full configured backing for a pool not yet created and rejects accounting changes", async () => {
  const db = { getPrivateTreasurySummary: vi.fn().mockResolvedValue(null) };
  state.balance.mockResolvedValue(BigInt(100000));
  expect(await inspectPrivateTreasuryBacking(db, policy)).toMatchObject({ status: "backed", poolExists: false, requiredBackingMicros: "100000" });
  db.getPrivateTreasurySummary.mockResolvedValueOnce(summary).mockResolvedValueOnce({ ...summary, allocatedMicros: "90000", unallocatedMicros: "10000" });
  expect(await inspectPrivateTreasuryBacking(db, policy)).toEqual({ status: "accounting-changed", checkoutReady: false });
});

it("rejects mismatched policy and cancellation before further work, and redacts database failures", async () => {
  const db = { getPrivateTreasurySummary: vi.fn(async () => summary) };
  state.config.cctpDomain = 0;
  expect(await inspectPrivateTreasuryBacking(db, policy)).toMatchObject({ status: "policy-mismatch" });
  expect(db.getPrivateTreasurySummary).not.toHaveBeenCalled();
  state.config.cctpDomain = 26;
  expect(await inspectPrivateTreasuryBacking(db, { ...policy, capacityMicros: "99999" })).toMatchObject({ status: "policy-mismatch" });
  expect(state.balance).not.toHaveBeenCalled();
  const stop = new AbortController();
  state.balance.mockImplementationOnce(async () => { stop.abort(); return BigInt(100000); });
  db.getPrivateTreasurySummary.mockClear();
  expect(await inspectPrivateTreasuryBacking(db, policy, stop.signal)).toMatchObject({ status: "cancelled" });
  expect(db.getPrivateTreasurySummary).toHaveBeenCalledTimes(1);
  db.getPrivateTreasurySummary.mockRejectedValueOnce(new Error("Synthetic private database detail"));
  expect(await inspectPrivateTreasuryBacking(db, policy)).toEqual({ status: "accounting-unavailable", checkoutReady: false });
});

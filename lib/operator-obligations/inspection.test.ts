import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "../db/storage-identity";
import { OBLIGATION_FIXTURE_OWNER as READER, OBLIGATION_FIXTURE_TIME as NOW } from "../../test-support/operator-obligations";

const mocks = vi.hoisted(() => ({ open: vi.fn(), identity: vi.fn(), policy: vi.fn() }));
vi.mock("../db/application-storage", () => ({ createReadonlyApplicationStorage: mocks.open, applicationSqliteIdentity: mocks.identity }));
vi.mock("../payments/hosted-treasury-policy", () => ({ configuredHostedTreasuryPolicy: mocks.policy }));
vi.mock("../config", () => ({ config: { baseUrl: "https://inspection.example" } }));
import { inspectOperatorObligations } from "./inspection";

const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", network: "eip155:5042", authorityMode: "mainnet-real",
  deploymentId: "11111111-1111-4111-8111-111111111111", storageId: "22222222-2222-4222-8222-222222222222",
  enrollmentId: "33333333-3333-4333-8333-333333333333", enrolledAt: "2026-10-04T00:00:00.000Z", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, provenanceDigest: "b".repeat(64) };
function fixture() {
  const db = { close: vi.fn(), operatorInventory: vi.fn(async () => ({ observedAt: new Date(NOW).toISOString(), network: "eip155:5042",
    queuedJobs: 1, processingJobs: 1, reviewRequiredJobs: 0, invalidJobs: 0, queuedCreatorMicroUsdc: "1000", unfinishedCreatorMicroUsdc: "2000",
    prepaidCreatorMicroUsdc: "500", prepaidRequests: 1, largestCreatorMicroUsdc: "2000" })),
    hostedTreasuryAccounting: vi.fn(async () => ({ retainedMicroUsdc: "300", confirmedMicroUsdc: "50" })) };
  mocks.open.mockResolvedValue(db); mocks.identity.mockReturnValue(identity);
  mocks.policy.mockReturnValue({ signer: `0x${"2".repeat(40)}`, lifetimeCapMicroUsdc: "1000000", expiresAtSeconds: Math.floor(NOW / 1000) + 3600 });
  return db;
}
describe("readonly native observation port", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.resetAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });
  it("binds actual custody separately, keeps aggregate overlap partial, and closes the selected reader", async () => {
    const db = fixture(), value = await inspectOperatorObligations({ wallet: READER, role: "public" });
    expect(value.readerWallet).toBe(READER); expect(value.projection.scope.custodyWallet).toBe(`0x${"2".repeat(40)}`); expect(value.projection.scope.custodyWallet).not.toBe(READER);
    expect(value.projection.protectedMicroUsdc).toBe("3750"); expect(value.projection.liquidMicroUsdc).toBeNull(); expect(value.projection.safeNewSpendMicroUsdc).toBe("0");
    expect(value.projection.advisorySurplusMicroUsdc).toBe("0"); expect(value.projection.remainingOriginalCapacityMicroUsdc).toBe("999700");
    expect(value.projection.reasons).toEqual(expect.arrayContaining(["missing-domain", "cash-unverified", "overlap-unresolved", "native-complete-unavailable", "missing-policy"]));
    expect(db.hostedTreasuryAccounting).toHaveBeenCalledWith(`0x${"2".repeat(40)}`, "public"); expect(db.close).toHaveBeenCalledOnce();
    expect(mocks.policy).toHaveBeenCalledWith(identity, "https://inspection.example", "public");
  });
  it("never imports public prepaid books into a private custody role", async () => {
    const db = fixture(), value = await inspectOperatorObligations({ wallet: READER, role: "private" });
    expect(db.operatorInventory).not.toHaveBeenCalled(); expect(db.hostedTreasuryAccounting).toHaveBeenCalledWith(`0x${"2".repeat(40)}`, "private");
    expect(value.projection.protectedMicroUsdc).toBe("250"); expect(value.projection.scope.custodyRole).toBe("private-hosted"); expect(value.projection.status).toBe("unknown");
  });
  it.each(["foreign-network", "invalid-order", "malformed-money", "confirmation-over-retained", "cap-overrun", "changed-policy", "unavailable-book"])("refuses %s and retains generic error/closed reader", async mode => {
    const db = fixture();
    if (mode === "foreign-network" || mode === "invalid-order") {
      const prior = await db.operatorInventory(); db.operatorInventory.mockResolvedValue({ ...prior, ...(mode === "foreign-network" ? { network: "eip155:5042002" } : { invalidJobs: 1 }) });
    }
    if (mode === "malformed-money") db.hostedTreasuryAccounting.mockResolvedValue({ retainedMicroUsdc: "0.1", confirmedMicroUsdc: "0" });
    if (mode === "confirmation-over-retained") db.hostedTreasuryAccounting.mockResolvedValue({ retainedMicroUsdc: "1", confirmedMicroUsdc: "2" });
    if (mode === "cap-overrun") db.hostedTreasuryAccounting.mockResolvedValue({ retainedMicroUsdc: "1000001", confirmedMicroUsdc: "0" });
    if (mode === "changed-policy") { const p = mocks.policy(); mocks.policy.mockReturnValueOnce(p).mockReturnValue({ ...p, signer: `0x${"3".repeat(40)}` }); }
    if (mode === "unavailable-book") db.hostedTreasuryAccounting.mockRejectedValue(new Error("private original/path/detail"));
    await expect(inspectOperatorObligations({ wallet: READER, role: "public" })).rejects.toThrow("Operator obligation inspection unavailable"); expect(db.close).toHaveBeenCalledOnce();
  });
  it("never treats caller-shaped JSON as an installed native facade", async () => {
    const db = fixture(); const actual = await vi.importActual<typeof import("../db/application-storage")>("../db/application-storage");
    mocks.identity.mockImplementationOnce((value: KeryxDB) => actual.applicationSqliteIdentity(value, "read"));
    await expect(inspectOperatorObligations({ wallet: READER, role: "public" })).rejects.toThrow("Operator obligation inspection unavailable");
    expect(mocks.policy).not.toHaveBeenCalled(); expect(db.hostedTreasuryAccounting).not.toHaveBeenCalled(); expect(db.operatorInventory).not.toHaveBeenCalled(); expect(db.close).toHaveBeenCalledOnce();
  });
  it("unsupported storage has no fallback, alternate hydration or zero-complete result", async () => {
    mocks.open.mockResolvedValue(undefined);
    await expect(inspectOperatorObligations({ wallet: READER, role: "public" })).rejects.toThrow("Operator obligation inspection unavailable"); expect(mocks.open).toHaveBeenCalledOnce(); expect(mocks.identity).not.toHaveBeenCalled();
  });
});

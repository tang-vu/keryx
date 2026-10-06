import { beforeEach, describe, expect, it, vi } from "vitest";

const guards = vi.hoisted(() => ({ configured: vi.fn(), paused: vi.fn(), reserved: vi.fn(), inbound: vi.fn() }));
vi.mock("./canary-policy", () => ({ configuredBusinessCanary: guards.configured, canaryExecutionPaused: guards.paused,
  assertCanaryOriginalReserved: guards.reserved, reserveCanaryInboundSettlement: guards.inbound }));
import { businessCanaryPaidAdmission } from "./canary-paid-admission";

const input = { body: {}, signatureHeader: null, network: "eip155:5042", payee: `0x${"2".repeat(40)}`,
  amountMicroUsdc: "30000", creatorBudgetMicroUsdc: "10000", bot: false, reserveSettlement: true };
beforeEach(() => { vi.resetAllMocks(); guards.configured.mockReturnValue(null); guards.paused.mockReturnValue(false); });

describe("retained failed delivery paid admission", () => {
  it("keeps ordinary admission available only when there is no active or retained pause", () => {
    expect(businessCanaryPaidAdmission(input)).toBeNull(); expect(guards.paused).toHaveBeenCalled();
  });
  it("rejects a configured-null failed hold before parsing a body or reserving another inbound attempt", () => {
    guards.paused.mockReturnValue(true);
    const result = businessCanaryPaidAdmission({ ...input, signatureHeader: "malformed-untrusted-header" });
    expect(result?.status).toBe(503); expect(result?.headers.get("Cache-Control")).toBe("no-store");
    expect(guards.reserved).not.toHaveBeenCalled(); expect(guards.inbound).not.toHaveBeenCalled();
  });
  it("fails closed for malformed retained configuration", () => {
    guards.configured.mockImplementation(() => { throw Error("Synthetic retained state refused"); });
    expect(businessCanaryPaidAdmission(input)?.status).toBe(503); expect(guards.inbound).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { fundingReadiness, hasUncertainFunding } from "./funding-readiness";
import type { FundingRecord } from "./funding-policy";

function record(status: FundingRecord["deposit"]["status"], active = false): FundingRecord {
  return { activePayer: active ? "0x" : undefined, deposit: { status }, approval: { status: "confirmed" }, cancelled: false } as FundingRecord;
}

describe("buyer funding readiness", () => {
  it("requires actual Gateway credit to call a purchase funded", () => {
    expect(fundingReadiness("50000", "50000", [])).toBe("ready");
    expect(fundingReadiness("49999", "50000", [])).toBe("insufficient");
    expect(fundingReadiness(null, "50000", [])).toBe("unavailable");
  });

  it("keeps an Arc-confirmed deposit separate from Gateway credit", () => {
    const rows = [record("confirmed")];
    expect(fundingReadiness(null, "50000", rows)).toBe("deposit-unverified");
    expect(fundingReadiness(null, "50000", rows, true)).toBe("unavailable");
    expect(fundingReadiness("0", "50000", rows)).toBe("insufficient");
    expect(fundingReadiness("50000", "50000", rows)).toBe("ready");
    expect(fundingReadiness(null, "50000", [record("ready", true), ...rows])).toBe("unavailable");
  });

  it("flags submitted or uncertain funding for inspection", () => {
    expect(hasUncertainFunding([record("possible", true)])).toBe(true);
    expect(hasUncertainFunding([record("submitted", true)])).toBe(true);
    expect(hasUncertainFunding([record("confirmed")])).toBe(false);
  });
});

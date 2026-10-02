import { expect, it } from "vitest";
import { hasOriginalSessionDepositCredit } from "./session-funding-credit";
import type { FundingRecord } from "../buyer/funding-policy";

const baseline = "2026-10-02T10:00:00.000Z", signer = `0x${"22".repeat(20)}`;
const row = { network: "eip155:5042", depositor: signer, gatewayCreditBefore: "100000",
  gatewayCreditObservedAt: baseline, amount: "50000" } as FundingRecord;
const projection = { status: "known", address: signer, network: "eip155:5042", available: "140000",
  accountingAuthority: "original-admitted-settled-v1", observedAt: "2026-10-02T10:01:00.000Z",
  debitBaselineObservedAt: baseline, hasAuthorityHistory: true, confirmedSpentMicroUsdc: "10000",
  retainedSpentMicroUsdc: "10000", postBaselineConfirmedDebitMicroUsdc: "10000" };

it("acknowledges deposit credit net of only exact later-admitted confirmed debits", () => {
  expect(hasOriginalSessionDepositCredit(row, BigInt(140000))).toBe(false);
  expect(hasOriginalSessionDepositCredit(row, BigInt(140000), projection)).toBe(true);
  expect(hasOriginalSessionDepositCredit(row, BigInt(140000), { ...projection, postBaselineConfirmedDebitMicroUsdc: "0" })).toBe(false);
  expect(hasOriginalSessionDepositCredit(row, BigInt(140000), { ...projection,
    confirmedSpentMicroUsdc: "0", retainedSpentMicroUsdc: "10000", postBaselineConfirmedDebitMicroUsdc: "0" })).toBe(false);
});
it("refuses cross-signer, cross-rail, mismatched snapshots and unsupported original baselines", () => {
  for (const mutation of [{ address: `0x${"33".repeat(20)}` }, { network: "eip155:5042002" },
    { available: "150000" }, { debitBaselineObservedAt: "2026-10-02T09:59:00.000Z" },
    { observedAt: "2026-10-02T09:59:00.000Z" }, { postBaselineConfirmedDebitMicroUsdc: "10001" }])
    expect(() => hasOriginalSessionDepositCredit(row, BigInt(140000), { ...projection, ...mutation })).toThrow();
  expect(() => hasOriginalSessionDepositCredit({ ...row, gatewayCreditObservedAt: undefined }, BigInt(140000), projection)).toThrow();
});

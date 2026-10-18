import { beforeEach, expect, it, vi } from "vitest";
import type { PublicClient, WalletClient } from "viem";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), submit: vi.fn(), recover: vi.fn() }));
vi.mock("../browser-payment-profile", () => ({ browserPaymentProfile: () => ARC_MAINNET_PROFILE }));
vi.mock("../buyer/funding-journal", () => ({ listFundingRecords: mocks.list, createFundingRecord: mocks.create, acknowledgeSessionFundingCredit: vi.fn() }));
vi.mock("../buyer/funding-client", () => ({ submitFundingStep: mocks.submit, recoverFundingStep: mocks.recover }));
import { fundOwnerGatewaySession } from "./owner-gateway-funding";

const owner = `0x${"1".repeat(40)}` as const, signer = `0x${"2".repeat(40)}` as const;
const args = () => ({ owner, signer, amountMicros: "70000", knownAvailableMicros: BigInt(0),
  wallet: { request: vi.fn(async () => ({ "0x0": { keryxExactTransactionSigning: { supported: false } } })) } as unknown as WalletClient,
  rpc: {} as PublicClient });
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([]); });

it("refuses known unsupported Circle funding before creating a new owner plan", async () => {
  await expect(fundOwnerGatewaySession(args())).rejects.toMatchObject({ code: 4200 });
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
});

it("does not block an existing confirmed deposit or replace its journal to bypass the capability", async () => {
  const record = { activePayer: owner, payer: owner, depositor: signer, amount: "70000", approval: { status: "confirmed" }, deposit: { status: "confirmed" } };
  mocks.list.mockResolvedValue([record]); const input = args();
  expect(await fundOwnerGatewaySession(input)).toBe(record);
  expect(input.wallet.request).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
});

it("rechecks current owner after asynchronous preflight before creating custody metadata", async () => {
  const input = { ...args(), wallet: { request: vi.fn(async () => ({})) } as unknown as WalletClient,
    assertCurrent: () => { throw new Error("owner changed"); } };
  await expect(fundOwnerGatewaySession(input)).rejects.toThrow("owner changed");
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
});

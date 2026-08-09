import { describe, expect, it, vi } from "vitest";
import type { PaymentRecord } from "../types";
import {
  checkPendingTransfer,
  reconcilePendingPayments,
  searchCircleTransfer,
  type CircleX402Transfer,
} from "./x402-transfer-reconciliation";

const payment = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: "x402:0xabc",
  kind: "citation",
  queryId: "q1",
  sourceId: "s1",
  sourceName: "Source",
  payer: "0x1111111111111111111111111111111111111111",
  payee: "0x2222222222222222222222222222222222222222",
  amountUsdc: 0.004001,
  network: "eip155:5042002",
  settled: false,
  settlementStatus: "pending",
  authorizationId: "0xAbC",
  createdAt: "2026-08-08T00:00:00.000Z",
  ...overrides,
});

const transfer = (
  overrides: Partial<CircleX402Transfer> = {},
): CircleX402Transfer => ({
  id: "circle-transfer-id",
  status: "received",
  token: "USDC",
  sendingNetwork: "eip155:5042002",
  recipientNetwork: "eip155:5042002",
  fromAddress: "0x1111111111111111111111111111111111111111",
  toAddress: "0x2222222222222222222222222222222222222222",
  amount: "4001",
  nonce: "abc",
  txHash: null,
  createdAt: "2026-08-08T00:00:01.000Z",
  updatedAt: "2026-08-08T00:00:01.000Z",
  ...overrides,
});

describe("pending x402 transfer reconciliation", () => {
  it("accepts an exact Circle transfer in every non-failed lifecycle state", () => {
    for (const status of ["received", "batched", "confirmed", "completed"] as const) {
      expect(checkPendingTransfer(payment(), [transfer({ status })])).toMatchObject({
        verdict: "settled",
        transfer: { id: "circle-transfer-id", status },
      });
    }
  });

  it("fails closed when any economic field differs", () => {
    expect(
      checkPendingTransfer(payment(), [
        transfer({ toAddress: "0x3333333333333333333333333333333333333333" }),
      ]),
    ).toMatchObject({ verdict: "mismatch" });
    expect(checkPendingTransfer(payment(), [transfer({ amount: "4000" })])).toMatchObject({
      verdict: "mismatch",
    });
    expect(
      checkPendingTransfer(payment(), [transfer({ sendingNetwork: "eip155:1" })]),
    ).toMatchObject({ verdict: "mismatch" });
  });

  it("distinguishes not-yet-visible and explicitly failed transfers", () => {
    expect(checkPendingTransfer(payment(), [])).toMatchObject({ verdict: "awaiting" });
    expect(checkPendingTransfer(payment(), [transfer({ status: "failed" })])).toMatchObject({
      verdict: "failed",
    });
  });

  it("queries by nonce but treats filters as untrusted response shaping", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("nonce")).toBe("0xAbC");
      expect(url.searchParams.get("from")).toBe(payment().payer);
      expect(url.searchParams.get("to")).toBe(payment().payee);
      expect(url.searchParams.get("network")).toBe("eip155:5042002");
      return Response.json({ transfers: [transfer()] });
    }) as typeof fetch;

    await expect(searchCircleTransfer(payment(), undefined, fetchImpl)).resolves.toEqual([
      transfer(),
    ]);
  });

  it("promotes through an idempotent compare-and-set and persists an ops summary", async () => {
    const settlePendingPayment = vi.fn(async () => true);
    const failPendingPayment = vi.fn(async () => ({
      resolved: true,
      reservationReleased: false,
    }));
    const setSyncState = vi.fn(async () => undefined);
    const summary = await reconcilePendingPayments(
      {
        listPendingPayments: async () => [payment()],
        settlePendingPayment,
        failPendingPayment,
        setSyncState,
      },
      { search: async () => [transfer()] },
    );

    expect(settlePendingPayment).toHaveBeenCalledWith(
      "x402:0xabc",
      "0xAbC",
      "circle-transfer-id",
    );
    expect(summary).toMatchObject({ scanned: 1, promoted: 1, awaiting: 0, raced: 0 });
    expect(setSyncState).toHaveBeenCalledOnce();
  });

  it("terminalizes an exact Circle failure and records capacity release", async () => {
    const failPendingPayment = vi.fn(async () => ({
      resolved: true,
      reservationReleased: true,
    }));
    const summary = await reconcilePendingPayments(
      {
        listPendingPayments: async () => [payment({ grantEpoch: "epoch-1" })],
        settlePendingPayment: vi.fn(async () => false),
        failPendingPayment,
        setSyncState: vi.fn(async () => undefined),
      },
      { search: async () => [transfer({ status: "failed" })] },
    );

    expect(failPendingPayment).toHaveBeenCalledWith(
      "x402:0xabc",
      "0xAbC",
      "circle-transfer-id",
    );
    expect(summary).toMatchObject({
      scanned: 1,
      failed: 1,
      releasedReservations: 1,
      mismatched: 0,
      raced: 0,
    });
  });
});

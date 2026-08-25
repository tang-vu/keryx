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

  it("uses documented filters and treats response shaping as untrusted", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.has("nonce")).toBe(false);
      expect(url.searchParams.get("from")).toBe(payment().payer);
      expect(url.searchParams.get("to")).toBe(payment().payee);
      expect(url.searchParams.get("network")).toBe("eip155:5042002");
      expect(url.searchParams.get("token")).toBe("USDC");
      expect(url.searchParams.get("pageSize")).toBe("50");
      expect(url.searchParams.get("startDate")).toBe("2026-08-07T00:00:00.000Z");
      expect(url.searchParams.has("endDate")).toBe(false);
      return Response.json({ transfers: [transfer()] });
    }) as typeof fetch;

    await expect(searchCircleTransfer(payment(), undefined, fetchImpl)).resolves.toEqual([
      transfer(),
    ]);
  });

  it("follows Circle cursors so a later page can prove an older authorization", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (!url.searchParams.has("pageAfter")) {
        const next = new URL(url);
        next.searchParams.set("pageAfter", "cursor-2");
        return Response.json(
          { transfers: [transfer({ id: "newer", nonce: "0xdef" })] },
          { headers: { Link: `<${next}>; rel="next"` } },
        );
      }
      expect(url.searchParams.get("pageAfter")).toBe("cursor-2");
      return Response.json({ transfers: [transfer()] });
    }) as typeof fetch;

    await expect(searchCircleTransfer(payment(), undefined, fetchImpl)).resolves.toEqual([
      transfer({ id: "newer", nonce: "0xdef" }),
      transfer(),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a next-page link outside Circle's transfer endpoint", async () => {
    const fetchImpl = vi.fn(async () => Response.json(
      { transfers: [] },
      { headers: { Link: '<https://attacker.test/transfers?pageAfter=stolen>; rel="next"' } },
    )) as typeof fetch;

    await expect(searchCircleTransfer(payment(), undefined, fetchImpl)).rejects.toThrow(
      /untrusted next-page link/i,
    );
  });

  it("fails closed instead of treating a truncated cursor scan as no evidence", async () => {
    let cursor = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const next = new URL(String(input));
      next.searchParams.set("pageAfter", `cursor-${++cursor}`);
      return Response.json(
        { transfers: [] },
        { headers: { Link: `<${next}>; rel="next"` } },
      );
    }) as typeof fetch;

    await expect(searchCircleTransfer(payment(), undefined, fetchImpl)).rejects.toThrow(
      /exceeded 20 pages/i,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(20);
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

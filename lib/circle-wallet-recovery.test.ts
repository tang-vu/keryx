import { expect, it, vi } from "vitest";
import { circleRecoveryQuerySchema, listCircleRecoveryTransactions } from "./circle-wallet-recovery";
import { assertExactTransactionSigning } from "./circle-wallet-capabilities";
import type { WalletClient } from "viem";

const wallet = { id: "00000000-0000-4000-8000-000000000001", address: `0x${"1".repeat(40)}`, userId: "original-user", blockchain: "ARC" };
const query = { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" };
const hash = `0x${"a".repeat(64)}`;
const row = { id: "00000000-0000-4000-8000-000000000002", walletId: wallet.id, sourceAddress: wallet.address,
  userId: wallet.userId, blockchain: "ARC", transactionType: "OUTBOUND", createDate: query.from, state: "FAILED", txHash: hash };

it("queries only the verified wallet/profile/window and returns metadata without promoting Circle FAILED to terminal proof", async () => {
  const request = vi.fn(async (_path: string): Promise<Record<string, unknown>> => ({ transactions: [{ ...row, privateVendorField: "never-return" }] }));
  const page = await listCircleRecoveryTransactions({ wallet, query, request });
  const url = new URL(`https://api.circle.com/v1/w3s/${request.mock.calls[0][0]}`);
  expect(Object.fromEntries(url.searchParams)).toEqual({ walletIds: wallet.id, blockchain: "ARC", txType: "OUTBOUND",
    from: query.from, to: query.to, pageSize: "20", order: "ASC" });
  expect(page).toEqual({ owner: wallet.address, ...query, transactions: [{ id: row.id, hash, createdAt: row.createDate, status: "FAILED" }] });
  expect(JSON.stringify(page)).not.toContain("never-return");
});

it.each([{ walletId: "00000000-0000-4000-8000-000000000003" }, { userId: "different-user" }, { blockchain: "ARC-TESTNET" },
  { sourceAddress: `0x${"2".repeat(40)}` }, { transactionType: "INBOUND" }, { createDate: "2025-12-31T23:59:59Z" },
  { createDate: "2026-01-03T00:00:00Z" }, { txHash: "not-a-hash" }, { id: "not-a-cursor" }])(
  "refuses a vendor row outside exact recovery scope: %j", async mutation => {
    await expect(listCircleRecoveryTransactions({ wallet, query, request: async () => ({ transactions: [{ ...row, ...mutation }] }) })).rejects.toThrow();
  });

it("treats a full page as incomplete and forwards only a UUID cursor, never a vendor URL", async () => {
  const rows = Array.from({ length: 20 }, (_, n) => ({ ...row, id: `00000000-0000-4000-8000-${String(n + 2).padStart(12, "0")}` }));
  const request = vi.fn(async (_path: string): Promise<Record<string, unknown>> => ({ transactions: rows, nextPage: "https://attacker.invalid" }));
  const page = await listCircleRecoveryTransactions({ wallet, query, request });
  expect(page.nextPageAfter).toBe(rows.at(-1)!.id);
  request.mockResolvedValueOnce({ transactions: [] });
  expect((await listCircleRecoveryTransactions({ wallet, query: { ...query, pageAfter: page.nextPageAfter }, request })).transactions).toEqual([]);
  expect(request.mock.calls[1][0]).toContain(`pageAfter=${page.nextPageAfter}`);
  expect(request.mock.calls.every(([p]) => p.startsWith("transactions?"))).toBe(true);
});

it.each([null, "", undefined])("keeps a pending transaction without a hash as metadata only: %s", async txHash => {
  const page = await listCircleRecoveryTransactions({ wallet, query, request: async () => ({ transactions: [{ ...row, state: "INITIATED", txHash }] }) });
  expect(page.transactions[0].hash).toBeUndefined();
  expect(page.transactions[0].id).toBe(row.id);
});

it("refuses duplicate, repeated, oversized and malformed pages without returning partial evidence", async () => {
  for (const transactions of [[row, row], Array.from({ length: 21 }, () => row), undefined]) {
    await expect(listCircleRecoveryTransactions({ wallet, query, request: async () => ({ transactions }) })).rejects.toThrow();
  }
  await expect(listCircleRecoveryTransactions({ wallet, query: { ...query, pageAfter: row.id }, request: async () => ({ transactions: [row] }) })).rejects.toThrow();
});

it("bounds windows and refuses caller-injected wallet/filter/URL fields before any request", async () => {
  const request = vi.fn();
  for (const q of [{ ...query, from: query.to, to: query.from }, { ...query, to: "2026-03-01T00:00:00.000Z" },
    { ...query, pageAfter: "https://attacker.invalid" }, { ...query, walletIds: "other-wallet" }]) {
    expect(circleRecoveryQuerySchema.safeParse(q).success).toBe(false);
    await expect(listCircleRecoveryTransactions({ wallet, query: q, request })).rejects.toThrow();
  }
  await expect(listCircleRecoveryTransactions({ wallet, query: { from: "2099-01-01T00:00:00Z", to: "2099-01-02T00:00:00Z" }, request })).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

it.each(["0x13b2", "0x0"])("honors explicit Keryx signing denial outside the legacy unsupported-method catch: %s", async key => {
  const request = vi.fn(async () => ({ [key]: { keryxExactTransactionSigning: { supported: false } } }));
  await expect(assertExactTransactionSigning({ request } as unknown as WalletClient, wallet.address, 5042)).rejects.toMatchObject({ code: 4200 });
  expect(request).toHaveBeenCalledExactlyOnceWith({ method: "wallet_getCapabilities", params: [wallet.address, ["0x13b2"]] });
});
it.each([4200, -32601])("preserves legacy wallets lacking capability metadata, but never treats a network failure as support: %s", async code => {
  const request = vi.fn().mockRejectedValueOnce({ cause: { code } }).mockRejectedValueOnce(new Error("network unavailable"));
  await expect(assertExactTransactionSigning({ request } as unknown as WalletClient, wallet.address, 5042)).resolves.toBeUndefined();
  await expect(assertExactTransactionSigning({ request } as unknown as WalletClient, wallet.address, 5042)).rejects.toThrow("network unavailable");
});
it("checks abort around capability metadata without claiming or signing", async () => {
  const abort = new AbortController(), request = vi.fn(async () => { abort.abort(); return {}; });
  await expect(assertExactTransactionSigning({ request } as unknown as WalletClient, wallet.address, 5042, abort.signal)).rejects.toThrow();
  expect(request).toHaveBeenCalledOnce();
});

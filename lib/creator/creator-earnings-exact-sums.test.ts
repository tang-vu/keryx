import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { CreatorEarnings } from "../db/keryx-db";
import type { PaymentRecord, Source } from "../types";
import { formatRecordedUsdc, recordedUsdcMicros } from "../display/recorded-usdc";

const store = vi.hoisted(() => ({ getDb: vi.fn(), source: vi.fn(), payments: vi.fn(), leaderboard: vi.fn(),
  questions: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: store.getDb }));
import { GET } from "@/app/api/creator/[id]/route";

const source: Source = { id: "exact-creator", name: "Synthetic creator", url: "https://creator.example", description: "Public fixture",
  walletAddress: `0x${"cd".repeat(20)}`, fetchPrice: 0.001, tags: [], authors: [], createdAt: "2026-10-01T00:00:00.000Z" };
function payment(id: string, amountUsdc: number, extra: Partial<PaymentRecord> = {}): PaymentRecord {
  return { id, queryId: `query-${id}`, sourceId: source.id, sourceName: source.name, kind: "fetch", amountUsdc,
    settled: true, settlementStatus: "settled", txHash: `recorded-${id}`, network: "eip155:5042002",
    payer: `0x${"ab".repeat(20)}`, payee: source.walletAddress, createdAt: "2026-10-01T00:00:00.000Z", ...extra };
}
function request() {
  return GET(new NextRequest(`https://creator.example/api/creator/${source.id}`), { params: Promise.resolve({ id: source.id }) });
}
const legs = () => [payment("a", 0.000001), payment("b", 0.000004, { kind: "citation" })];

beforeEach(() => {
  vi.clearAllMocks();
  store.getDb.mockResolvedValue({ getSource: store.source, listPaymentsBySource: store.payments, creatorLeaderboard: store.leaderboard,
    runPrivacyActive: true, runPrivacy: { list: store.questions }, getSyncState: store.sync });
  store.source.mockResolvedValue(source); store.payments.mockResolvedValue(legs()); store.leaderboard.mockResolvedValue([]);
  store.questions.mockResolvedValue([]); store.sync.mockResolvedValue(null);
});

it("returns an exact settled total that the actual public money formatter can display", async () => {
  const response = await request(), body = await response.json();
  expect(response.status).toBe(200);
  expect(body.stats.settledTotal).toBe(0.000005);
  expect(recordedUsdcMicros(body.stats.settledTotal)).toBe(BigInt(5));
  expect(formatRecordedUsdc(body.stats.settledTotal)).toBe("$0.000005");
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("keeps daily earnings in exact micro-USDC when binary decimal addition would drift", async () => {
  const response = await request(), body = await response.json();
  expect(response.status).toBe(200);
  expect(body.dailyEarnings).toEqual([{ date: "2026-10-01", amount: 0.000005 }]);
  expect(formatRecordedUsdc(body.dailyEarnings[0].amount)).toBe("$0.000005");
});

it("uses the same exact total for the no-leaderboard fallback", async () => {
  const response = await request(), body = await response.json();
  expect(response.status).toBe(200);
  expect(body.stats).toEqual({ totalEarned: 0.000005, settledTotal: 0.000005, paymentCount: 2, citationCount: 1, rank: 0 });
});

it("groups multiple days chronologically and retains each leg's exact amount", async () => {
  store.payments.mockResolvedValue([
    payment("c", 0.0157, { createdAt: "2026-10-02T00:00:00.000Z" }),
    payment("a", 0.000001), payment("d", 0.0002, { createdAt: "2026-10-02T00:00:00.000Z" }),
    payment("b", 0.000002, { kind: "citation" }),
  ]);
  const response = await request(), body = await response.json();
  expect(response.status).toBe(200);
  expect(body.stats.settledTotal).toBe(0.015903);
  expect(body.dailyEarnings).toEqual([{ date: "2026-10-01", amount: 0.000003 }, { date: "2026-10-02", amount: 0.0159 }]);
  expect(body.recentPayments.map((p: { amountUsdc: number }) => p.amountUsdc)).toEqual([0.0157, 0.000001, 0.0002, 0.000002]);
});

it("preserves payout-kind and settled filters while retaining pending/failed recent rows", async () => {
  store.payments.mockResolvedValue([...legs(), payment("pending", 0.5, { settled: false, settlementStatus: "pending" }),
    payment("failed", 0.75, { settled: false, settlementStatus: "failed" }), payment("inbound", 9, { kind: "inbound" })]);
  const response = await request(), body = await response.json();
  expect(response.status).toBe(200);
  expect(body.stats).toMatchObject({ settledTotal: 0.000005, paymentCount: 2, citationCount: 1 });
  expect(body.dailyEarnings).toEqual([{ date: "2026-10-01", amount: 0.000005 }]);
  expect(body.recentPayments.map((p: { id: string }) => p.id)).toEqual(["a", "b", "pending", "failed"]);
});

it("preserves separately read leaderboard totals, counts and rank", async () => {
  const board: CreatorEarnings[] = [
    { sourceId: "other", sourceName: "Other", walletAddress: `0x${"ef".repeat(20)}`, totalEarnedUsdc: 0.000008, paymentCount: 4, citationCount: 3 },
    { sourceId: source.id, sourceName: source.name, walletAddress: source.walletAddress, totalEarnedUsdc: 0.000007, paymentCount: 3, citationCount: 2 },
  ];
  store.leaderboard.mockResolvedValue(board);
  const response = await request(), body = await response.json();
  expect(response.status).toBe(200);
  expect(body.stats).toEqual({ totalEarned: 0.000007, settledTotal: 0.000005, paymentCount: 3, citationCount: 2, rank: 2 });
  expect(store.payments).toHaveBeenCalledExactlyOnceWith(source.id);
  expect(store.leaderboard).toHaveBeenCalledOnce();
});

it("retains a real empty ledger as numeric zero and no chart rows", async () => {
  store.payments.mockResolvedValue([]);
  const response = await request(), body = await response.json();
  expect(response.status).toBe(200);
  expect(body.stats).toEqual({ totalEarned: 0, settledTotal: 0, paymentCount: 0, citationCount: 0, rank: 0 });
  expect(body.dailyEarnings).toEqual([]);
});

it.each([0, 0.0157, 1, 9007199254.74099])("retains valid recorded decimal %s without rounding or a DTO change", async amount => {
  store.payments.mockResolvedValue([payment("valid", amount)]);
  const response = await request(), body = await response.json();
  expect(response.status).toBe(200);
  expect(body.stats.settledTotal).toBe(amount);
  expect(body.dailyEarnings).toEqual([{ date: "2026-10-01", amount }]);
  expect(body.recentPayments[0].amountUsdc).toBe(amount);
});

it.each([NaN, Infinity, -0, -0.000001, 0.0000001, 0.0000030000000000000004])(
  "refuses invalid recorded settled leg %s through the existing sanitized failure", async amount => {
    store.payments.mockResolvedValue([payment("invalid", amount, { rationale: "PRIVATE_FINANCIAL_INPUT" })]);
    const response = await request();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "creator_data_unavailable" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  },
);

it.each([0.000001, 0.000002])("refuses a total that cannot round-trip its exact integer micros (+%s)", async increment => {
  const large = 9007199254.74099;
  expect(recordedUsdcMicros(large)).toBe(BigInt("9007199254740990"));
  store.payments.mockResolvedValue([payment("large", large), payment("increment", increment)]);
  const response = await request();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "creator_data_unavailable" });
});

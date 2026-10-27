import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { PaymentRecord, QueryRun, Source } from "../types";
import type { CreatorEarnings } from "../db/keryx-db";

const store = vi.hoisted(() => ({ getDb: vi.fn(), source: vi.fn(), payments: vi.fn(), leaderboard: vi.fn(),
  publicQuestions: vi.fn(), sync: vi.fn(), paper: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: store.getDb }));
import { GET } from "@/app/api/creator/[id]/route";

const source: Source = { id: "source-a", name: "Synthetic creator", url: "https://creator.example", description: "Public description",
  walletAddress: `0x${"cd".repeat(20)}`, fetchPrice: 0.001, tags: ["research"], authors: [], createdAt: "2026-10-01T00:00:00.000Z" };
const payment: PaymentRecord = { id: "synthetic-payment", queryId: "private-run", sourceId: source.id, sourceName: source.name,
  kind: "fetch", amountUsdc: 0.000003, settled: true, settlementStatus: "settled", txHash: "synthetic-recorded-reference",
  network: "eip155:5042002", payer: `0x${"ab".repeat(20)}`, payee: source.walletAddress, createdAt: "2026-10-01T00:00:00.000Z",
  rationale: "PRIVATE_CUSTODIAN_RATIONALE", authorizationId: "PRIVATE_AUTHORIZATION" };
const secret = "PRIVATE_CUSTOMER_AND_STORAGE_DETAIL";
const request = (id = source.id) => GET(new NextRequest(`https://creator.example/api/creator/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  store.getDb.mockResolvedValue({ getSource: store.source, listPaymentsBySource: store.payments, creatorLeaderboard: store.leaderboard,
    runPrivacyActive: true, runPrivacy: { list: store.publicQuestions }, getSyncState: store.sync, getPaperState: store.paper });
  store.source.mockResolvedValue(source); store.payments.mockResolvedValue([]); store.leaderboard.mockResolvedValue([]);
  store.publicQuestions.mockResolvedValue([]); store.sync.mockResolvedValue(null); store.paper.mockResolvedValue(null);
});

it("retains uncached missing-id400 without opening storage", async () => {
  const response = await request("");
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "missing id" });
  expect(response.headers.get("cache-control")).toBe("no-store"); expect(store.getDb).not.toHaveBeenCalled();
});

it("keeps missing creator404 distinct and does not enumerate its payments", async () => {
  store.source.mockResolvedValue(null);
  const response = await request();
  expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "creator not found" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(store.payments).not.toHaveBeenCalled(); expect(store.leaderboard).not.toHaveBeenCalled();
});

it("retains an actually empty successful ledger rather than inferring one from failure", async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ source: { id: source.id, name: source.name }, gatewayProof: null, scholarlyRights: null,
    stats: { totalEarned: 0, settledTotal: 0, paymentCount: 0, citationCount: 0, rank: 0 }, recentPayments: [], dailyEarnings: [] });
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("preserves recorded earnings and the real public-payment/private-question projection", async () => {
  store.payments.mockResolvedValue([payment]);
  const response = await request(), body = await response.json();
  expect(response.status).toBe(200);
  expect(body.stats).toEqual({ totalEarned: 0.000003, settledTotal: 0.000003, paymentCount: 1, citationCount: 0, rank: 0 });
  expect(body.dailyEarnings).toEqual([{ date: "2026-10-01", amount: 0.000003 }]);
  expect(body.recentPayments).toEqual([expect.objectContaining({ id: payment.id, amountUsdc: payment.amountUsdc, question: null })]);
  expect(store.publicQuestions).toHaveBeenCalledExactlyOnceWith({ take: 1, ids: [payment.queryId] });
  expect(JSON.stringify(body)).not.toMatch(/PRIVATE_CUSTODIAN_RATIONALE|PRIVATE_AUTHORIZATION/);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("keeps leaderboard totals/rank and deduplicates authorized public question enrichment", async () => {
  store.payments.mockResolvedValue([payment, { ...payment, id: "citation", kind: "citation", amountUsdc: 0.000001 }]);
  const leaderboard: CreatorEarnings[] = [
    { sourceId: "other", sourceName: "Synthetic other creator", walletAddress: `0x${"ef".repeat(20)}`, totalEarnedUsdc: 0.000006, paymentCount: 3, citationCount: 2 },
    { sourceId: source.id, sourceName: source.name, walletAddress: source.walletAddress, totalEarnedUsdc: 0.000004, paymentCount: 2, citationCount: 1 },
  ];
  store.leaderboard.mockResolvedValue(leaderboard);
  const published: QueryRun = { id: payment.queryId, question: "Publicly published question", budget: 0, engine: "fixture",
    subClaims: [], decisions: [], citations: [], answer: "Public answer", totalSpent: 0, totalToCreators: 0, trace: [], createdAt: payment.createdAt };
  store.publicQuestions.mockResolvedValue([published]);
  const response = await request(), body = await response.json();
  expect(response.status).toBe(200);
  expect(body.stats).toMatchObject({ totalEarned: 0.000004, paymentCount: 2, citationCount: 1, rank: 2 });
  expect(body.recentPayments.map((row: { question: string }) => row.question)).toEqual([published.question, published.question]);
  expect(store.publicQuestions).toHaveBeenCalledOnce(); expect(response.headers.get("cache-control")).toBe("no-store");
});

it.each(["initialization", "source", "payments", "leaderboard", "publication"] as const)(
  "returns the existing500 with a sanitized uncached body for failed %s reads", async stage => {
    const failure = new Error(secret);
    if (stage === "initialization") store.getDb.mockRejectedValueOnce(failure);
    if (stage === "source") store.source.mockRejectedValueOnce(failure);
    if (stage === "payments") store.payments.mockRejectedValueOnce(failure);
    if (stage === "leaderboard") store.leaderboard.mockRejectedValueOnce(failure);
    if (stage === "publication") { store.payments.mockResolvedValue([payment]); store.publicQuestions.mockRejectedValueOnce(failure); }
    const response = await request(), body = await response.json();
    expect(response.status).toBe(500); expect(body).toEqual({ error: "creator_data_unavailable" });
    expect(JSON.stringify(body)).not.toContain(secret); expect(body).not.toHaveProperty("stats");
    expect(response.headers.get("cache-control")).toBe("no-store");
  },
);

it("does not stringify unknown thrown values while constructing a public failure", async () => {
  const stringify = vi.fn(() => { throw new Error(secret); });
  store.getDb.mockRejectedValueOnce({ toString: stringify });
  const response = await request();
  expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "creator_data_unavailable" });
  expect(stringify).not.toHaveBeenCalled(); expect(response.headers.get("cache-control")).toBe("no-store");
});

it("retains optional Gateway proof degradation without discarding recorded earnings", async () => {
  store.payments.mockResolvedValue([payment]); store.sync.mockRejectedValueOnce(new Error(secret));
  const response = await request(), body = await response.json();
  expect(response.status).toBe(200); expect(body.gatewayProof).toBeNull(); expect(body.stats.totalEarned).toBe(0.000003);
  expect(JSON.stringify(body)).not.toContain(secret); expect(response.headers.get("cache-control")).toBe("no-store");
});

it("preserves enrolled-rights unavailable separately from earnings success", async () => {
  store.source.mockResolvedValue({ ...source, scholarlyEnrolled: true }); store.paper.mockRejectedValueOnce(new Error(secret));
  const response = await request(), body = await response.json();
  expect(response.status).toBe(200); expect(body.scholarlyRights).toEqual({ status: "unavailable" });
  expect(JSON.stringify(body)).not.toContain(secret); expect(response.headers.get("cache-control")).toBe("no-store");
});

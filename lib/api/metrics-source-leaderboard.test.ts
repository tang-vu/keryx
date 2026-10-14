import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/history/testnet-archive", () => ({ getTestnetArchive: async () => null }));
import { GET } from "@/app/api/metrics/route";

it("adds the full source view while preserving the existing creator earnings contract", async () => {
  const wallet = "0x1111111111111111111111111111111111111111";
  const earnings = ["one", "two"].map(sourceId => ({ sourceId, sourceName: sourceId, walletAddress: wallet,
    totalEarnedUsdc: 0.005, citationCount: 1, paymentCount: 1 }));
  mocks.db.mockResolvedValue({ metrics: async () => ({ totalPayments: 2 }), creatorLeaderboard: async () => earnings,
    listPayments: async () => [], listSources: async () => [{ id: "one", name: "One", walletAddress: wallet }, { id: "two", name: "Two", walletAddress: wallet }],
    listPublicReferences: async () => [{ id: "public:retained", name: "Retained feed", url: "https://retained.example/", active: true }],
    listPaymentsBySource: async () => [], runPrivacyActive: false,
    dailySettled: async () => [], getFeedbackStats: async () => undefined, activationFunnel: async () => undefined,
  });
  const body = await (await GET()).json();
  expect(body.metrics.totalPayments).toBe(2);
  expect(body.leaderboard.map((row: { sourceId: string }) => row.sourceId)).toEqual(["one", "two"]);
  expect(body.leaderboard[0].totalEarnedUsdc).toBe(0.005);
  expect(body.sourceLeaderboard.rows.find((row: { sourceId: string }) => row.sourceId === "public:retained")).toMatchObject({ creatorEarnedUsdc: 0, operatingFeeUsdc: 0 });
  expect(body.sourceLeaderboard.rows.length).toBeGreaterThan(100);
});

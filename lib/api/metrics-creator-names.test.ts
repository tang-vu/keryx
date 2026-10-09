import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/history/testnet-archive", () => ({ getTestnetArchive: async () => null }));
import { GET } from "@/app/api/metrics/route";

beforeEach(() => vi.clearAllMocks());

it("uses exact current source metadata for raw labels without changing settlement identity or recorded names", async () => {
  const row = { sourceId: "source-a", sourceName: "source-a", walletAddress: "original-wallet",
    totalEarnedUsdc: 0.123456, paymentCount: 3, citationCount: 2 };
  const leaderboard = [row, { ...row, sourceId: "source-b", sourceName: "Original historical name" },
    { ...row, sourceId: "unknown-source", sourceName: "unknown-source" }];
  mocks.db.mockResolvedValue({
    metrics: async () => ({ totalPayments: 3 }), creatorLeaderboard: async () => leaderboard,
    listPayments: async () => [], listSources: async () => [{ id: "source-a", name: "Human source title" }, { id: "source-b", name: "New title" }],
    dailySettled: async () => [], getFeedbackStats: async () => undefined, activationFunnel: async () => undefined,
  });
  const body = await (await GET()).json();
  expect(body.leaderboard).toEqual([{ ...row, sourceName: "Human source title" }, leaderboard[1], leaderboard[2]]);
  expect(leaderboard[0]).toEqual(row);
  expect(body.historicalArchive).toEqual({ status: "not-configured" });
  expect(body.metrics.totalPayments).toBe(3);
});

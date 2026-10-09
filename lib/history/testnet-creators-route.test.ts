import { beforeEach, expect, it, vi } from "vitest";
import type { TestnetArchiveInfo, TestnetCreatorEntry } from "./testnet-archive";

const mocks = vi.hoisted(() => ({ archive: vi.fn(), currentDb: vi.fn(() => { throw new Error("Current database must not be read"); }) }));
vi.mock("@/lib/history/testnet-archive", () => ({ getTestnetArchive: mocks.archive }));
vi.mock("@/lib/db", () => ({ getDb: mocks.currentDb }));
import { GET, dynamic, runtime } from "@/app/api/history/testnet/creators/route";

const info: TestnetArchiveInfo = { network: "eip155:5042002", label: "Arc testnet", capturedAt: "2026-10-03T00:26:18.665Z",
  sourceCommit: "a".repeat(40), databaseSha256: "b".repeat(64) };
const creators: TestnetCreatorEntry[] = [{ sourceId: "original-source", sourceName: "Historical creator",
  walletAddress: `0x${"b".repeat(40)}`, totalEarnedMicroUsdc: 100003, paymentCount: 2, citationCount: 1 }];

beforeEach(() => { vi.clearAllMocks(); });

it("returns the archive's complete creator projection with explicit testnet provenance and no current DB access", async () => {
  const leaderboard = vi.fn().mockResolvedValue(creators);
  mocks.archive.mockResolvedValue({ info, creatorLeaderboard: leaderboard });
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ archive: info, creators });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(leaderboard).toHaveBeenCalledExactlyOnceWith();
  expect(mocks.currentDb).not.toHaveBeenCalled();
  expect(runtime).toBe("nodejs");
  expect(dynamic).toBe("force-dynamic");
});

it("returns a successful empty leaderboard when the verified archive has no creator settlements", async () => {
  mocks.archive.mockResolvedValue({ info, creatorLeaderboard: vi.fn().mockResolvedValue([]) });
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ archive: info, creators: [] });
});

it.each(["missing", "open failure", "projection failure"])("returns an uncached sanitized 503 for %s", async failure => {
  if (failure === "missing") mocks.archive.mockResolvedValue(null);
  else if (failure === "open failure") mocks.archive.mockRejectedValue(new Error("private manifest path"));
  else mocks.archive.mockResolvedValue({ info, creatorLeaderboard: vi.fn().mockRejectedValue(new Error("private archive contents")) });
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Testnet creator history unavailable" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.currentDb).not.toHaveBeenCalled();
});

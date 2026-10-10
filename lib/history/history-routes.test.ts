import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { QueryRun } from "../types";
import { createTrustedUsageContext, newRunUsage } from "../research/usage-provenance";

const mocks = vi.hoisted(() => ({ session: vi.fn(), db: vi.fn(), archive: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/history/testnet-archive", () => ({ getTestnetArchive: mocks.archive }));
import { GET as asks } from "@/app/api/me/asks/route";
import { GET as runs } from "@/app/api/runs/route";
import { GET as history } from "@/app/api/history/testnet/route";

const wallet = `0x${"a".repeat(40)}`;
const info = { network: "eip155:5042002", capturedAt: "2026-10-03T00:26:18.665Z", sourceCommit: "a".repeat(40), databaseSha256: "b".repeat(64) };
const record = (id: string) => ({ id, question: id, answer: "answer", createdAt: "2026-10-02T09:26:53.345Z", citations: [], totalSpent: 0.002, totalToCreators: 0.002, askerFunded: true } as unknown as QueryRun);
let current: { listQueryRunsByAsker: ReturnType<typeof vi.fn>; listSources: ReturnType<typeof vi.fn>; newestItemDates: ReturnType<typeof vi.fn>; listRecentQueries: ReturnType<typeof vi.fn> };
let archived: { info: typeof info; listQueryRunsByAsker: ReturnType<typeof vi.fn>; listRecentQueries: ReturnType<typeof vi.fn>; summary: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  current = { listQueryRunsByAsker: vi.fn().mockResolvedValue([record("current")]), listSources: vi.fn().mockResolvedValue([]), newestItemDates: vi.fn().mockResolvedValue({}), listRecentQueries: vi.fn().mockResolvedValue([record("current")]) };
  archived = { info, listQueryRunsByAsker: vi.fn().mockResolvedValue([record("old")]), listRecentQueries: vi.fn().mockResolvedValue([record("old")]), summary: vi.fn().mockResolvedValue({ totalQueryRuns: 1 }) };
  mocks.db.mockResolvedValue(current); mocks.session.mockResolvedValue({ address: wallet }); mocks.archive.mockResolvedValue(archived);
});
it("authenticates historical account history before archive access and ignores caller wallet", async () => {
  mocks.session.mockResolvedValueOnce(null);
  expect((await asks(new NextRequest("https://keryx.cc/api/me/asks?network=arcTestnet"))).status).toBe(401);
  expect(mocks.archive).not.toHaveBeenCalled();
  const response = await asks(new NextRequest("https://keryx.cc/api/me/asks?network=arcTestnet&wallet=foreign"));
  const body = await response.json();
  expect(archived.listQueryRunsByAsker).toHaveBeenCalledWith(wallet, 50);
  expect(current.listQueryRunsByAsker).not.toHaveBeenCalled();
  expect(current.listSources).not.toHaveBeenCalled(); expect(current.newestItemDates).not.toHaveBeenCalled();
  expect(body.asks.map((row: { id: string }) => row.id)).toEqual(["old"]);
  expect(body.archive.network).toBe("eip155:5042002"); expect(body.totals.spentUsdc).toBe(0.002);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("leaves current account money separate and refuses unavailable testnet history", async () => {
  const body = await (await asks(new NextRequest("https://keryx.cc/api/me/asks"))).json();
  expect(body.asks.map((row: { id: string }) => row.id)).toEqual(["current"]);
  expect(body.archive).toBeUndefined(); expect(archived.listQueryRunsByAsker).not.toHaveBeenCalled();
  mocks.archive.mockRejectedValue(new Error("private archive path"));
  const response = await asks(new NextRequest("https://keryx.cc/api/me/asks?network=arcTestnet"));
  expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private");
});
it("preserves current/archive default history, profile labels and the prior availability header without inventing cohorts", async () => {
  const response = await runs(); expect(response.status).toBe(200);
  const body = await response.json(); expect(body).toHaveLength(2);
  expect(body.find((row: { id: string }) => row.id === "old").archive.network).toBe(info.network);
  expect(body.find((row: { id: string }) => row.id === "old").usage).toEqual({ cohort: "unknown", payment: "unknown", network: info.network });
  expect(body.find((row: { id: string }) => row.id === "current").usage.cohort).toBe("unknown");
  expect(response.headers.get("X-Keryx-Testnet-History")).toBe("available");
  expect(response.headers.get("X-Keryx-History-Coverage")).toContain("incomplete");
  mocks.archive.mockRejectedValue(new Error("private archive unavailable"));
  const currentOnly = await runs(); expect(currentOnly.status).toBe(200); expect(await currentOnly.json()).toHaveLength(1);
  expect(currentOnly.headers.get("X-Keryx-Testnet-History")).toBe("unavailable");
});
it("dedupes current authority before hiding scripted rows, without resurrecting an older archive duplicate", async () => {
  const usage = newRunUsage({ usageContext: createTrustedUsageContext("eip155:5042", { actor: "unknown", funding: "unknown", scripted: true }) }, "eip155:5042", []);
  current.listRecentQueries.mockResolvedValue([{ ...record("same"), answer: "Current authoritative" }, { ...record("blocked"), usage }]);
  archived.listRecentQueries.mockResolvedValue([{ ...record("same"), answer: "Old duplicate" }, record("blocked"), record("old"), { ...record("old-script"), usage }]);
  const rows = await (await runs()).json(); expect(rows.map((row: { id: string }) => row.id)).toEqual(["same", "old"]);
  expect(rows.find((row: { id: string }) => row.id === "same").answerSnippet).toBe("Current authoritative");
  expect(rows.find((row: { id: string }) => row.id === "same").archive).toBeUndefined();
  expect(rows.find((row: { id: string }) => row.id === "old").archive.network).toBe(info.network);
});
it("explicit testnet archive selection preserves unknown history, never reads current store and refuses unsupported classified windows", async () => {
  const response = await runs(new Request("https://keryx.cc/api/runs?archive=testnet")); expect(response.status).toBe(200);
  expect((await response.json()).map((row: { id: string }) => row.id)).toEqual(["old"]);
  expect(current.listRecentQueries).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
  expect(response.headers.get("X-Keryx-History-Network")).toBe(info.network);
  expect(response.headers.get("X-Keryx-History-Coverage")).toContain("incomplete");
  for (const query of ["archive=testnet&cohort=outside", "archive=testnet&period=7d", "archive=testnet&since=2026-10-01"])
    expect((await runs(new Request(`https://keryx.cc/api/runs?${query}`))).status).toBe(503);
  expect((await runs(new Request("https://keryx.cc/api/runs?archive=testnet&network=eip155:5042"))).status).toBe(400);
});
it("pages public history without exposing raw runs and rejects malformed pages", async () => {
  const response = await history(new Request("https://keryx.cc/api/history/testnet"));
  const body = await response.json(); expect(body.runs[0].answer).toBeUndefined(); expect(body.runs[0].answerSnippet).toBe("answer");
  expect((await history(new Request("https://keryx.cc/api/history/testnet?before=garbage"))).status).toBe(400);
});

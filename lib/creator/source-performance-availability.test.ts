import { beforeEach, expect, it, vi } from "vitest";
import type { QueryRun } from "../types";

const store = vi.hoisted(() => ({ getDb: vi.fn(), getSource: vi.fn(), listRecentQueries: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: store.getDb }));
import { GET } from "../../app/api/creator/[id]/performance/route";
import { getSourcePerformance } from "./source-performance-cache";
import { openapiSpec } from "../openapi-spec";

const run: QueryRun = { id: "public-synthetic-run", question: "Public synthetic question", budget: 0,
  engine: "fixture", subClaims: [], decisions: [{ sourceId: "a", sourceName: "Source A", action: "BUY", price: 0.002,
    expectedValue: 0.8, confidence: 0.9, rationale: "Public original rationale", targets: [] }], citations: [],
  answer: "", totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-10-01T00:00:00.000Z" };
const request = () => GET(new Request("https://creator.test/api/creator/a/performance"), { params: Promise.resolve({ id: "a" }) });
beforeEach(() => {
  vi.clearAllMocks();
  store.getDb.mockResolvedValue({ getSource: store.getSource, listRecentQueries: store.listRecentQueries });
  store.getSource.mockResolvedValue({ id: "a", name: "Source A" });
  store.listRecentQueries.mockResolvedValue([]);
});

it("preserves a verified empty public window as an uncached successful response", async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ sourceId: "a", name: "Source A", windowRuns: 400, performance: null });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(store.listRecentQueries).toHaveBeenCalledExactlyOnceWith(400);
});

it("retains the existing successful feedback fields without implying settlement", async () => {
  store.listRecentQueries.mockResolvedValue([run]);
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ sourceId: "a", name: "Source A", windowRuns: 400, performance: {
    considered: 1, bought: 1, reused: 0, skipped: 0, cited: 0, citeThrough: 0, evChosen: 0.8, evSkipped: null,
    price: 0.002, rivalPriceOnSkip: null, recentSkips: [],
  } });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(run.totalSpent).toBe(0);
});

it("keeps a missing source404 separate and never reads its run window", async () => {
  store.getSource.mockResolvedValue(undefined);
  const response = await request();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "source not found" });
  expect(store.listRecentQueries).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it.each(["initialization", "source", "corpus"] as const)("returns a sanitized uncached503 for a failed %s read", async stage => {
  const failure = new Error("PRIVATE_CUSTOMER_QUESTION_AND_STORAGE_DETAIL");
  if (stage === "initialization") store.getDb.mockRejectedValueOnce(failure);
  if (stage === "source") store.getSource.mockRejectedValueOnce(failure);
  if (stage === "corpus") store.listRecentQueries.mockRejectedValueOnce(failure);
  const response = await request();
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body).toEqual({ error: "creator_performance_unavailable" });
  const documented = openapiSpec.paths["/api/creator/{id}/performance"].get.responses["503"];
  expect(documented.content["application/json"].example).toEqual(body);
  expect(documented.headers["Cache-Control"].schema.enum).toContain(response.headers.get("cache-control"));
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("propagates public-corpus unavailability instead of manufacturing an empty observation", async () => {
  store.listRecentQueries.mockRejectedValueOnce(new Error("privacy_unavailable"));
  await expect(getSourcePerformance("a")).rejects.toThrow("privacy_unavailable");
  expect(store.listRecentQueries).toHaveBeenCalledExactlyOnceWith(400);
});

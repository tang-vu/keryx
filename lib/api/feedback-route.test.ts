import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SupabaseAdapter } from "@/lib/db/supabase-adapter";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => null, clientIp: () => "synthetic-client" }));
import { GET, POST } from "@/app/api/feedback/route";
import { GET as getMetrics } from "@/app/api/metrics/route";

const rows = [{ rating: "up" }, { rating: "up" }, { rating: "down" }];
const counts = { total: 3, up: 2, down: 1, rate: 0.666667 };
const post = () => POST(new NextRequest("https://feedback.test/api/feedback", {
  method: "POST", body: JSON.stringify({ queryId: "synthetic-report", rating: "up" }),
}));
const get = () => GET(new NextRequest("https://feedback.test/api/feedback?queryId=synthetic-report"));
const reply = (status: number, data?: unknown) => new Response(data === undefined ? null : JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-feedback-no-authority");
  mocks.getDb.mockResolvedValue(new SupabaseAdapter());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

// Use the installed Supabase client, including its resolved PostgREST error semantics.
it.each([400, 503, "connection"] as const)("does not confirm an unsuccessful feedback insert (%s)", async failure => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (failure === "connection") throw new TypeError("Synthetic connection loss");
      return reply(failure, { message: "Synthetic insert refusal" });
    }
    return reply(200, rows); // Old aggregates cannot prove this insert succeeded.
  });
  vi.stubGlobal("fetch", fetch);
  const response = await post();
  expect(response.status).toBe(500);
  expect(await response.json()).toHaveProperty("error");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not confirm after an insert succeeds but aggregate readback fails", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "POST" ? reply(201) : reply(503, { message: "Synthetic readback refusal" }));
  vi.stubGlobal("fetch", fetch);
  const response = await post();
  expect(response.status).toBe(500);
  expect(await response.json()).toHaveProperty("error");
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  // The installed SDK may retry idempotent aggregate reads, never the insert.
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "GET").length).toBeGreaterThan(0);
});

it.each([503, "connection"] as const)("does not publish failed aggregate reads as zero votes (%s)", async failure => {
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (failure === "connection") throw new TypeError("Synthetic connection loss");
    return reply(failure, { message: "Synthetic aggregate refusal" });
  }));
  const response = await get();
  expect(response.status).toBe(500);
  expect(await response.json()).toHaveProperty("error");
});

it("preserves successful insertion and report-scoped aggregate responses", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "POST" ? reply(201) : reply(200, rows));
  vi.stubGlobal("fetch", fetch);
  const response = await post();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(counts);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ query_id: "synthetic-report", rating: "up" });
  expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get("query_id")).toBe("eq.synthetic-report");
});

it("returns zero votes only after a successful empty read", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reply(200, [])));
  const response = await get();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ total: 0, up: 0, down: 0, rate: 0 });
});

it.each([null, {}])("does not publish a malformed successful aggregate body as zero votes", async data => {
  vi.stubGlobal("fetch", vi.fn(async () => reply(200, data)));
  expect((await get()).status).toBe(500);
});

it.each([true, false])("preserves core metrics and distinguishes unavailable feedback from confirmed zero (%s)", async unavailable => {
  // Previously calculated feedback fields must not survive a failed fresh read.
  const core = { totalQueries: 7, totalCreatorPayoutsUsdc: 0.012, satisfactionRate: 1, feedbackTotal: 99 };
  const daily = [{ day: "2026-10-08", volumeUsdc: 0.012, count: 3 }];
  mocks.getDb.mockResolvedValue({
    metrics: async () => core, creatorLeaderboard: async () => [], listPayments: async () => [],
    listSources: async () => [], dailySettled: async () => daily, activationFunnel: async () => undefined,
    getFeedbackStats: async () => { if (unavailable) throw new Error("Synthetic feedback unavailable");
      return { total: 0, up: 0, down: 0, rate: 0 }; },
  });
  const response = await getMetrics();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.metrics).toMatchObject({ totalQueries: 7, totalCreatorPayoutsUsdc: 0.012 });
  expect(body.dailySettled).toEqual(daily);
  if (unavailable) {
    expect(body.metrics).not.toHaveProperty("satisfactionRate");
    expect(body.metrics).not.toHaveProperty("feedbackTotal");
  } else expect(body.metrics).toMatchObject({ satisfactionRate: 0, feedbackTotal: 0 });
});

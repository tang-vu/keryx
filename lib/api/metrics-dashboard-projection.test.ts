import { beforeEach, expect, it, vi } from "vitest";
import { calculateDashboardMetrics } from "../db/dashboard-metrics";
import { openapiSpec } from "../openapi-spec";
import type { PaymentRecord, QueryRun } from "../types";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), archive: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/history/testnet-archive", () => ({ getTestnetArchive: mocks.archive }));
vi.mock("@/lib/config", () => ({ config: { networkId: "eip155:5042" } }));
import { GET } from "@/app/api/metrics/route";

const wallet = "0x1111111111111111111111111111111111111111";
const metrics = calculateDashboardMetrics([], []);
function database() {
  return {
    metrics: vi.fn(async () => metrics),
    creatorLeaderboard: vi.fn(async () => [{ sourceId: "creator", sourceName: "creator", walletAddress: wallet,
      totalEarnedUsdc: 0.003, paymentCount: 1, citationCount: 1 }]),
    listSources: vi.fn(async () => [{ id: "creator", name: "Current creator title", walletAddress: wallet }]),
    listPayments: vi.fn(async () => []), dailySettled: vi.fn(async () => [{ date: "2026-10-17", amountUsdc: 0.003 }]),
    getFeedbackStats: vi.fn(async () => ({ rate: 0.5, total: 2 })), activationFunnel: vi.fn(async () => ({ recorded: 1 })),
    listPublicReferences: vi.fn(async () => []), listPaymentsBySource: vi.fn(async (): Promise<PaymentRecord[]> => []),
    getQueryRun: vi.fn(async (): Promise<QueryRun | null> => null), runPrivacyActive: false,
    runPrivacy: { read: vi.fn() },
  };
}
let db: ReturnType<typeof database>;
const request = (query = "") => new Request(`https://keryx.test/api/metrics${query}`);
const optional = ["listPayments", "dailySettled", "getFeedbackStats", "activationFunnel"] as const;
beforeEach(() => {
  vi.clearAllMocks(); db = database(); mocks.getDb.mockResolvedValue(db);
  mocks.archive.mockResolvedValue({ info: { label: "Retained testnet" }, summary: async () => ({ queries: 2 }) });
});

it.each([undefined, "", "?view=", "?view=unknown", "?view=Dashboard", "?view=dashboard&view=dashboard", "?view=dashboard&view=full"])(
  "preserves the full default contract for selector %s", async query => {
    const response = await GET(query === undefined ? undefined : request(query));
    const body = await response.json();
    expect(body).toMatchObject({ metrics: { ...metrics, satisfactionRate: 0.5, feedbackTotal: 2, activationFunnel: { recorded: 1 } },
      historicalArchive: { status: "available", summary: { queries: 2 } }, topics: [], dailySettled: [{ date: "2026-10-17", amountUsdc: 0.003 }] });
    for (const name of optional) expect(db[name]).toHaveBeenCalledTimes(1);
    expect(db.listPayments).toHaveBeenCalledWith(1000);
    expect(db.dailySettled).toHaveBeenCalledWith(14);
    expect(db.activationFunnel).toHaveBeenCalledWith(30);
    expect(mocks.archive).toHaveBeenCalledTimes(1);
  },
);

it("serves the explicit dashboard without invoking failing unused reads", async () => {
  for (const name of optional) db[name].mockImplementation(async () => { throw new Error("unused read unavailable"); });
  mocks.archive.mockRejectedValue(new Error("unused archive unavailable"));
  const body = await (await GET(request("?view=dashboard"))).json();
  expect(Object.keys(body).sort()).toEqual(["usage", "metricsScope", "metrics", "leaderboard", "sourceLeaderboard"].sort());
  expect(body.metrics).toEqual(metrics);
  expect(body.leaderboard[0]).toMatchObject({ sourceId: "creator", sourceName: "Current creator title", totalEarnedUsdc: 0.003, walletAddress: wallet });
  expect(body.sourceLeaderboard.rows.find((row: { sourceId: string }) => row.sourceId === "creator"))
    .toMatchObject({ creatorEarnedUsdc: 0.003, operatingFeeUsdc: 0 });
  expect(body.usage).toMatchObject({ unclassifiedIsOutside: false, endpoint: "/api/usage" });
  expect(body.metricsScope).toMatchObject({ cohort: "mixed-all-origins", period: "all-time", network: "not-row-partitioned" });
  for (const name of optional) expect(db[name]).not.toHaveBeenCalled();
  expect(mocks.archive).not.toHaveBeenCalled();
});

it("does not wait on unresolved unused engagement or archive reads", async () => {
  for (const name of optional) db[name].mockImplementation(() => new Promise<never>(() => {}));
  mocks.archive.mockImplementation(() => new Promise<never>(() => {}));
  let settled = false;
  const response = GET(request("?view=dashboard")).then(value => { settled = true; return value; });
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(settled).toBe(true);
  expect((await response).status).toBe(200);
  for (const name of optional) expect(db[name]).not.toHaveBeenCalled();
  expect(mocks.archive).not.toHaveBeenCalled();
});

it("reads fresh totals, creator metadata, and source evidence on every projection", async () => {
  db.metrics.mockResolvedValueOnce({ ...metrics, totalQueries: 1 }).mockResolvedValueOnce({ ...metrics, totalQueries: 2 });
  const first = await (await GET(request("?view=dashboard"))).json();
  const second = await (await GET(request("?view=dashboard"))).json();
  expect([first.metrics.totalQueries, second.metrics.totalQueries]).toEqual([1, 2]);
  for (const name of ["metrics", "creatorLeaderboard", "listSources", "listPublicReferences", "listPaymentsBySource"] as const)
    expect(db[name]).toHaveBeenCalledTimes(2);
});

it("retains private-run protection and unknown fee totals for a nonempty settled fee ledger", async () => {
  db.runPrivacyActive = true;
  db.listPaymentsBySource.mockResolvedValue([{ id: "fee", queryId: "private-run", sourceId: "keryx:operating-fee", kind: "operating-fee",
    network: "eip155:5042", settled: true, settlementStatus: "settled", txHash: "unit-test-original", amountUsdc: 0.005, payee: wallet } as PaymentRecord]);
  db.runPrivacy.read.mockResolvedValue({ item: { state: { visibility: "private", erased: false }, run: { id: "private-run", question: "PRIVATE BODY MUST NOT APPEAR" } } });
  const body = await (await GET(request("?view=dashboard"))).json();
  expect(db.runPrivacy.read).toHaveBeenCalledWith("private-run");
  expect(db.getQueryRun).not.toHaveBeenCalled();
  expect(body.sourceLeaderboard.operatingFeesStatus).toBe("incomplete");
  expect(body.sourceLeaderboard.rows.every((row: { operatingFeeUsdc: number | null }) => row.operatingFeeUsdc === null)).toBe(true);
  expect(body.leaderboard[0].totalEarnedUsdc).toBe(0.003);
  expect(JSON.stringify(body)).not.toContain("PRIVATE BODY");
});

it("preserves default mandatory failures and optional metadata degradation", async () => {
  db.listPayments.mockRejectedValueOnce(new Error("mandatory default read failed"));
  await expect(GET()).rejects.toThrow("mandatory default read failed");
  db.getFeedbackStats.mockRejectedValueOnce(new Error("optional feedback failed"));
  mocks.archive.mockRejectedValueOnce(new Error("optional archive failed"));
  const body = await (await GET()).json();
  expect(body.historicalArchive).toEqual({ status: "unavailable" });
  expect(body.metrics).not.toHaveProperty("feedbackTotal");
  expect(body).toHaveProperty("dailySettled");
});

it("documents the optional projection while retaining the default response schema", () => {
  const operation = openapiSpec.paths["/api/metrics"].get;
  expect(operation.parameters).toContainEqual(expect.objectContaining({ name: "view", in: "query", required: false }));
  expect(operation.description).toContain("view=dashboard");
  expect(operation.responses["200"].description).toContain("default");
  expect(operation.responses["200"].content["application/json"].schema.required).toContain("metrics");
});

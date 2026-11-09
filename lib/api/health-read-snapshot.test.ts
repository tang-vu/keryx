import { afterEach, beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  enabled: true, unavailable: false, registry: true, refusal: false,
  values: new Map<string, string>(), failedKeys: new Set<string>(),
  metrics: vi.fn(), jobs: vi.fn(), scalar: vi.fn(), batch: vi.fn(), snapshot: vi.fn(), writes: vi.fn(),
  metricValue: { totalCreatorPayoutsUsdc: 1.25, totalPayments: 3, totalQueries: 2, creatorsEarning: 1 },
  jobValue: { degraded: false },
}));
vi.mock("@/lib/config", () => ({ config: {
  network: "arc", get registryReadAddress() { return f.registry ? "0x1111111111111111111111111111111111111111" : ""; },
  rpcUrl: "https://rpc.example.test",
}, llmProvider: () => "unconfigured" }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({
  metrics: f.metrics, a2aOperationsSnapshot: f.jobs, getSyncState: f.scalar, getSyncStates: f.batch,
  get readPublicHealthSnapshot() { return f.enabled ? f.snapshot : undefined; },
  setSyncState: f.writes,
}) }));
const keys = ["lastSyncedBlock", "registryParity", "dispatchHealth", "settlementParity", "pendingPaymentReconciliation", "a2aWorker"];

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-10T00:00:00Z")); vi.clearAllMocks();
  f.enabled = true; f.unavailable = false; f.registry = true; f.refusal = false;
  f.values.clear(); f.failedKeys.clear(); f.jobValue = { degraded: false };
  f.metrics.mockResolvedValue(f.metricValue); f.jobs.mockImplementation(async () => f.jobValue);
  f.scalar.mockImplementation(async (key: string) => {
    if (f.failedKeys.has(key)) throw new Error("Synthetic optional read refused");
    return f.values.get(key) ?? null;
  });
  f.batch.mockImplementation(async (requested: readonly string[]) => new Map(requested.map(key => [key, f.values.get(key) ?? null])));
  f.snapshot.mockImplementation(async (_now: number, includeRegistry: boolean) => {
    if (f.refusal) throw new Error("Synthetic fresh guard refused");
    if (f.unavailable) return undefined;
    return { metrics: f.metricValue, jobs: f.jobValue,
      syncState: new Map((includeRegistry ? keys : keys.slice(2)).map(key => [key, f.values.get(key) ?? null])) };
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function health() {
  const { GET } = await import("../../app/api/health/route");
  const response = await GET();
  return { status: response.status, cache: response.headers.get("Cache-Control"), body: await response.json() };
}

it("uses the closed snapshot without independently re-reading healthy data", async () => {
  f.metrics.mockRejectedValue(new Error("Legacy read must not execute"));
  const result = await health();
  expect(result).toMatchObject({ status: 200, cache: "no-store", body: { status: "operational", settles: "real", traction: { totalPayments: 3 } } });
  expect(f.snapshot).toHaveBeenCalledExactlyOnceWith(Date.parse("2026-11-10T00:00:00Z"), true);
  expect(f.metrics).not.toHaveBeenCalled(); expect(f.jobs).not.toHaveBeenCalled();
  expect(f.batch).not.toHaveBeenCalled(); expect(f.scalar).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled();
});

it("preserves the complete legacy payload, telemetry parsing and worker privacy", async () => {
  f.values.set("lastSyncedBlock", "123"); f.values.set("registryParity", JSON.stringify({ checkedAt: "2026-11-09T23:59:00Z", issueCount: 0 }));
  f.values.set("dispatchHealth", "{malformed");
  f.values.set("a2aWorker", JSON.stringify({ status: "idle", updatedAt: "2026-11-09T23:59:00Z", workerId: "private-worker-identity", pid: 12345 }));
  f.enabled = false; const legacy = await health();
  f.enabled = true; vi.clearAllMocks(); const combined = await health();
  expect(combined).toEqual(legacy); expect(combined.body.dispatches).toBeNull();
  expect(JSON.stringify(combined)).not.toMatch(/private-worker-identity|12345/);
  expect(f.snapshot).toHaveBeenCalledTimes(1); expect(f.metrics).not.toHaveBeenCalled(); expect(f.scalar).not.toHaveBeenCalled();
});

it("keeps ordinary backends on the existing independent reads", async () => {
  f.enabled = false;
  expect((await health()).status).toBe(200);
  expect(f.snapshot).not.toHaveBeenCalled(); expect(f.metrics).toHaveBeenCalledTimes(1); expect(f.jobs).toHaveBeenCalledTimes(1);
  expect(f.batch).toHaveBeenCalledExactlyOnceWith(keys); expect(f.writes).not.toHaveBeenCalled();
});

it("uses original reads when the optimized composition is unavailable after valid admission", async () => {
  f.unavailable = true;
  expect((await health()).status).toBe(200);
  expect(f.snapshot).toHaveBeenCalledTimes(1); expect(f.metrics).toHaveBeenCalledTimes(1); expect(f.jobs).toHaveBeenCalledTimes(1);
  expect(f.batch).toHaveBeenCalledExactlyOnceWith(keys);
});

it("keeps genuine guard refusal as503 without falling back around it", async () => {
  f.refusal = true;
  expect(await health()).toMatchObject({ status: 503, cache: "no-store", body: { ok: false, db: "unreachable" } });
  expect(f.snapshot).toHaveBeenCalledTimes(1); expect(f.metrics).not.toHaveBeenCalled(); expect(f.jobs).not.toHaveBeenCalled();
  expect(f.batch).not.toHaveBeenCalled(); expect(f.scalar).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled();
});

it("preserves optional-summary and mandatory-registry error boundaries on fallback", async () => {
  f.unavailable = true; f.batch.mockRejectedValue(new Error("Synthetic batch unavailable"));
  for (const key of keys.slice(2)) f.failedKeys.add(key);
  expect(await health()).toMatchObject({ status: 200, body: { dispatches: null, settlement: null, reconciliation: null, a2aWorker: null } });
  f.failedKeys.add("registryParity");
  expect(await health()).toMatchObject({ status: 503, body: { ok: false, db: "unreachable" } });
});

it("requests only the configured registry shape and falls back for an absent snapshot key", async () => {
  f.registry = false;
  expect(await health()).toMatchObject({ status: 200, body: { registry: null } });
  expect(f.snapshot).toHaveBeenCalledExactlyOnceWith(Date.parse("2026-11-10T00:00:00Z"), false);
  f.snapshot.mockResolvedValueOnce({ metrics: f.metricValue, jobs: f.jobValue, syncState: new Map() });
  expect((await health()).status).toBe(200);
  expect(f.scalar.mock.calls.map(([key]) => key)).toEqual(keys.slice(2));
});

it("refreshes snapshots across requests and retains worker/job degradation", async () => {
  expect((await health()).body.status).toBe("operational");
  f.values.set("a2aWorker", JSON.stringify({ status: "stopped", updatedAt: "2026-11-10T00:00:00Z" }));
  expect((await health()).body.status).toBe("degraded");
  f.values.clear(); f.jobValue = { degraded: true };
  expect((await health()).body.status).toBe("degraded");
  expect(f.snapshot).toHaveBeenCalledTimes(3); expect(f.writes).not.toHaveBeenCalled();
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  values: new Map<string, string>(), failures: new Set<string>(), batch: true,
  batchFailure: false, registry: true, jobsDegraded: false,
  scalar: vi.fn(), snapshot: vi.fn(), metrics: vi.fn(), writes: vi.fn(),
}));
vi.mock("@/lib/config", () => ({ config: {
  network: "arc", get registryReadAddress() { return f.registry ? "0x1111111111111111111111111111111111111111" : ""; },
  rpcUrl: "https://rpc.example.test",
}, llmProvider: () => "unconfigured" }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({
  metrics: f.metrics,
  a2aOperationsSnapshot: async () => ({ degraded: f.jobsDegraded }),
  getSyncState: f.scalar,
  get getSyncStates() { return f.batch ? f.snapshot : undefined; },
  setSyncState: f.writes,
}) }));

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
  f.values.clear(); f.failures.clear(); f.batch = true; f.batchFailure = false;
  f.registry = true; f.jobsDegraded = false; vi.clearAllMocks();
  f.metrics.mockResolvedValue({ totalCreatorPayoutsUsdc: 1.25, totalPayments: 3, totalQueries: 2 });
  f.scalar.mockImplementation(async (key: string) => {
    if (f.failures.has(key)) throw new Error("state unavailable");
    return f.values.get(key) ?? null;
  });
  f.snapshot.mockImplementation((keys: readonly string[]) => {
    // The real enrolled facade can refuse synchronously before dispatching.
    if (f.batchFailure) throw new Error("batch unavailable");
    return Promise.resolve(new Map(keys.map(key => [key, f.values.get(key) ?? null])));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function health() {
  const { GET } = await import("../../app/api/health/route");
  const response = await GET();
  return { http: response.status, cache: response.headers.get("Cache-Control"), body: await response.json() };
}

it("preserves the entire scalar health response while using one six-key read", async () => {
  f.values.set("lastSyncedBlock", "123");
  f.values.set("registryParity", JSON.stringify({ checkedAt: "2026-10-28T09:55:00Z", issueCount: 0 }));
  f.values.set("dispatchHealth", "{malformed");
  f.values.set("settlementParity", JSON.stringify({ checkedAt: "2026-10-27T10:00:00Z" }));
  f.values.set("a2aWorker", JSON.stringify({ status: "idle", updatedAt: "2026-10-28T09:59:00Z" }));
  f.batch = false;
  const scalar = await health();
  expect(f.scalar).toHaveBeenCalledTimes(6);
  f.batch = true; f.scalar.mockClear();
  const batched = await health();
  expect(batched).toEqual(scalar);
  expect(batched).toMatchObject({ http: 200, cache: "no-store", body: { status: "operational", db: "ok", dispatches: null } });
  expect(f.snapshot).toHaveBeenCalledExactlyOnceWith([
    "lastSyncedBlock", "registryParity", "dispatchHealth", "settlementParity", "pendingPaymentReconciliation", "a2aWorker",
  ]);
  expect(f.scalar).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled();
});

it("refreshes observations on every request and keeps stale/stopped workers degraded", async () => {
  expect((await health()).body.status).toBe("operational");
  for (const worker of [
    { status: "idle", updatedAt: "2026-10-28T09:00:00Z" },
    { status: "stopped", updatedAt: "2026-10-28T10:00:00Z" },
    { status: "recovery_pending", updatedAt: "2026-10-28T10:00:00Z" },
  ]) {
    f.values.set("a2aWorker", JSON.stringify(worker));
    expect((await health()).body.status).toBe("degraded");
  }
  expect(f.snapshot).toHaveBeenCalledTimes(4);
});

it("retains job and payment reconciliation degradation", async () => {
  f.jobsDegraded = true;
  expect((await health()).body.status).toBe("degraded");
  f.jobsDegraded = false;
  f.values.set("pendingPaymentReconciliation", JSON.stringify({ awaiting: 1, mismatched: 1, oldestPendingAt: "2026-10-28T09:00:00Z" }));
  expect((await health()).body).toMatchObject({ status: "degraded", reconciliation: { status: "mismatch", degraded: true } });
});

it("falls back per key when a batch refuses, preserving optional unreadable summaries", async () => {
  f.batchFailure = true;
  for (const key of ["dispatchHealth", "settlementParity", "pendingPaymentReconciliation", "a2aWorker"]) f.failures.add(key);
  const result = await health();
  expect(result).toMatchObject({ http: 200, body: { status: "operational", registry: { lastSyncedBlock: null },
    dispatches: null, settlement: null, reconciliation: null, a2aWorker: null } });
  expect(f.snapshot).toHaveBeenCalledTimes(1); expect(f.scalar).toHaveBeenCalledTimes(6);
});

it.each(["lastSyncedBlock", "registryParity"])("keeps mandatory registry read failure as 503 (%s)", async key => {
  f.batchFailure = true; f.failures.add(key);
  expect(await health()).toMatchObject({ http: 503, cache: "no-store", body: { ok: false, db: "unreachable" } });
});

it("omits registry reads when unconfigured, including the failing-batch path", async () => {
  f.registry = false; f.batchFailure = true;
  f.failures.add("lastSyncedBlock"); f.failures.add("registryParity");
  expect(await health()).toMatchObject({ http: 200, body: { registry: null } });
  expect(f.scalar.mock.calls.map(([key]) => key)).toEqual([
    "dispatchHealth", "settlementParity", "pendingPaymentReconciliation", "a2aWorker",
  ]);
});

it("keeps aggregate datastore failure as 503 before reading summaries", async () => {
  f.metrics.mockRejectedValueOnce(new Error("datastore unavailable"));
  expect(await health()).toMatchObject({ http: 503, body: { ok: false, db: "unreachable" } });
  expect(f.snapshot).not.toHaveBeenCalled(); expect(f.scalar).not.toHaveBeenCalled();
});

it("records only fixed phases, UTC time and duration for slow or failed probes", async () => {
  await health();
  expect(console.warn).not.toHaveBeenCalled();
  f.metrics.mockImplementationOnce(async () => {
    vi.advanceTimersByTime(2_100);
    return { totalCreatorPayoutsUsdc: 0 };
  });
  expect((await health()).http).toBe(200);
  expect(console.warn).toHaveBeenCalledTimes(1);
  const event = JSON.parse(vi.mocked(console.warn).mock.calls[0][1] as string);
  expect(event).toEqual({ at: "2026-10-28T10:00:02.100Z", outcome: "operational", durationMs: 2100,
    phase: "response", phaseMs: { database: 0, "metrics-and-jobs": 2100, "sync-state": 0, response: 0 } });
  f.metrics.mockRejectedValueOnce(new Error("private rpc credential and wallet payload"));
  expect((await health()).http).toBe(503);
  const failure = JSON.parse(vi.mocked(console.warn).mock.calls[1][1] as string);
  expect(failure).toMatchObject({ outcome: "unready", phase: "metrics-and-jobs" });
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/private|credential|wallet/);
});

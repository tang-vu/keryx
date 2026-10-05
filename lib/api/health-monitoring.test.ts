import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ summaries: new Map<string, string>(), writes: vi.fn() }));
vi.mock("@/lib/config", () => ({ config: { network: "arc", registryReadAddress: "0x1111111111111111111111111111111111111111", rpcUrl: "https://rpc.example.test" }, llmProvider: () => "unconfigured" }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({
  metrics: async () => ({ totalCreatorPayoutsUsdc: 0 }),
  a2aOperationsSnapshot: async () => ({ degraded: false }),
  getSyncState: async (key: string) => fixtures.summaries.get(key) ?? null,
  setSyncState: fixtures.writes,
}) }));

beforeEach(() => { fixtures.summaries.clear(); fixtures.writes.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

it("keeps service readiness separate from missing mainnet financial observations, without writes", async () => {
  const { GET } = await import("../../app/api/health/route");
  const response = await GET();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("operational");
  expect(body.monitoring.state).toBe("incomplete");
  expect(body.monitoring.checks.map((check: { state: string }) => check.state)).toEqual(Array(4).fill("unavailable"));
  expect(fixtures.writes).not.toHaveBeenCalled();
});

it("exposes invalid and stale retained summaries without silently treating them as current", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-05T02:00:00Z"));
  fixtures.summaries.set("registryParity", JSON.stringify({ checkedAt: "2026-10-04T02:00:00Z", issueCount: 0 }));
  fixtures.summaries.set("dispatchHealth", "{invalid-json");
  const { GET } = await import("../../app/api/health/route");
  const body = await (await GET()).json();
  expect(body.monitoring.state).toBe("incomplete");
  expect(body.monitoring.checks[0].state).toBe("stale");
  expect(body.monitoring.checks[1].state).toBe("unavailable");
  expect(fixtures.writes).not.toHaveBeenCalled();
});

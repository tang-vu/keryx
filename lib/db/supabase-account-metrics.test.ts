import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SupabaseAdapter, assembleAuthorityBoundSupabaseCore } from "./supabase-adapter";
import type { StorageDeploymentManifest } from "./runtime-storage-config";
import { STORAGE_TESTNET_PROFILE_DIGEST } from "./storage-identity";
import { SUPABASE_RUNTIME_CONTRACT } from "./supabase-runtime-contract";

vi.mock("@supabase/supabase-js", async importOriginal => ({
  ...await importOriginal<typeof import("@supabase/supabase-js")>(), createClient: vi.fn(),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.useRealTimers(); });

type CountResult = { data: unknown; count: unknown; error: unknown };
type CountRead = CountResult | Error | ((signal: AbortSignal) => Promise<CountResult>);
function legacy(canonical: CountRead, noncanonical: CountRead = { data: null, error: null, count: 0 },
  coreRows: Record<string, Record<string, unknown>[]> = {}, coreReads: Record<string, CountResult[]> = {}) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-account-fixture-no-authority");
  const selects = vi.fn();
  const filters = vi.fn();
  const from = vi.fn((table: string) => ({
    select(columns: string, options?: unknown) {
      selects(table, columns, options);
      if (table !== "users") return { order: () => ({ range: async (offset: number) =>
        coreReads[table]?.[Math.floor(offset / 1_000)] ?? { data: coreRows[table] ?? [], error: null } }) };
      return { filter(column: string, operator: string, pattern: string) {
        filters(column, operator, pattern);
        return { not(column: string, operator: string, pattern: string) {
          filters(column, `not.${operator}`, pattern);
          return this;
        }, abortSignal: async (signal: AbortSignal) => {
          expect(signal).toBeInstanceOf(AbortSignal);
          const value = pattern === "^0x[0-9a-f]{40}$" ? canonical : noncanonical;
          if (value instanceof Error) throw value;
          return typeof value === "function" ? value(signal) : value;
        } };
      } };
    },
  }));
  vi.mocked(createClient).mockReturnValue({ from } as unknown as ReturnType<typeof createClient>);
  return { adapter: new SupabaseAdapter(), from, selects, filters };
}

describe("Supabase recorded account aggregates", () => {
  it.each([
    { data: null, count: null, error: new Error("Synthetic failed query page") },
    { data: null, count: null, error: null },
    { data: {}, count: null, error: null },
  ])("rejects unavailable question pages instead of claiming zero guest questions", async page => {
    const { adapter } = legacy({ data: null, count: 0, error: null }, undefined, {}, { query_runs: [page] });
    await expect(adapter.metrics()).rejects.toThrow("Question metrics unavailable");
  });

  it("rejects a failed later question page instead of publishing a partial guest count", async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) => ({ id: `guest-${index}`, origin: "web" }));
    const { adapter } = legacy({ data: null, count: 0, error: null }, undefined, {}, { query_runs: [
      { data: firstPage, count: null, error: null },
      { data: null, count: null, error: new Error("Synthetic failed second page") },
    ] });
    await expect(adapter.metrics()).rejects.toThrow("Question metrics unavailable");
  });

  it("shares guest-question counts from existing query metrics without exposing identities", async () => {
    const wallet = `0x${"a".repeat(40)}`;
    const metrics = await legacy({ data: null, error: null, count: 1 }, undefined, {
      query_runs: [
        { id: "guest", origin: "web", asker: null },
        { id: "signed-in", origin: "web", asker: wallet },
        { id: "a2a", origin: "a2a", asker: null },
        { id: "legacy", origin: null, asker: null },
      ],
    }).adapter.metrics();
    expect(metrics.guestQuestions).toBe(1);
    expect(metrics.totalQueries).toBe(4);
    expect(metrics.recordedAccounts).toBe(1);
    expect(JSON.stringify(metrics)).not.toContain(wallet);
  });

  it.each([0, 7])("returns an exact metadata-only count of %s canonical indexed wallets", async count => {
    const { adapter, selects, filters } = legacy({ data: null, error: null, count });
    const metrics = await adapter.metrics();
    expect(metrics.recordedAccounts).toBe(count);
    expect(metrics.totalQueries).toBe(0);
    expect(selects.mock.calls.filter(([table]) => table === "users")).toEqual([
      ["users", "wallet_address", { count: "exact", head: true }],
      ["users", "wallet_address", { count: "exact", head: true }],
    ]);
    expect(filters.mock.calls).toEqual([
      ["wallet_address", "match", "^0x[0-9a-f]{40}$"],
      ["wallet_address", "match", "^0[xX][0-9a-fA-F]{40}$"],
      ["wallet_address", "not.match", "^0x[0-9a-f]{40}$"],
    ]);
    expect(metrics).not.toHaveProperty("users");
  });

  it.each([null, undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "7"])(
    "withholds an unavailable or inexact count %s without discarding other metrics", async count => {
      const metrics = await legacy({ data: null, error: null, count }).adapter.metrics();
      expect(metrics.recordedAccounts).toBeNull();
      expect(metrics.totalQueries).toBe(0);
      expect(metrics.totalPayments).toBe(0);
    },
  );

  it.each([
    new Error("Synthetic provider response withheld"),
    { data: null, count: 7, error: new Error("Synthetic query failure") },
    { data: [{ wallet_address: `0x${"1".repeat(40)}` }], count: 1, error: null },
  ])("never uses failed reads or address-row responses as a count", async value => {
    expect((await legacy(value).adapter.metrics()).recordedAccounts).toBeNull();
  });

  it("withholds counts when noncanonical legacy rows could duplicate normalized accounts", async () => {
    const metrics = await legacy({ data: null, error: null, count: 1 }, { data: null, error: null, count: 1 }).adapter.metrics();
    expect(metrics.recordedAccounts).toBeNull();
  });

  it("returns healthy core metrics when delayed optional HEAD reads reach their separate deadline", async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("Synthetic account deadline")), milliseconds);
      return controller.signal;
    });
    const aborted = vi.fn();
    const delayed = (signal: AbortSignal) => new Promise<CountResult>((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted(); reject(signal.reason); }, { once: true });
    });
    const { adapter, from } = legacy(delayed, delayed, {
      payment_events: [{ amount_usdc: 0.03, source_id: "publication", query_id: "answered", kind: "citation",
        origin: "web", settled: true, settlement_status: "settled" }],
      query_runs: [{ id: "answered", origin: "web" }],
    });
    let finished = false;
    const pending = adapter.metrics().then(metrics => { finished = true; return metrics; });
    await vi.advanceTimersByTimeAsync(0);
    expect(from.mock.calls.map(([table]) => table).filter(table => table !== "users")).toEqual([
      "payment_events", "query_runs", "answer_feedback", "gap_intents",
    ]);
    expect(timeout.mock.calls).toEqual([[3_000], [3_000]]);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(finished).toBe(true);
    const metrics = await pending;
    expect(metrics.recordedAccounts).toBeNull();
    expect(metrics.totalQueries).toBe(1);
    expect(metrics.totalPayments).toBe(1);
    expect(metrics.totalVolumeUsdc).toBe(0.03);
    expect(aborted).toHaveBeenCalledTimes(2);
  });

  it("keeps enrolled metrics behind their registered scan RPCs without reading users", async () => {
    const deployment: StorageDeploymentManifest = { format: "keryx-storage-deployment-v1",
      backend: { kind: "supabase", url: "https://synthetic-db.invalid" }, identity: {
        format: "keryx-storage-identity-v1", network: "eip155:5042002", authorityMode: "testnet-offline",
        deploymentId: "11111111-1111-4111-8111-111111111111", storageId: "22222222-2222-4222-8222-222222222222",
        enrollmentId: "33333333-3333-4333-8333-333333333333", enrolledAt: "2026-01-01T00:00:00.000Z",
        profileDigest: STORAGE_TESTNET_PROFILE_DIGEST, provenanceDigest: "0".repeat(64),
      } };
    const from = vi.fn(() => { throw new Error("Direct table reads forbidden"); });
    const rpc = vi.fn((name: string) => {
      const data = name === "read_storage_identity" ? deployment.identity
        : name === "storage_inspect_runtime_readiness" ? { format: "keryx-enrolled-runtime-readiness-v1", ready: true,
          sourceContractDigest: SUPABASE_RUNTIME_CONTRACT.afterDigest, cacheRows: [], cacheRowCount: 0, cacheWireBytes: 0 }
          : name.startsWith("storage_scan_") ? [] : null;
      const promise = Promise.resolve({ data, error: null });
      return Object.assign(promise, { throwOnError: () => promise });
    });
    const { adapter } = assembleAuthorityBoundSupabaseCore({ from, rpc } as unknown as ReturnType<typeof createClient>,
      deployment, () => deployment);
    await adapter.init();
    const metrics = await adapter.metrics();
    expect(metrics.recordedAccounts).toBeNull();
    expect(from).not.toHaveBeenCalled();
    expect(metrics.guestQuestions).toBe(0);
    expect(rpc.mock.calls.map(([name]) => name).filter(name => name.startsWith("storage_scan_"))).toEqual([
      "storage_scan_payment_metrics", "storage_scan_query_metrics", "storage_scan_feedback_metrics", "storage_scan_gap_metrics",
    ]);
    expect(rpc.mock.calls.some(([name]) => /users?|accounts?|metrics$/.test(name) && !name.startsWith("storage_scan_"))).toBe(false);
  });
});

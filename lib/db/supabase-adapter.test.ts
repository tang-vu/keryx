import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SupabaseAdapter, throwingSupabaseFetch, assembleAuthorityBoundSupabaseCore,
} from "./supabase-adapter";
import { assertEnrolledSupabaseAuthority, closeEnrolledSupabaseAdapter, createEnrolledSupabaseAdapter, createReadonlyEnrolledSupabaseAdapter } from "./enrolled-supabase-adapter";
import { makePayment } from "../payments/payment-gateway";
import { createClient } from "@supabase/supabase-js";
import { STORAGE_MAINNET_PROFILE_DIGEST, STORAGE_TESTNET_PROFILE_DIGEST } from "./storage-identity";
import type { StorageDeploymentManifest } from "./runtime-storage-config";
import { SUPABASE_RUNTIME_CONTRACT } from "./supabase-runtime-contract";
import * as sourceAuthority from "../payments/browser-original-source-authority";
import type { BrowserSourceOriginalAdmission } from "./browser-signing-originals";
import { syntheticA2aOriginal } from "./a2a-original-fixture";
import { monthlyOrderToRow } from "./research-monthly";

vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...await importOriginal<typeof import("@supabase/supabase-js")>(),
  createClient: vi.fn(),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); vi.restoreAllMocks(); });

describe("ordinary Supabase exact source article membership", () => {
  it("bounds membership to source and exact link, refuses duplicates and propagates failed reads", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
    const row = { id: "newest", source_id: "one", title: "Synthetic", content: "Catalog body", summary: "Preview", link: "https://one.example/newest" };
    const limit = vi.fn().mockResolvedValue({ data: [row], error: null });
    const eq = vi.fn().mockReturnThis(), select = vi.fn().mockReturnThis();
    const query = { select, eq, limit };
    const from = vi.fn().mockReturnValue(query);
    vi.mocked(createClient).mockReturnValue({ from } as unknown as ReturnType<typeof createClient>);
    const db = new SupabaseAdapter();
    expect(await db.getSourceItemByLink("one", row.link)).toMatchObject({ id: "newest", sourceId: "one", link: row.link });
    expect(from).toHaveBeenCalledExactlyOnceWith("source_items");
    expect(eq.mock.calls).toEqual([["source_id", "one"], ["link", row.link]]); expect(limit).toHaveBeenCalledWith(2);
    limit.mockResolvedValueOnce({ data: [row, { ...row, id: "duplicate" }], error: null });
    await expect(db.getSourceItemByLink("one", row.link)).rejects.toThrow("Ambiguous");
    limit.mockResolvedValueOnce({ data: [], error: null });
    expect(await db.getSourceItemByLink("one", row.link)).toBeNull();
    const failure = new Error("Synthetic read failed"); limit.mockResolvedValueOnce({ data: null, error: failure });
    await expect(db.getSourceItemByLink("one", row.link)).rejects.toBe(failure);
  });
});

describe("ordinary Supabase exact original RPC", () => {
  function ordinary(data: unknown, error: unknown = null) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
    const rpc = vi.fn().mockResolvedValue({ data, error }), from = vi.fn();
    vi.mocked(createClient).mockReturnValue({ rpc, from } as unknown as ReturnType<typeof createClient>);
    return { db: new SupabaseAdapter(), rpc, from };
  }
  it("uses only the targeted RPC and retains its bound worker result", async () => {
    const fixture = syntheticA2aOriginal(), at = "2026-10-06T03:24:02.000Z";
    const storedAt = "2026-10-06T03:24:02+00:00";
    const { db, rpc, from } = ordinary([monthlyOrderToRow({ ...fixture.order, workerId: "worker", startedAt: storedAt })]);
    expect(await db.claimNextA2aOrder("worker", at, fixture.binding)).toMatchObject({ id: fixture.order.id, workerId: "worker", startedAt: storedAt });
    expect(rpc).toHaveBeenCalledWith("claim_original_a2a_order_v1", { p_expected: fixture.binding, p_worker_id: "worker", p_started_at: at });
    expect(from).not.toHaveBeenCalled();
  });
  it("does not fall back to REST after an empty claim or RPC failure", async () => {
    const fixture = syntheticA2aOriginal(), at = "2026-10-06T03:24:02.000Z";
    const empty = ordinary([]); expect(await empty.db.claimNextA2aOrder("worker", at, fixture.binding)).toBeNull();
    expect(empty.from).not.toHaveBeenCalled();
    const failure = new Error("synthetic failure"), failed = ordinary(null, failure);
    await expect(failed.db.claimNextA2aOrder("worker", at, fixture.binding)).rejects.toBe(failure);
    expect(failed.from).not.toHaveBeenCalled();
  });
  it.each([true, false])("requires a native boolean settlement proof (%s)", async value => {
    const fixture = syntheticA2aOriginal(), { db, rpc, from } = ordinary(value);
    expect(await db.hasA2aOriginalSettlement(fixture.binding)).toBe(value);
    expect(rpc).toHaveBeenCalledWith("has_original_a2a_settlement_v1", { p_expected: fixture.binding });
    expect(from).not.toHaveBeenCalled();
  });
  it.each([null, {}, [null], [monthlyOrderToRow(syntheticA2aOriginal(2).order)],
    [monthlyOrderToRow(syntheticA2aOriginal().order), monthlyOrderToRow(syntheticA2aOriginal().order)]]
    .map((data, index) => ({ data, index })))
    ("holds an unknown or mismatched targeted RPC result ($index)", async ({ data }) => {
      const fixture = syntheticA2aOriginal(), { db, from } = ordinary(data);
      await expect(db.claimNextA2aOrder("worker", "2026-10-06T03:24:02.000Z", fixture.binding)).rejects.toThrow();
      expect(from).not.toHaveBeenCalled();
    });
  it("refuses unknown proof, malformed bindings and sealed storage before any fallback", async () => {
    const fixture = syntheticA2aOriginal(), unknown = ordinary(null);
    await expect(unknown.db.hasA2aOriginalSettlement(fixture.binding)).rejects.toThrow();
    unknown.rpc.mockClear();
    await expect(unknown.db.claimNextA2aOrder("worker", "2026-10-06T03:24:02.000Z", { ...fixture.binding, amountMicroUsdc: "30001" })).rejects.toThrow();
    expect(unknown.rpc).not.toHaveBeenCalled();
    const deployment: StorageDeploymentManifest = { format: "keryx-storage-deployment-v1",
      backend: { kind: "supabase", url: "https://synthetic-db.invalid" }, identity: {
        format: "keryx-mainnet-storage-identity-v1", network: "eip155:5042", authorityMode: "mainnet-real",
        deploymentId: "11111111-1111-4111-8111-111111111111", storageId: "22222222-2222-4222-8222-222222222222",
        enrollmentId: "33333333-3333-4333-8333-333333333333", enrolledAt: "2026-01-01T00:00:00.000Z",
        profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, provenanceDigest: "0".repeat(64),
      } };
    const rpc = vi.fn(), from = vi.fn(), { adapter } = assembleAuthorityBoundSupabaseCore(
      { from, rpc } as unknown as ReturnType<typeof createClient>, deployment, () => deployment);
    await expect(adapter.claimNextA2aOrder("worker", "2026-10-06T03:24:02.000Z", fixture.binding)).rejects.toThrow(/not admitted/);
    await expect(adapter.hasA2aOriginalSettlement(fixture.binding)).rejects.toThrow(/not admitted/);
    expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
  });
});

describe("throwingSupabaseFetch", () => {
  it("returns successful responses unchanged", async () => {
    const response = new Response("ok", { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(throwingSupabaseFetch("https://db.example/rest/v1/sources")).resolves.toBe(response);
  });

  it("turns PostgREST errors into rejected promises", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"message":"column missing"}', { status: 400 }),
      ),
    );
    await expect(
      throwingSupabaseFetch("https://db.example/rest/v1/payment_events"),
    ).rejects.toThrow(/Supabase request failed \(400\).*column missing/);
  });
});

describe("SupabaseAdapter.recordPayment", () => {
  it("rejects a payment insert when Supabase returns an error result", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
    const failure = new Error("synthetic payment insert failure");
    const insert = vi.fn().mockResolvedValue({ data: null, error: failure });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createClient).mockReturnValue({ from } as unknown as ReturnType<typeof createClient>);
    const db = new SupabaseAdapter();

    await expect(db.recordPayment(makePayment({
      id: "synthetic-payment",
      kind: "fetch",
      queryId: "synthetic-query",
      sourceId: "synthetic-source",
      sourceName: "Synthetic Source",
      payer: "0xPayer",
      payee: "0xPayee",
      amountUsdc: 0.002,
      settled: false,
      settlementStatus: "pending",
      authorizationId: "synthetic-nonce",
    }))).rejects.toBe(failure);
    expect(from).toHaveBeenCalledWith("payment_events");
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe("SupabaseAdapter.settlementLedger read integrity", () => {
  function legacy(reads: Record<string, { data: unknown; error: unknown } | Error>) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
    const from = vi.fn((table: string) => ({ select: vi.fn(async () => {
      const value = reads[table];
      if (value instanceof Error) throw value;
      return value;
    }) }));
    vi.mocked(createClient).mockReturnValue({ from } as unknown as ReturnType<typeof createClient>);
    return { db: new SupabaseAdapter(), from };
  }

  it.each(["payment_events", "withdrawals"])("rejects resolved %s failures rather than reporting empty or partial evidence", async table => {
    const reads = { payment_events: { data: [{ payee: "0xWallet", source_name: "Fixture", amount_usdc: 0.002, kind: "fetch", settled: true }], error: null },
      withdrawals: { data: [], error: null } } as Record<string, { data: unknown; error: unknown }>;
    reads[table] = { data: null, error: { message: "PRIVATE_PROVIDER_BODY", details: "private database details" } };
    const { db } = legacy(reads);
    await expect(db.settlementLedger()).rejects.toThrow(/^Settlement ledger unavailable$/);
  });

  it.each(["payment_events", "withdrawals"])("sanitizes rejected %s transport failures", async table => {
    const reads: Record<string, { data: unknown; error: unknown } | Error> = {
      payment_events: { data: [], error: null }, withdrawals: { data: [], error: null },
    };
    reads[table] = new Error("PRIVATE_PROVIDER_BODY");
    await expect(legacy(reads).db.settlementLedger()).rejects.toThrow(/^Settlement ledger unavailable$/);
  });

  it("returns empty only after both table reads successfully return empty arrays", async () => {
    const { db, from } = legacy({ payment_events: { data: [], error: null }, withdrawals: { data: [], error: null } });
    await expect(db.settlementLedger()).resolves.toEqual([]);
    expect(from.mock.calls.map(([table]) => table)).toEqual(["payment_events", "withdrawals"]);
    await expect(legacy({ payment_events: { data: null, error: null }, withdrawals: { data: [], error: null } }).db.settlementLedger())
      .rejects.toThrow(/^Settlement ledger unavailable$/);
  });

  it("preserves successful payment/withdrawal aggregation and excludes inbound and unsettled rows", async () => {
    const { db } = legacy({ payment_events: { data: [
      { payee: "0xWallet", source_name: "Fixture", amount_usdc: 0.003, kind: "fetch", settled: true },
      { payee: "0xwallet", amount_usdc: 0.002, kind: "citation", settled: true },
      { payee: "0xOther", amount_usdc: 1, kind: "inbound", settled: true },
      { payee: "0xOther", amount_usdc: 1, kind: "citation", settled: false },
    ], error: null }, withdrawals: { data: [{ wallet: "0xWALLET", amount_usdc: 0.001 }], error: null } });
    await expect(db.settlementLedger()).resolves.toEqual([{ address: "0xWallet", label: "Fixture", paidUsdc: 0.005,
      paymentCount: 2, withdrawnUsdc: 0.001, withdrawCount: 1 }]);
  });

  it("retains the mainnet enrolled initialization refusal without falling back to legacy tables", async () => {
    const deployment: StorageDeploymentManifest = { format: "keryx-storage-deployment-v1",
      backend: { kind: "supabase", url: "https://synthetic-db.invalid" }, identity: {
        format: "keryx-mainnet-storage-identity-v1", network: "eip155:5042", authorityMode: "mainnet-real",
        deploymentId: "11111111-1111-4111-8111-111111111111", storageId: "22222222-2222-4222-8222-222222222222",
        enrollmentId: "33333333-3333-4333-8333-333333333333", enrolledAt: "2026-01-01T00:00:00.000Z",
        profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, provenanceDigest: "0".repeat(64),
      } };
    const from = vi.fn(), rpc = vi.fn();
    const { adapter } = assembleAuthorityBoundSupabaseCore(
      { from, rpc } as unknown as ReturnType<typeof createClient>, deployment, () => deployment);
    await expect(adapter.settlementLedger()).rejects.toMatchObject({ reason: "adapter_not_initialized" });
    expect(from).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
});

describe("closed enrolled Supabase construction", () => {
  it("rejects caller construction capabilities before creating a client", () => {
    expect(() => new SupabaseAdapter(Object.freeze({}))).toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([createEnrolledSupabaseAdapter, createReadonlyEnrolledSupabaseAdapter])(
    "rejects JavaScript argument overrides before deployment configuration or client construction",
    async (factory) => {
      await expect(Reflect.apply(factory, undefined, [{ backend: "synthetic" }])).rejects.toThrow();
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it("does not grant runtime authority to JSON, casts or copied methods", async () => {
    const fake = { listSources: async () => [], init: async () => {} };
    await expect(assertEnrolledSupabaseAuthority(fake)).rejects.toThrow();
    await expect(assertEnrolledSupabaseAuthority(JSON.parse(JSON.stringify(fake)))).rejects.toThrow();
    await expect(Reflect.apply(assertEnrolledSupabaseAuthority, undefined, [fake, "admin"])).rejects.toThrow();
    expect(() => closeEnrolledSupabaseAdapter(fake)).toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("does not grant installed provenance to an internally assembled core with a fabricated client", async () => {
    const deployment: StorageDeploymentManifest = {
      format: "keryx-storage-deployment-v1",
      backend: { kind: "supabase", url: "https://synthetic-db.invalid" },
      identity: {
        format: "keryx-storage-identity-v1", network: "eip155:5042002", authorityMode: "testnet-offline",
        deploymentId: "11111111-1111-4111-8111-111111111111",
        storageId: "22222222-2222-4222-8222-222222222222",
        enrollmentId: "33333333-3333-4333-8333-333333333333",
        enrolledAt: "2026-01-01T00:00:00.000Z", profileDigest: STORAGE_TESTNET_PROFILE_DIGEST,
        provenanceDigest: "0".repeat(64),
      },
    };
    const rpc = vi.fn();
    const { adapter } = assembleAuthorityBoundSupabaseCore(
      { rpc } as unknown as ReturnType<typeof createClient>, deployment, () => deployment,
    );
    await expect(assertEnrolledSupabaseAuthority(adapter)).rejects.toThrow();
    await expect(assertEnrolledSupabaseAuthority({ ...adapter })).rejects.toThrow();
    expect(() => closeEnrolledSupabaseAdapter(adapter)).toThrow();
    expect(rpc).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    const failure = new Error("synthetic enrolled user write failure");
    rpc.mockImplementation((name: string) => {
      const result = name === "read_storage_identity" ? { data: deployment.identity, error: null }
        : name === "storage_inspect_runtime_readiness" ? { data: {
          format: "keryx-enrolled-runtime-readiness-v1", ready: true,
          sourceContractDigest: SUPABASE_RUNTIME_CONTRACT.afterDigest,
          cacheRows: [], cacheRowCount: 0, cacheWireBytes: 0,
        }, error: null }
          : name === "storage_upsert_user" ? { data: null, error: failure }
            : { data: null, error: null };
      const promise = Promise.resolve(result);
      return Object.assign(promise, { throwOnError: () => promise });
    });
    await adapter.init();
    await expect(adapter.upsertUser("0x1111111111111111111111111111111111111111", "creator")).rejects.toBe(failure);
    expect(rpc.mock.calls.filter(([name]) => name === "storage_get_user")).toHaveLength(1);
  });
});


describe("private enrolled browser source catalog", () => {
  it.each([false, true])("captures one exact snapshot and refuses foreign row binding=%s", async (foreign) => {
    const deployment: StorageDeploymentManifest = {
      format: "keryx-storage-deployment-v1", backend: { kind: "supabase", url: "https://synthetic-db.invalid" },
      identity: { format: "keryx-storage-identity-v1", network: "eip155:5042002", authorityMode: "testnet-offline",
        deploymentId: "11111111-1111-4111-8111-111111111111", storageId: "22222222-2222-4222-8222-222222222222",
        enrollmentId: "33333333-3333-4333-8333-333333333333", enrolledAt: "2026-01-01T00:00:00.000Z",
        profileDigest: STORAGE_TESTNET_PROFILE_DIGEST, provenanceDigest: "0".repeat(64) },
    };
    // No init/cache/key test here: explicit internal NONPROVENANCE core is made
    // ready by the actual offline identity to isolate this private RPC codec.
    const payload = { source: { id: "source", name: "Fixture", url: "https://source.example", tags: [] },
      item: { id: "item", source_id: foreign ? "other" : "source", content: "synthetic", title: "Fixture" }, offer: null };
    const rpc = vi.fn((name: string) => {
      const data = name === "read_storage_identity" ? deployment.identity
        : name === "storage_inspect_runtime_readiness" ? { format: "keryx-enrolled-runtime-readiness-v1", ready: true,
          sourceContractDigest: SUPABASE_RUNTIME_CONTRACT.afterDigest, cacheRows: [], cacheRowCount: 0, cacheWireBytes: 0 }
          : name === "storage_browser_signing_replay_source_original" ? { status: "missing" }
            : name === "storage_read_browser_source_catalog" ? payload : null;
      const promise = Promise.resolve({ data, error: null });
      return Object.assign(promise, { throwOnError: () => promise });
    });
    const { adapter } = assembleAuthorityBoundSupabaseCore(
      { rpc } as unknown as ReturnType<typeof createClient>, deployment, () => deployment);
    await adapter.init();
    const stopped = new Error("Synthetic resolver stops before any token");
    vi.spyOn(sourceAuthority, "createBrowserOriginalSourceAuthority").mockImplementation(catalog => ({
      resolve: async () => {
        const source = await catalog.getSource("source");
        const item = await catalog.getItem("source", "item");
        const offer = await catalog.getArticleOffer("source", "item");
        expect(source?.id).toBe("source"); expect(item?.sourceId).toBe("source"); expect(offer).toBeNull();
        payload.item.content = "changed after capture";
        expect((await catalog.getItem("source", "item"))?.content).toBe("synthetic");
        expect(Object.isFrozen(item)).toBe(true);
        await expect(catalog.getItem("other", "item")).rejects.toThrow();
        throw stopped;
      },
    }));
    const input = { protocol: "durable-v3", source: { sourceId: "source", itemId: "item" },
      journal: { kind: "fetch" } } as BrowserSourceOriginalAdmission;
    if (foreign) await expect(adapter.admitBrowserSourceSigningOriginal(input)).rejects.toThrow();
    else await expect(adapter.admitBrowserSourceSigningOriginal(input)).rejects.toBe(stopped);
    expect(rpc.mock.calls.filter(([name]) => name === "storage_read_browser_source_catalog")).toHaveLength(1);
    expect(rpc.mock.calls.some(([name]) => name === "storage_get_source" || name === "storage_get_item" ||
      name === "storage_browser_signing_admit_source_original")).toBe(false);
    await expect(assertEnrolledSupabaseAuthority(adapter)).rejects.toThrow();
  });
});

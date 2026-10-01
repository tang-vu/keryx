import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SupabaseAdapter, throwingSupabaseFetch, assembleAuthorityBoundSupabaseCore,
} from "./supabase-adapter";
import { assertEnrolledSupabaseAuthority, closeEnrolledSupabaseAdapter, createEnrolledSupabaseAdapter, createReadonlyEnrolledSupabaseAdapter } from "./enrolled-supabase-adapter";
import { makePayment } from "../payments/payment-gateway";
import { createClient } from "@supabase/supabase-js";
import { STORAGE_TESTNET_PROFILE_DIGEST } from "./storage-identity";
import type { StorageDeploymentManifest } from "./runtime-storage-config";
import { SUPABASE_RUNTIME_CONTRACT } from "./supabase-runtime-contract";
import * as sourceAuthority from "../payments/browser-original-source-authority";
import type { BrowserSourceOriginalAdmission } from "./browser-signing-originals";

vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...await importOriginal<typeof import("@supabase/supabase-js")>(),
  createClient: vi.fn(),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); vi.restoreAllMocks(); });

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

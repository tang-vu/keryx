import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SupabaseAdapter, throwingSupabaseFetch, assertEnrolledSupabaseAuthority,
  closeEnrolledSupabaseAdapter, createEnrolledSupabaseAdapter,
  createReadonlyEnrolledSupabaseAdapter,
} from "./supabase-adapter";
import { makePayment } from "../payments/payment-gateway";
import { createClient } from "@supabase/supabase-js";

vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...await importOriginal<typeof import("@supabase/supabase-js")>(),
  createClient: vi.fn(),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

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
});

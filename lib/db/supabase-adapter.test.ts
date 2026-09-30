import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseAdapter, throwingSupabaseFetch } from "./supabase-adapter";
import { testSupabaseAdapter, supabaseTestIdentity } from "./supabase-authority-test-fixture";
import { makePayment } from "../payments/payment-gateway";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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
    const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: "synthetic payment insert failure" }, { status: 400 }));
    vi.stubGlobal("fetch", http);
    const db = await testSupabaseAdapter();

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
    }))).rejects.toThrow("synthetic payment insert failure");
    expect(String(http.mock.calls[0][0])).toContain("/rpc/storage_record_payment");
    expect(JSON.parse(String(http.mock.calls[0][1]?.body)).p_expected_identity).toEqual(supabaseTestIdentity);
    expect(http).toHaveBeenCalledTimes(1);
  });
});

it("keeps direct adapter authority closed after marker admission when cache initialization fails", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
  vi.stubEnv("CONTENT_MASTER_KEY", "");
  vi.stubEnv("KERYX_FORCE_OFFLINE", "false");
  const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json(supabaseTestIdentity));
  vi.stubGlobal("fetch", http);
  const db = new SupabaseAdapter(supabaseTestIdentity);
  await expect(db.init()).rejects.toThrow("CONTENT_MASTER_KEY");
  expect(() => db.getStorageIdentity()).toThrow();
  await expect(db.getSource("source")).rejects.toThrow();
  expect(http).toHaveBeenCalledTimes(1);
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { preparePrivateRunClaim } from "../run-claims/delivery";
import { deliveryFixture } from "../run-claims/delivery.test-fixture";
import { createSupabaseRunClaims } from "./run-claims-supabase";
import { assembleAuthorityBoundSupabaseCore, SupabaseAdapter } from "./supabase-adapter";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import type { StorageDeploymentManifest } from "./runtime-storage-config";
import { requireRunClaims, type RunClaimBinding } from "../run-claims/contracts";

const wallet = `0x${"a".repeat(40)}`, binding: RunClaimBinding = { network: "eip155:5042002", origin: "https://synthetic-claims.example" };
const input = { runId: "new-run", tokenHash: "1".repeat(64), completedAt: "2026-10-11T00:00:00.000Z", binding };
const issued = { version: 1, runId: input.runId, binding, issuedAt: input.completedAt, expiresAt: "2026-10-12T00:00:00.000Z" };
const attempt = { tokenHash: input.tokenHash, wallet, sessionHash: "2".repeat(64), binding };
const receipt = { version: 1, runId: input.runId, wallet, binding, claimedAt: input.completedAt };
function fixture(data: unknown = { version: 1, ready: true }, error: unknown = null) {
  const response = vi.fn().mockResolvedValue({ data, error });
  const abortSignal = vi.fn(() => response());
  const rpc = vi.fn(() => ({ abortSignal })), from = vi.fn(() => { throw new Error("REST forbidden"); });
  const client = { rpc, from } as unknown as SupabaseClient;
  return { rpc, response, abortSignal, from, client, port: createSupabaseRunClaims(client) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("ordinary hash-only anonymous claim RPC boundary", () => {
  it("uses fixed RPCs with exact binding/session/hash arguments and strict acknowledgements", async () => {
    const f = fixture(); await f.port.assertAvailable(); expect(f.rpc).toHaveBeenLastCalledWith("anonymous_run_claims_ready_v1", {});
    f.response.mockResolvedValue({ data: issued, error: null }); expect(await f.port.issue(input)).toEqual(issued);
    expect(f.rpc).toHaveBeenLastCalledWith("anonymous_run_claim_issue_v1", { p_run_id: input.runId, p_token_hash: input.tokenHash,
      p_completed_at: input.completedAt, p_network: binding.network, p_origin: binding.origin });
    f.response.mockResolvedValue({ data: receipt, error: null }); expect(await f.port.claim({ ...attempt, wallet: wallet.toUpperCase().replace("0X", "0x") })).toEqual(receipt);
    expect(f.rpc).toHaveBeenLastCalledWith("anonymous_run_claim_consume_v1", { p_token_hash: input.tokenHash,
      p_wallet: wallet, p_session_hash: attempt.sessionHash, p_network: binding.network, p_origin: binding.origin });
    expect(f.from).not.toHaveBeenCalled();
  });
  it.each([null, {}, { version: 1, ready: false }, { version: 1, ready: true, token: "secret" }])("refuses malformed readiness", async data => {
    const f = fixture(data); await expect(f.port.assertAvailable()).rejects.toThrow(/^claims_unavailable$/); expect(f.from).not.toHaveBeenCalled();
  });
  it.each([{ ...issued, runId: "other" }, { ...issued, binding: { ...binding, origin: "https://other.example" } },
    { ...issued, expiresAt: "2026-10-12T00:00:01.000Z" }, { ...issued, token: "secret" }, null])("refuses wrong/malformed issuance", async data => {
    const f = fixture(data); await expect(f.port.issue(input)).rejects.toThrow(/^claims_unavailable$/);
  });
  it.each([{ ...receipt, wallet: `0x${"b".repeat(40)}` }, { ...receipt, binding: { ...binding, network: "eip155:5042" } },
    { ...receipt, claimedAt: "bad" }, { ...receipt, token: "secret" }, null])("refuses wrong/malformed consume receipts", async data => {
    const f = fixture(data); await expect(f.port.claim(attempt)).rejects.toThrow(/^claims_unavailable$/);
  });
  it("maps fixed refusal codes without leaking backend bodies, retries or REST fallback", async () => {
    const f = fixture(null, { code: "PGRST202", message: "private backend details" });
    await expect(f.port.assertAvailable()).rejects.toThrow(/^claims_unavailable$/);
    for (const code of ["claim_unavailable", "claim_unauthenticated"]) {
      f.response.mockResolvedValue({ data: null, error: { code: "P0001", message: code } }); await expect(f.port.claim(attempt)).rejects.toThrow(new RegExp(`^${code}$`));
    }
    f.response.mockRejectedValue(new Error("secret backend body")); await expect(f.port.claim(attempt)).rejects.toThrow(/^claims_unavailable$/);
    expect(f.rpc).toHaveBeenCalledTimes(4); expect(f.from).not.toHaveBeenCalled();
  });
  it("extra/invalid input refuses before RPC", async () => {
    const f = fixture();
    await expect(f.port.issue({ ...input, token: "raw-secret" } as typeof input)).rejects.toThrow(/^claim_unavailable$/);
    await expect(f.port.claim({ ...attempt, wallet: "forged" })).rejects.toThrow(/^claim_unavailable$/);
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled();
  });
  it("ordinary assembly is default-off/nonenumerable; sealed core has no port before I/O", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-no-authority");
    const http = vi.fn(() => { throw new Error("Network forbidden"); }); vi.stubGlobal("fetch", http);
    const plain = new SupabaseAdapter(); expect(plain.runClaims).toBeUndefined();
    vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true"); const enabled = new SupabaseAdapter();
    expect(enabled.runClaims).toBeDefined(); expect(Object.keys(enabled)).not.toContain("runClaims");
    expect(Object.getOwnPropertyNames(SupabaseAdapter.prototype)).not.toContain("runClaims"); expect(http).not.toHaveBeenCalled();
    const f = fixture(), deployment = { format: "keryx-storage-deployment-v1", identity: syntheticStorageIdentity("testnet-offline"),
      backend: { kind: "supabase", url: "https://synthetic-db.example", projectRef: "synthetic-db", credentialEnv: "SUPABASE_SERVICE_ROLE_KEY" } } as unknown as StorageDeploymentManifest;
    const core = assembleAuthorityBoundSupabaseCore(f.client, deployment, () => deployment);
    expect(Object.hasOwn(core.adapter, "runClaims")).toBe(false); expect(() => requireRunClaims(core.adapter)).toThrow(/^claims_unavailable$/);
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled();
  });
});

describe("real PostgREST claim transport deadlines", () => {
  it.each(["ready", "consume"] as const)("aborts the actual %s RPC transport once and retains a fixed refusal", async operation => {
    const controller = new AbortController(), timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST"); expect(init?.signal).toBe(controller.signal);
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
    });
    const client = createClient("https://synthetic-claims.example", "synthetic-no-authority", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
    });
    const port = createSupabaseRunClaims(client), from = vi.spyOn(client, "from");
    const pending = operation === "ready" ? port.assertAvailable() : port.claim(attempt);
    const refused = expect(pending).rejects.toThrow(/^claims_unavailable$/);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(new URL(String(fetch.mock.calls[0][0])).pathname).toBe(operation === "ready"
      ? "/rest/v1/rpc/anonymous_run_claims_ready_v1" : "/rest/v1/rpc/anonymous_run_claim_consume_v1");
    controller.abort(new DOMException("synthetic-private-transport-details", "TimeoutError"));
    await refused; expect(fetch).toHaveBeenCalledTimes(1); expect(from).not.toHaveBeenCalled();
  });
  it("a real fifteen-second issuance deadline releases private completion without changing the saved answer or finances", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout"), fixture = deliveryFixture();
    let issuanceSignal: AbortSignal | undefined;
    const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST"); expect(init?.signal).toBeInstanceOf(AbortSignal);
      const name = new URL(String(url)).pathname;
      if (name === "/rest/v1/rpc/anonymous_run_claims_ready_v1") return Promise.resolve(Response.json({ version: 1, ready: true }));
      expect(name).toBe("/rest/v1/rpc/anonymous_run_claim_issue_v1");
      issuanceSignal = init!.signal!;
      expect(issuanceSignal.aborted).toBe(false);
      const args = JSON.parse(String(init!.body));
      expect(args).toMatchObject({ p_run_id: input.runId, p_network: binding.network, p_origin: binding.origin });
      expect(args.p_token_hash).toMatch(/^[a-f0-9]{64}$/); expect(args).not.toHaveProperty("token");
      return new Promise<Response>((_resolve, reject) => issuanceSignal!.addEventListener("abort", () => reject(issuanceSignal!.reason), { once: true }));
    });
    const client = createClient("https://synthetic-claims.example", "synthetic-no-authority", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
    });
    try {
      const delivery = (await preparePrivateRunClaim({ enabled: true, runId: input.runId, binding,
        db: async () => ({ runClaims: createSupabaseRunClaims(client) }) }))!;
      const run = fixture.save(input.runId, { budget: 0.02, totalSpent: 0.012345, totalToCreators: 0.003456 });
      const original = JSON.stringify(run), saved = () => fixture.sql.prepare("SELECT data FROM query_runs WHERE id=?").get(input.runId)?.data;
      expect(saved()).toBe(original);
      const started = performance.now(), pending = delivery.complete(run);
      await vi.waitFor(() => expect(issuanceSignal).toBeDefined());
      expect(issuanceSignal!.aborted).toBe(false);
      const packet = await pending;
      expect(performance.now() - started).toBeGreaterThanOrEqual(14_000);
      expect(issuanceSignal!.aborted).toBe(true); expect(issuanceSignal!.reason.name).toBe("TimeoutError");
      expect(timeout.mock.calls).toEqual([[15_000], [15_000]]);
      expect(packet).toEqual({ version: 1, runId: input.runId, status: "unavailable" });
      expect(JSON.stringify(run)).toBe(original); expect(saved()).toBe(original);
      expect(await delivery.complete(run)).toBeNull(); expect(fetch).toHaveBeenCalledTimes(2);
    } finally { fixture.sql.close(); }
  }, 25_000);
});

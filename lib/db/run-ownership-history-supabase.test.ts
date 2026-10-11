import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireRunOwnershipHistory } from "../run-claims/history";
import { assembleAuthorityBoundSupabaseCore, SupabaseAdapter } from "./supabase-adapter";
import { createSupabaseRunOwnershipHistory } from "./run-ownership-history-supabase";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import type { StorageDeploymentManifest } from "./runtime-storage-config";

const wallet = `0x${"a".repeat(40)}`, other = `0x${"b".repeat(40)}`;
const binding = { network: "eip155:5042002" as const, origin: "https://synthetic-claims.example" }, date = "2026-10-11T00:00:00.000Z";
const row = { id: "run", createdAt: date, question: "Fixture", provenance: null, funding: "other-or-unknown", recordedSpendUsdc: 0.01,
  recordedCreatorAllocationUsdc: 0.005, paymentMode: "offline", isFollowUp: false, ownership: { method: "claimed", claimedAt: date } };
const run = { id: "run", createdAt: date, answer: "Private", retainedReceipt: { payer: other, transaction: "synthetic-never-settled" } };
const packet = (extra: Record<string, unknown> = {}) => ({ version: 1, wallet, binding, ...extra });
function fixture(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null }), from = vi.fn(() => { throw new Error("REST forbidden"); });
  const client = { rpc, from } as unknown as SupabaseClient; return { rpc, from, client, port: createSupabaseRunOwnershipHistory(client) };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("ordinary private ownership history RPC boundary", () => {
  it("uses fixed bounded RPCs and returns originals unchanged with separate ownership metadata", async () => {
    const f = fixture(packet({ rows: [row] })); expect(await f.port.list(wallet, { binding, filters: {}, take: 2 })).toEqual([row]);
    expect(f.rpc).toHaveBeenLastCalledWith("anonymous_run_claim_history_list_v1", { p_wallet: wallet, p_network: binding.network, p_origin: binding.origin,
      p_filters: {}, p_take: 2, p_upper: null, p_before: null });
    f.rpc.mockResolvedValue({ data: packet({ item: { run, ownership: row.ownership } }), error: null });
    expect((await f.port.read(wallet, binding, "run"))?.run).toBe(run);
    expect(f.rpc).toHaveBeenLastCalledWith("anonymous_run_claim_history_read_v1", { p_wallet: wallet, p_network: binding.network, p_origin: binding.origin, p_run_id: "run" });
    expect(run).not.toHaveProperty("asker"); expect(f.from).not.toHaveBeenCalled();
    f.rpc.mockResolvedValue({ data: packet({ item: null }), error: null }); expect(await f.port.read(wallet, binding, "missing")).toBeNull();
  });
  it.each([packet({ wallet: other, rows: [] }), packet({ binding: { ...binding, origin: "https://other.example" }, rows: [] }),
    packet({ rows: [row], tokenHash: "secret" }), packet({ rows: [{ ...row, ownership: { ...row.ownership, tokenHash: "secret" } }] }), packet({ rows: [row, row] }), null])
    ("refuses malformed/wrong-owner/oversized summary packets", async data => {
      const f = fixture(data); await expect(f.port.list(wallet, { binding, filters: {}, take: 1 })).rejects.toThrow(/^history_unavailable$/); expect(f.from).not.toHaveBeenCalled();
    });
  it.each([{ ...run, id: "foreign" }, { ...run, asker: other }, { ...run, originalFulfillment: {} }, { ...run, askerFunded: true },
    { ...run, createdAt: "invalid" }, { ...run, answer: "x".repeat(4_000_000) }])("refuses original binding or eligibility defects", async original => {
      const f = fixture(packet({ item: { run: original, ownership: row.ownership } })); await expect(f.port.read(wallet, binding, "run")).rejects.toThrow(/^history_unavailable$/);
    });
  it("invalid input precedes RPC and backend errors cannot disclose bodies or cause fallback", async () => {
    const f = fixture(null); await expect(f.port.list(wallet, { binding, filters: {}, take: 52 })).rejects.toThrow(/^history_unavailable$/);
    await expect(f.port.read(wallet, binding, "invalid/path")).rejects.toThrow(/^history_unavailable$/); expect(f.rpc).not.toHaveBeenCalled();
    f.rpc.mockResolvedValue({ data: null, error: { message: "secret backend body" } }); await expect(f.port.read(wallet, binding, "run")).rejects.toThrow(/^history_unavailable$/);
    f.rpc.mockRejectedValue(new Error("secret transport body")); await expect(f.port.list(wallet, { binding, filters: {}, take: 1 })).rejects.toThrow(/^history_unavailable$/);
    expect(f.rpc).toHaveBeenCalledTimes(2); expect(f.from).not.toHaveBeenCalled();
  });
  it("refuses duplicate/out-of-order or out-of-filter rows even in a bounded backend response", async () => {
    for (const rows of [[row, row], [row, { ...row, id: "z" }], [row]]) {
      const f = fixture(packet({ rows }));
      await expect(f.port.list(wallet, { binding, filters: rows.length === 1 ? { funding: "browser-recorded" } : {}, take: 2 })).rejects.toThrow(/^history_unavailable$/);
    }
    const f = fixture(packet({ rows: [row] }));
    await expect(f.port.list(wallet, { binding, filters: {}, take: 2, before: { createdAt: date, id: "run" } })).rejects.toThrow(/^history_unavailable$/);
  });
  it("keeps default-off/native ports absent and ordinary assembly nonenumerable before I/O", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-no-authority");
    const http = vi.fn(() => { throw new Error("Network forbidden"); }); vi.stubGlobal("fetch", http);
    expect(new SupabaseAdapter().runOwnershipHistory).toBeUndefined(); vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true");
    const adapter = new SupabaseAdapter(); expect(adapter.runOwnershipHistory).toBeDefined(); expect(Object.keys(adapter)).not.toContain("runOwnershipHistory");
    expect(Object.getOwnPropertyNames(SupabaseAdapter.prototype)).not.toContain("runOwnershipHistory");
    const f = fixture(null), deployment = { format: "keryx-storage-deployment-v1", identity: syntheticStorageIdentity("testnet-offline"),
      backend: { kind: "supabase", url: "https://synthetic-db.example", projectRef: "synthetic-db", credentialEnv: "SUPABASE_SERVICE_ROLE_KEY" } } as unknown as StorageDeploymentManifest;
    const native = assembleAuthorityBoundSupabaseCore(f.client, deployment, () => deployment);
    expect(Object.hasOwn(native.adapter, "runOwnershipHistory")).toBe(false); expect(() => requireRunOwnershipHistory(native.adapter)).toThrow(/^history_unavailable$/);
    expect(f.rpc).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
  });
});

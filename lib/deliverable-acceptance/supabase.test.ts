import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { assembleAuthorityBoundSupabaseCore } from "../db/supabase-adapter";
import { syntheticStorageIdentity } from "../db/storage-identity-fixture";
import type { StorageDeploymentManifest } from "../db/runtime-storage-config";
import { createSupabaseDeliverableAcceptance } from "../db/deliverable-acceptance-supabase";
import { requireDeliverableAcceptance } from "./contracts";
it("actual enrolled Supabase core has no optional acceptance port and refuses before guard/RPC/REST writes", () => {
  const rpc = vi.fn(), from = vi.fn(), client = { rpc, from } as unknown as SupabaseClient;
  const deployment = { format: "keryx-storage-deployment-v1", identity: syntheticStorageIdentity("testnet-offline"),
    backend: { kind: "supabase", url: "https://synthetic-db.example", projectRef: "synthetic-db", credentialEnv: "SUPABASE_SERVICE_ROLE_KEY" } } as unknown as StorageDeploymentManifest;
  const read = vi.fn(() => deployment), core = assembleAuthorityBoundSupabaseCore(client, deployment, read); read.mockClear();
  expect(Object.hasOwn(core.adapter, "deliverableAcceptance")).toBe(false); expect(() => requireDeliverableAcceptance(core.adapter)).toThrow("acceptance_unavailable");
  expect(read).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
});
it.each([{ code: "PGRST202", message: "Missing domain PRIVATE diagnostic" }, { code: "P0001", message: "PRIVATE diagnostic" }])("missing/unknown ordinary RPC fails closed without REST/retry/private diagnostic %j", async error => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error }), from = vi.fn(), port = createSupabaseDeliverableAcceptance({ rpc, from } as unknown as SupabaseClient);
  await expect(port.read(`0x${"11".repeat(20)}`, "eip155:5042002", `a2a_${"1".repeat(64)}`)).rejects.toThrow("acceptance_unavailable");
  expect(rpc).toHaveBeenCalledTimes(1); expect(from).not.toHaveBeenCalled();
});

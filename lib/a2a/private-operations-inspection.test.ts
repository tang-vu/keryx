import { mkdtemp, readdir, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ balance: vi.fn() }));
vi.mock("../config", () => ({ config: { networkId: "eip155:5042002", cctpDomain: 26 } }));
vi.mock("../gateway/gateway-balance", () => ({ getGatewayAvailableAtomic: state.balance }));
import { privateWorkerConfigurationId } from "./private-worker-configuration";
import { privateWorkerStatusWriter } from "./private-worker-status";
import { inspectPrivateOperations } from "./private-operations-inspection";

it("composes real status files and backing observations, detects worker changes and omits private identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "keryx-private-inspection-"));
  const policy = { merchants: { privatePayee: `0x${"2".repeat(40)}`, publicResearchPayee: `0x${"3".repeat(40)}` },
    treasury: { signer: `0x${"4".repeat(40)}`, capacityMicros: "100000" }, serviceFeeMicros: "20000",
    disclosure: { modelId: "deepseek-flash", provider: "deepseek" as const, wireModel: "deepseek-v4-flash",
      endpoint: "https://synthetic.example/v1/chat/completions", fallback: "local-heuristic" as const, redirects: "prohibited" as const } };
  const db = { getPrivateTreasurySummary: vi.fn(async () => null) };
  const write = privateWorkerStatusWriter(root, "e508c1c", privateWorkerConfigurationId(policy));
  try {
    state.balance.mockResolvedValue(BigInt(100000));
    expect(await inspectPrivateOperations(db, policy, root, "e508c1c")).toMatchObject({ worker: { status: "unavailable" }, treasury: { status: "backed" }, checkoutReady: false });
    await write("idle");
    const report = await inspectPrivateOperations(db, policy, root, "e508c1c");
    expect(report).toMatchObject({ worker: { status: "matched", phase: "idle" }, treasury: { status: "backed", poolExists: false }, checkoutReady: false });
    for (const privateValue of [policy.treasury.signer, policy.merchants.privatePayee, policy.disclosure.endpoint])
      expect(JSON.stringify(report)).not.toContain(privateValue);
    state.balance.mockImplementationOnce(async () => { await write("working"); return BigInt(100000); });
    expect(await inspectPrivateOperations(db, policy, root, "e508c1c")).toMatchObject({ worker: { status: "changed", phase: "working" } });
    expect(await inspectPrivateOperations(db, policy, root, "abcdef1")).toMatchObject({ worker: { status: "mismatch" } });
    state.balance.mockResolvedValueOnce(null);
    expect(await inspectPrivateOperations(db, policy, root, "e508c1c")).toMatchObject({ treasury: { status: "balance-unavailable" } });
    const stop = new AbortController(); stop.abort(); db.getPrivateTreasurySummary.mockClear();
    expect(await inspectPrivateOperations(db, policy, root, "e508c1c", stop.signal)).toEqual({ status: "cancelled", checkoutReady: false });
    expect(db.getPrivateTreasurySummary).not.toHaveBeenCalled();
  } finally { for (const file of await readdir(root)) await unlink(join(root, file)); await rmdir(root); }
});

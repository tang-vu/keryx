import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, toBytes, type Log } from "viem";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { applyLogs, syncOnce } from "./indexer";
import { registryCheckpointKey, type SourceRegistryAuthority } from "../registry/source-registry-authority";
import type { Source } from "../types";
import type { KeryxDB } from "./keryx-db";
import { registryCollisionKey } from "../registry/registry-collisions";
import { auditRegistryParity } from "../registry/parity";
const m = vi.hoisted(() => ({ config: { registryOrigins: "", registryAddress: `0x${"33".repeat(20)}`,
  registryReadAddress: `0x${"33".repeat(20)}`, registryDeployBlock: "30", networkId: "eip155:5042", profile: undefined as unknown,
  rpcUrl: "https://synthetic.invalid" }, client: vi.fn(), read: vi.fn(), logs: vi.fn(), code: vi.fn(), chain: vi.fn() }));
vi.mock("../config", () => ({ config: m.config }));
vi.mock("../arc-rpc-attestation", () => ({ attestedArcAuthorityHttp: vi.fn(() => ({})), assertArcRpcChain: m.chain }));
vi.mock("../registry/registry-client", () => ({ REGISTRY_ABI: [], getRegistrySource: m.read }));
vi.mock("viem", async original => ({ ...await original<typeof import("viem")>(), createPublicClient: m.client }));
const legacy: SourceRegistryAuthority = { network: "eip155:5042", address: `0x${"44".repeat(20)}`, version: 1, codeHash: keccak256("0x6000"), deployBlock: "10" };
const current: SourceRegistryAuthority = { ...legacy, address: m.config.registryAddress as `0x${string}`, version: 3, codeHash: keccak256("0x6001"), deployBlock: "30" };
const id = `0x${"aa".repeat(32)}`, wallet = `0x${"11".repeat(20)}` as const;
const old: Source = { id: "legacy-slug", onchainId: id, name: "Original", description: "", url: "https://publisher.example", walletAddress: wallet,
  fetchPrice: 0.005, authors: [{ name: "Owner", walletAddress: wallet, splitWeight: 1 }], tags: [], createdAt: "2026-10-12", verified: true, registryAuthority: legacy };
const record = { creator: wallet, payoutWallet: wallet, authors: [{ wallet, basisPoints: 10000 }], fetchPriceUsdc6: BigInt(5000), contentCid: "", tags: "", active: true };
const event = (address: string, eventName = "SourceUpdated") => ({ address, eventName, args: { id } }) as unknown as Log;
function dbFixture() {
  const rows = new Map([[old.id, { ...old }]]), state = new Map([["lastSyncedBlock", "90"]]);
  const db = { getSource: vi.fn(async (key: string) => rows.get(key) ?? null),
    getSourceByOnchainId: vi.fn(async (key: string) => [...rows.values()].find(row => row.onchainId === key) ?? null), getSourceMeta: vi.fn(async () => null),
    upsertSource: vi.fn(async (source: Source) => { rows.set(source.id, source); }),
    getSyncState: vi.fn(async (key: string) => state.get(key) ?? null), setSyncState: vi.fn(async (key: string, value: string) => { state.set(key, value); }) };
  return { db: db as unknown as KeryxDB, rows, state, write: db.upsertSource };
}
beforeEach(() => {
  vi.clearAllMocks(); m.config.profile = ARC_MAINNET_PROFILE; m.config.registryOrigins = JSON.stringify([current, legacy]);
  vi.stubEnv("KERYX_REGISTRY_ORIGINS", m.config.registryOrigins); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS", m.config.registryOrigins);
  m.client.mockReturnValue({ getCode: m.code, readContract: vi.fn(async () => 3), getBlockNumber: vi.fn(async () => BigInt(100)), getLogs: m.logs });
  m.code.mockImplementation(async ({ address }: { address: string }) => address === legacy.address ? "0x6000" : "0x6001");
  m.read.mockResolvedValue(record); m.logs.mockResolvedValue([]); m.chain.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
it("updates old V1 in place and quarantines colliding V3 events and delists without changing old authority", async () => {
  const f = dbFixture();
  await applyLogs([event(legacy.address)], f.db, legacy);
  expect(f.rows.get(old.id)).toMatchObject({ id: old.id, registryAuthority: legacy, walletAddress: wallet, fetchPrice: 0.005 });
  expect([...f.rows.keys()]).toEqual([old.id]);
  expect(m.read).toHaveBeenCalledWith(id, { authority: legacy });
  await applyLogs([event(current.address)], f.db, current);
  await applyLogs([event(current.address, "SourceDeactivated")], f.db, current);
  expect(JSON.parse(f.state.get(registryCollisionKey(current, id))!)).toMatchObject({ status: "withheld", sourceId: old.id, observedOrigin: current, retainedOrigin: legacy });
  expect(f.write).toHaveBeenCalledTimes(1);
  expect(f.rows.get(old.id)?.active).toBe(true);
});
it("bootstraps the historical cursor only into V1 and begins V3 from its deployment block", async () => {
  const f = dbFixture(); await syncOnce(f.db);
  expect(m.logs).toHaveBeenCalledWith(expect.objectContaining({ address: current.address, fromBlock: BigInt(30), toBlock: BigInt(100) }));
  expect(m.logs).toHaveBeenCalledWith(expect.objectContaining({ address: legacy.address, fromBlock: BigInt(91), toBlock: BigInt(100) }));
  expect(f.state.get(registryCheckpointKey(current))).toBe("100");
  expect(f.state.get(registryCheckpointKey(legacy))).toBe("100");
  expect(f.state.get("lastSyncedBlock")).toBe("90");
});
it("quarantines one V3 collision, indexes the next valid source and truthfully audits both chain records", async () => {
  const f = dbFixture(), goodId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [wallet as `0x${string}`, keccak256(toBytes("https://conzit.com"))]));
  f.db.getSourceMeta = vi.fn(async key => key === goodId ? { name: "Conzit", description: "Synthetic registration fixture", url: "https://conzit.com", registryAuthority: current } : null);
  const goodEvent = { ...event(current.address, "SourceRegistered"), args: { id: goodId } } as unknown as Log;
  m.logs.mockImplementation(async ({ address }: { address: string }) => address === current.address ? [event(current.address), goodEvent] : []);
  await syncOnce(f.db);
  expect(f.state.get(registryCheckpointKey(current))).toBe("100");
  expect(f.state.get(registryCheckpointKey(legacy))).toBe("100");
  expect(f.rows.get(old.id)).toEqual(old);
  expect(f.rows.get(goodId)).toMatchObject({ name: "Conzit", registryAuthority: current, walletAddress: wallet, fetchPrice: 0.005, verified: false });
  const report = await auditRegistryParity(f.db, { authority: current, headBlock: async () => BigInt(100), sourceCount: async () => BigInt(2),
    sourceIdAt: async index => (index === BigInt(0) ? id : goodId) as `0x${string}`, get: async () => record });
  expect(report).toMatchObject({ chainCount: 2, comparedCount: 2, issues: [{ field: "withheldCollision", rowId: old.id }], lastSyncedBlock: "100" });
});
it("failed collision persistence retains the cursor and never overwrites the V1 row", async () => {
  const f = dbFixture(); m.logs.mockImplementation(async ({ address }: { address: string }) => address === current.address ? [event(current.address)] : []);
  f.db.setSyncState = vi.fn(async (key, value) => { if (key.includes("registry-collision")) throw new Error("storage refused"); f.state.set(key, value); });
  await expect(syncOnce(f.db)).rejects.toThrow("storage refused");
  expect(f.state.has(registryCheckpointKey(current))).toBe(false);
  expect(f.rows.get(old.id)).toEqual(old); expect(f.write).not.toHaveBeenCalled();
});

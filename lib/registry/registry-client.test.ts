import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionData, getAddress } from "viem";
const m = vi.hoisted(() => ({ read: vi.fn(), client: vi.fn(), transport: vi.fn(),
  registry: `0x${"d".repeat(40)}` as `0x${string}` }));
vi.mock("viem", async importOriginal => ({ ...await importOriginal<typeof import("viem")>(),
  createPublicClient: m.client }));
vi.mock("../arc-rpc-attestation", () => ({ attestedArcAuthorityHttp: m.transport }));
vi.mock("../config", async () => ({ config: { profile: (await import("../arc-network-profile")).ARC_TESTNET_PROFILE,
  registryReadAddress: m.registry, registryAddress: m.registry, rpcUrl: "https://rpc.synthetic.invalid" } }));
import { buildDeactivateArgs, buildRegisterArgs, buildUpdateArgs, getRegistrySource } from "./registry-client";
import { REGISTRY_ABI, REVISIONED_REGISTRY_ABI } from "./registry-abi";

const id = `0x${"1".repeat(64)}` as const, creator = `0x${"a".repeat(40)}` as const;
const record = { creator, payoutWallet: creator, authors: [{ wallet: creator, basisPoints: 10000 }],
  fetchPriceUsdc6: BigInt(2000), contentCid: "cid", tags: "research", active: true };
const version = (value: string) => {
  vi.stubEnv("KERYX_REGISTRY_VERSION", value); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_VERSION", value);
};
beforeEach(() => {
  vi.clearAllMocks(); version("1"); m.client.mockReturnValue({ readContract: m.read });
  m.transport.mockReturnValue({}); m.read.mockResolvedValue(record);
});
afterEach(() => vi.unstubAllEnvs());

it("preserves the V1 get call and direct registration wire shape", async () => {
  expect(await getRegistrySource(id)).toEqual(record);
  expect(m.read).toHaveBeenCalledExactlyOnceWith({ address: m.registry, abi: REGISTRY_ABI, functionName: "get", args: [id] });
  const registration = buildRegisterArgs({ urlHash: id, ...record });
  const decoded = decodeFunctionData({ abi: REGISTRY_ABI, data: encodeFunctionData(registration) });
  expect(decoded.functionName).toBe("register"); expect(decoded.args).toHaveLength(6);
});

it.each(["2", "3"])("reads record and revision atomically for explicit V%s", async configuredVersion => {
  version(configuredVersion); m.read.mockResolvedValue([record, BigInt(7)]);
  expect(await getRegistrySource(id)).toEqual({ ...record, registryVersion: Number(configuredVersion), revision: BigInt(7) });
  expect(m.read).toHaveBeenCalledExactlyOnceWith({ address: m.registry, abi: REVISIONED_REGISTRY_ABI, functionName: "getWithRevision", args: [id] });
});

it("propagates V3 RPC failure without trying a legacy selector", async () => {
  version("3"); m.read.mockRejectedValue(new Error("synthetic outage"));
  await expect(getRegistrySource(id)).rejects.toThrow("synthetic outage");
  expect(m.read).toHaveBeenCalledTimes(1); expect(m.read.mock.calls[0][0].functionName).toBe("getWithRevision");
});

it("refuses mismatched version configuration before any RPC", async () => {
  version("3"); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_VERSION", "2");
  await expect(getRegistrySource(id)).rejects.toThrow("versions differ");
  expect(m.client).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled();
});

it("returns no authority for an absent V3 record", async () => {
  version("3"); m.read.mockResolvedValue([{ ...record, creator: `0x${"0".repeat(40)}` }, BigInt(0)]);
  expect(await getRegistrySource(id)).toBeNull();
});

it.each(["2", "3"])("binds full edits and delists to the reviewed V%s revision", configuredVersion => {
  version(configuredVersion);
  const update = buildUpdateArgs({ id, ...record, expectedRevision: BigInt(7) });
  if (update.args.length !== 7) throw new Error("Expected revisioned full update");
  const decoded = decodeFunctionData({ abi: REVISIONED_REGISTRY_ABI, data: encodeFunctionData({
    abi: REVISIONED_REGISTRY_ABI, functionName: "update", args: update.args,
  }) });
  expect(decoded.functionName).toBe("update"); expect(decoded.args?.slice(0, 3)).toEqual([id, BigInt(7), getAddress(creator)]);
  expect(decoded.args).toHaveLength(7);
  const delist = buildDeactivateArgs(id, BigInt(7));
  if (delist.args.length !== 2) throw new Error("Expected revisioned delist");
  expect(decodeFunctionData({ abi: REVISIONED_REGISTRY_ABI, data: encodeFunctionData({
    abi: REVISIONED_REGISTRY_ABI, functionName: "deactivate", args: delist.args,
  }) }).args).toEqual([id, BigInt(7)]);
});

it("refuses V3 mutation encoding without a positive bounded revision", () => {
  version("3");
  for (const expectedRevision of [undefined, BigInt(0), BigInt(-1), BigInt("18446744073709551616")]) {
    expect(() => buildUpdateArgs({ id, ...record, expectedRevision })).toThrow("Refresh the registry revision");
    expect(() => buildDeactivateArgs(id, expectedRevision)).toThrow("Refresh the registry revision");
  }
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { sourceId, getRegistrySource, buildUpdateArgs, buildDeactivateArgs } from "./registry-client";
import { sourceFetchTerms } from "./source-fetch-payto";
import { assertListingRegistryOrigin, configuredRegistrationRegistryAuthority, sourceRegistryAuthorityForSource, type SourceRegistryAuthority } from "./source-registry-authority";
import { resetPayToCache } from "./payto-guard";
import { GET as listingGet } from "../../app/api/creator/[id]/listing/route";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ config: { registryOrigins: "", registryAddress: `0x${"33".repeat(20)}`,
  registryReadAddress: `0x${"33".repeat(20)}`, registryDeployBlock: "30", networkId: "eip155:5042", profile: undefined as unknown,
  rpcUrl: "https://synthetic.invalid" }, client: vi.fn(), read: vi.fn(), code: vi.fn(), source: vi.fn() }));
vi.mock("../config", () => ({ config: m.config }));
vi.mock("../db", () => ({ getDb: async () => ({ getSource: m.source }) }));
vi.mock("../auth", () => ({ getSession: async () => ({ address: `0x${"11".repeat(20)}` }) }));
vi.mock("../arc-rpc-attestation", () => ({ attestedArcAuthorityHttp: vi.fn(() => ({})) }));
vi.mock("viem", async original => ({ ...await original<typeof import("viem")>(), createPublicClient: m.client }));
const creator = `0x${"11".repeat(20)}` as const, payout = `0x${"22".repeat(20)}` as const;
const legacy: SourceRegistryAuthority = { network: "eip155:5042", address: `0x${"44".repeat(20)}`, version: 1, codeHash: keccak256("0x6000"), deployBlock: "10" };
const current: SourceRegistryAuthority = { ...legacy, address: m.config.registryAddress as `0x${string}`, version: 3, codeHash: keccak256("0x6001"), deployBlock: "30" };
const url = "https://publisher.example/feed", id = sourceId(creator, url);
const record = { creator, payoutWallet: payout, authors: [{ wallet: payout, basisPoints: 10000 }], fetchPriceUsdc6: BigInt(5000), contentCid: "", tags: "news", active: true };
const source = { id, onchainId: id, name: "Publisher", description: "", url, walletAddress: payout, fetchPrice: 0.005,
  authors: [{ name: "Owner", walletAddress: payout, splitWeight: 1 }], tags: [], createdAt: "2026-10-12", registryAuthority: legacy };
beforeEach(() => {
  vi.clearAllMocks(); resetPayToCache(); m.config.profile = ARC_MAINNET_PROFILE;
  m.config.registryOrigins = JSON.stringify([legacy, current]);
  vi.stubEnv("KERYX_REGISTRY_ORIGINS", m.config.registryOrigins); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS", m.config.registryOrigins);
  vi.stubEnv("KERYX_REGISTRY_VERSION", "3"); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_VERSION", "3");
  m.client.mockReturnValue({ readContract: m.read, getCode: m.code });
  m.code.mockImplementation(async ({ address }: { address: string }) => address === legacy.address ? "0x6000" : "0x6001");
  m.read.mockImplementation(async ({ functionName }: { functionName: string }) => functionName === "registryVersion" ? 3 : functionName === "getWithRevision" ? [record, BigInt(1)] : record);
  m.source.mockResolvedValue(source);
});
afterEach(() => { vi.unstubAllEnvs(); resetPayToCache(); });
it("keeps the old V1 creator, payee and price while global new registration selects V3", async () => {
  expect(configuredRegistrationRegistryAuthority()).toEqual(current);
  expect(await sourceFetchTerms(source)).toMatchObject({ payTo: payout, creator, listPriceUsdc: 0.005, authority: "onchain", stale: false });
  expect(m.read).toHaveBeenCalledWith(expect.objectContaining({ address: legacy.address, functionName: "get" }));
  expect(m.read.mock.calls.every(([request]) => request.address === legacy.address)).toBe(true);
  expect(() => assertListingRegistryOrigin(legacy.address, 1)).not.toThrow();
  expect(() => assertListingRegistryOrigin(legacy.address, 3)).toThrow();
  expect(buildUpdateArgs({ id, ...record, registryAuthority: legacy })).toMatchObject({ address: legacy.address, functionName: "update", args: [id, payout, record.authors, BigInt(5000), "", "news"] });
  expect(buildDeactivateArgs(id, undefined, legacy)).toMatchObject({ address: legacy.address, functionName: "deactivate", args: [id] });
  expect(() => buildUpdateArgs({ id, ...record })).toThrow("original source registry origin");
});
it("requires exact origin code, version, network and deployment block before any payment read", async () => {
  for (const authority of [{ ...legacy, address: current.address }, { ...legacy, codeHash: current.codeHash },
    { ...legacy, version: 3 as const }, { ...legacy, deployBlock: "11" }, { ...legacy, network: "eip155:5042002" as const }])
    await expect(sourceFetchTerms({ ...source, registryAuthority: authority })).rejects.toThrow();
  expect(m.client).not.toHaveBeenCalled();
  await expect(sourceFetchTerms({ ...source, registryAuthority: undefined })).rejects.toThrow("immutable original registry binding");
  expect(m.client).not.toHaveBeenCalled();
});
it("reads new V3 against its exact reviewed code and atomic revision", async () => {
  expect(await getRegistrySource(id, { authority: current })).toMatchObject({ registryVersion: 3, revision: BigInt(1) });
  expect(m.code).toHaveBeenCalledWith({ address: current.address });
  expect(m.read).toHaveBeenCalledWith(expect.objectContaining({ address: current.address, functionName: "getWithRevision" }));
  m.code.mockResolvedValue("0x6002");
  await expect(getRegistrySource(id, { authority: current })).rejects.toThrow("code or version differs");
});
it("refuses missing or mismatched browser/server origin pins", () => {
  vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS", undefined);
  expect(() => sourceRegistryAuthorityForSource(source)).toThrow("origins differ");
  vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS", JSON.stringify([legacy]));
  expect(() => sourceRegistryAuthorityForSource(source)).toThrow("origins differ");
});
it("returns exact legacy V1 creator edit authority after global V3 registration selection", async () => {
  const response = await listingGet(new NextRequest("https://keryx.example/api/creator/legacy/listing"), { params: Promise.resolve({ id: source.id }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ registryAddress: legacy.address, registryVersion: 1, registryAuthority: legacy,
    creator, fetchPrice: 0.005, current: { payoutWallet: payout, fetchPriceUsdc6: "5000" } });
});

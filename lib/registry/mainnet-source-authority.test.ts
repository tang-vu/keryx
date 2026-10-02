import { beforeEach, expect, it, vi } from "vitest";
import type { Source } from "../types";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../config", async () => ({ config: { profile: (await import("../arc-network-profile")).ARC_MAINNET_PROFILE,
  registryReadAddress: `0x${"55".repeat(20)}` } }));
vi.mock("./registry-client", async importOriginal => ({ ...await importOriginal<typeof import("./registry-client")>(), getRegistrySource: mocks.read }));
import { sourceId } from "./registry-client";
import { resetPayToCache } from "./payto-guard";
import { sourceFetchTerms } from "./source-fetch-payto";
const creator = `0x${"11".repeat(20)}` as const, payout = `0x${"22".repeat(20)}`;
const source: Source = { id: "one", name: "Source", url: "https://source.example/feed", description: "Source", walletAddress: `0x${"33".repeat(20)}`,
  fetchPrice: 0.1, tags: [], authors: [], createdAt: "2026-10-02T00:00:00.000Z", onchainId: sourceId(creator, "https://source.example/feed") };
const record = { creator, payoutWallet: payout, authors: [{ wallet: creator, basisPoints: 10000 }], fetchPriceUsdc6: BigInt(2000), active: true };
beforeEach(() => { mocks.read.mockReset(); resetPayToCache(); });
it("uses fresh chain-attested creator-owned terms and never serves the prior mainnet payout on outage", async () => {
  mocks.read.mockResolvedValue(record);
  expect(await sourceFetchTerms(source)).toMatchObject({ payTo: payout, listPriceUsdc: 0.002, authority: "onchain", stale: false });
  const rotated = `0x${"44".repeat(20)}`;
  mocks.read.mockResolvedValue({ ...record, payoutWallet: rotated });
  expect((await sourceFetchTerms(source)).payTo).toBe(rotated);
  expect(mocks.read).toHaveBeenCalledTimes(2);
  mocks.read.mockRejectedValue(new Error("Provider details must not grant fallback authority"));
  await expect(sourceFetchTerms(source)).rejects.toThrow("Mainnet on-chain payout authority is unavailable");
});
it("refuses absent, inactive and foreign creator/source identities rather than cached database payout rows", async () => {
  await expect(sourceFetchTerms({ ...source, onchainId: undefined })).rejects.toThrow();
  mocks.read.mockResolvedValue(null); await expect(sourceFetchTerms(source)).rejects.toThrow();
  mocks.read.mockResolvedValue({ ...record, active: false }); await expect(sourceFetchTerms(source)).rejects.toThrow();
  mocks.read.mockResolvedValue(record); await expect(sourceFetchTerms({ ...source, url: "https://foreign.example/feed" })).rejects.toThrow();
});

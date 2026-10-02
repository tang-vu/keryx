import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toHex } from "viem";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("KERYX_NETWORK", "arcTestnet");
  vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arcTestnet");
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubEnv("KERYX_RPC_URL", "https://synthetic-testnet.example.test");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("reads an explicitly retained mainnet balance on its original static RPC and checks the chain after the read", async () => {
  const { ARC_MAINNET_PROFILE } = await import("../arc-network-profile");
  const { getOnchainUsdcBalances } = await import("./onchain-usdc-balance");
  let chain = 5042;
  const methods: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const request = url instanceof Request ? url : new Request(url, init);
    expect(request.url).toBe(ARC_MAINNET_PROFILE.rpcUrl + "/");
    const packet = JSON.parse(await request.text()) as { id: number; method: string; params?: { to: string }[] };
    methods.push(packet.method);
    if (packet.method === "eth_call") {
      expect(packet.params?.[0].to.toLowerCase()).toBe(ARC_MAINNET_PROFILE.usdcAddress.toLowerCase());
      chain = 5042002;
    }
    return Response.json({ jsonrpc: "2.0", id: packet.id,
      result: packet.method === "eth_chainId" ? toHex(chain) : toHex(BigInt(1234567), { size: 32 }) });
  }));
  const address = `0x${"11".repeat(20)}`;
  expect((await getOnchainUsdcBalances([address], ARC_MAINNET_PROFILE)).get(address)).toBeNull();
  expect(methods).toEqual(["eth_chainId", "eth_call", "eth_chainId"]);
});

it("preserves original testnet RPC behavior and unknown balances instead of fabricating zero or lossy money", async () => {
  const { getOnchainUsdcBalances } = await import("./onchain-usdc-balance");
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const request = url instanceof Request ? url : new Request(url, init);
    expect(request.url).toBe("https://synthetic-testnet.example.test/");
    const packet = JSON.parse(await request.text()) as { id: number; method: string };
    if (packet.method === "eth_chainId") return Response.json({ jsonrpc: "2.0", id: packet.id, result: "0x4cef52" });
    const raw = ++reads === 1 ? BigInt(1234567) : BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1);
    return Response.json({ jsonrpc: "2.0", id: packet.id, result: toHex(raw, { size: 32 }) });
  }));
  const a = `0x${"11".repeat(20)}`, b = `0x${"22".repeat(20)}`;
  expect(await getOnchainUsdcBalances([a, a.toUpperCase(), b])).toEqual(new Map([[a, 1.234567], [b, null]]));
  expect(reads).toBe(2);
});

it("refuses a cloned profile before transport", async () => {
  const { ARC_MAINNET_PROFILE } = await import("../arc-network-profile");
  const { getOnchainUsdcBalances } = await import("./onchain-usdc-balance");
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(getOnchainUsdcBalances([], { ...ARC_MAINNET_PROFILE })).rejects.toThrow("Untrusted payout read profile");
  expect(fetcher).not.toHaveBeenCalled();
});

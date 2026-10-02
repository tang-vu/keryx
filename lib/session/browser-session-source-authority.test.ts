import { afterEach, expect, it, vi } from "vitest";
import { encodeFunctionResult, type Hex } from "viem";
import { REGISTRY_ABI } from "../registry/registry-abi";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it.each([6, 20, 21])("enforces the ordinary contract author bound for %s authors", async count => {
  vi.resetModules(); vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  const registry = `0x${"33".repeat(20)}`, payout = `0x${"44".repeat(20)}` as Hex;
  vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", registry); vi.stubEnv("KERYX_REGISTRY_ADDRESS", registry);
  vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS", undefined);
  const authors = Array.from({ length: count }, (_, index) => ({ wallet: `0x${(index+100).toString(16).padStart(40,"0")}` as Hex,
    basisPoints: index === count-1 ? 10000-Math.floor(10000/count)*(count-1) : Math.floor(10000/count) }));
  const result = encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "get", result: { creator: payout, payoutWallet: payout,
    authors, fetchPriceUsdc6: BigInt(1000), active: true, contentCid: "", tags: "" } });
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const req = JSON.parse(String(init.body)) as { method: string; id: number };
    return Response.json({ jsonrpc: "2.0", id: req.id, result: req.method === "eth_chainId" ? "0x13b2" : req.method === "eth_call" ? result
      : { number: "0x64", hash: `0x${"66".repeat(32)}`, timestamp: "0x64", transactions: [], gasLimit: "0x100000", gasUsed: "0x0" } });
  });
  const { readBrowserMainnetSource } = await import("./browser-session-source-authority");
  const operation = readBrowserMainnetSource(`0x${"55".repeat(32)}`);
  if (count > 20) await expect(operation).rejects.toThrow("Mainnet source authority unavailable");
  else { const authority = await operation; expect(authority.wallets.size).toBe(count+1); expect(authority.active).toBe(true); }
});

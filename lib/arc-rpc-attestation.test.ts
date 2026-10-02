import { afterEach, describe, expect, it, vi } from "vitest";
import { custom } from "viem";
import { arcTestnet } from "./chains";
import { assertArcRpcChain, attestedArcTransport } from "./arc-rpc-attestation";
import { ARC_MAINNET_PROFILE } from "./arc-network-profile";

afterEach(() => vi.unstubAllGlobals());

describe("Arc RPC attestation", () => {
  it("attests the independently captured mainnet profile before and after reads and rejects direct foreign chain responses", async () => {
    let chain = 5042;
    const methods: string[] = [];
    const transport = attestedArcTransport(custom({ request: async ({ method }) => {
      methods.push(method);
      if (method === "eth_chainId") return `0x${chain.toString(16)}`;
      if (method === "eth_call") { chain = 5042002; return "0xdead"; }
      throw new Error("Unexpected synthetic method");
    } }), true, ARC_MAINNET_PROFILE)({ chain: arcTestnet });
    await expect(transport.request({ method: "eth_chainId" })).resolves.toBe("0x13b2");
    await expect(transport.request({ method: "eth_call", params: [{ to: `0x${"11".repeat(20)}`, data: "0x" }, "latest"] })).rejects.toThrow("Arc mainnet");
    await expect(transport.request({ method: "eth_chainId" })).rejects.toThrow("Arc mainnet");
    expect(methods).toEqual(["eth_chainId", "eth_chainId", "eth_call", "eth_chainId", "eth_chainId"]);
  });
  it("checks again before every operation and blocks a write after the endpoint changes", async () => {
    let chain: number = arcTestnet.id;
    const methods: string[] = [];
    const transport = attestedArcTransport(custom({
      request: async ({ method }) => {
        methods.push(method);
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "eth_blockNumber") return "0x1";
        if (method === "eth_sendRawTransaction") return "0xdead";
        throw new Error(`unexpected ${method}`);
      },
    }))({ chain: arcTestnet });

    await expect(transport.request({ method: "eth_blockNumber" })).resolves.toBe("0x1");
    chain = 5042;
    await expect(transport.request({ method: "eth_sendRawTransaction", params: ["0x00"] }))
      .rejects.toThrow("does not match Arc testnet");
    expect(methods).toEqual(["eth_chainId", "eth_blockNumber", "eth_chainId"]);
  });

  it("rejects a registry read whose response arrives after a chain switch", async () => {
    let chain: number = arcTestnet.id;
    const methods: string[] = [];
    const transport = attestedArcTransport(custom({ request: async ({ method }) => {
      methods.push(method);
      if (method === "eth_chainId") return `0x${chain.toString(16)}`;
      if (method === "eth_call") { chain = 5042; return "0xdead"; }
      throw new Error(`unexpected ${method}`);
    } }), true)({ chain: arcTestnet });
    await expect(transport.request({ method: "eth_call", params: [{ to: "0x1111111111111111111111111111111111111111", data: "0x" }, "latest"] }))
      .rejects.toThrow("does not match Arc testnet");
    expect(methods).toEqual(["eth_chainId", "eth_call", "eth_chainId"]);
  });

  it("accepts a tokenized custom HTTP host by its live chain ID", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number; method: string };
      expect(body.method).toBe("eth_chainId");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x4cef52" }), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(assertArcRpcChain("https://custom-rpc.example.test/v1?token=secret")).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toContain("custom-rpc.example.test/v1?token=secret");
  });

  it("fails a pre-signing RPC outage after one attempt", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    await expect(assertArcRpcChain("https://custom-rpc.example.test/v1?token=secret")).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from "vitest";
import { ARC_MAINNET_REFERENCE as ref, GATEWAY_INFO_ENDPOINT, PUBLIC_RPC_ENDPOINTS,
  READ_ONLY_RPC_METHODS, inspectGatewayMetadata, probeArcMainnet, readOnlyRpc } from "./arc-mainnet-probe";

const head = { number: "0x100", hash: `0x${"12".repeat(32)}`, parentHash: `0x${"34".repeat(32)}`, timestamp: "0x123" };
function metadata() { return { version: 1, domains: [{ chain: "Arc", network: "Mainnet", domain: 26,
  walletContract: { address: ref.wallet, supportedTokens: ["USDC"] },
  minterContract: { address: ref.minter, supportedTokens: ["USDC"] }, processedHeight: "256", burnIntentExpirationHeight: "1000" }] }; }
function transport(change?: (method: string, value: unknown, endpoint: string) => unknown) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const endpoint = String(input);
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    expect(init?.signal).toBeDefined();
    if (endpoint === GATEWAY_INFO_ENDPOINT) return Response.json(metadata());
    expect(PUBLIC_RPC_ENDPOINTS).toContain(endpoint);
    const request = JSON.parse(init!.body as string);
    expect(READ_ONLY_RPC_METHODS).toContain(request.method);
    const value = request.method === "eth_chainId" ? ref.chainId : request.method === "eth_getBlockByNumber" ? head :
      request.method === "eth_getCode" ? "0x6001600055" : `0x${"0".repeat(63)}6`;
    return Response.json({ jsonrpc: "2.0", id: 1, result: change ? change(request.method, value, endpoint) : value });
  });
}
describe("Arc public read-only evidence", () => {
  it("pins contracts and decimals to consistent block evidence, never declares readiness", async () => {
    const fetcher = transport();
    const report = await probeArcMainnet(fetcher);
    expect(report.externalEvidenceComplete).toBe(true);
    expect(report.mainnetReady).toBe(false);
    expect(report.gate).toBe("M1_PARTIAL");
    expect(report.rpc[0].evidence?.contracts[0]).toMatchObject({ bytes: 5, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    for (const [, init] of fetcher.mock.calls.filter(([url]) => url !== GATEWAY_INFO_ENDPOINT)) {
      const request = JSON.parse(init!.body as string);
      if (["eth_getCode", "eth_call"].includes(request.method)) expect(request.params[1]).toBe(head.number);
    }
  });
  it.each([
    ["wrong-chain", "eth_chainId", "0x4cee52", "wrong_chain"],
    ["missing-code", "eth_getCode", "0x", "missing_or_malformed_code"],
    ["zero-code", "eth_getCode", "0x0000", "missing_or_malformed_code"],
    ["decimals", "eth_call", `0x${"0".repeat(62)}12`, "decimal_mismatch"],
    ["malformed-block", "eth_getBlockByNumber", { ...head, hash: "0x12" }, "malformed_block"],
  ])("fails closed on %s", async (_, method, replacement, reason) => {
    const fetcher = transport((name, value) => name === method ? replacement : value);
    const report = await probeArcMainnet(fetcher);
    expect(report.externalEvidenceComplete).toBe(false);
    expect(report.rpc.every(row => row.status === "unavailable" && row.reason === reason)).toBe(true);
    if (method === "eth_chainId") expect(fetcher.mock.calls).toHaveLength(5);
  });
  it("rejects contradictory provider hashes", async () => {
    const report = await probeArcMainnet(transport((method, value, endpoint) => method === "eth_getBlockByNumber" && endpoint === PUBLIC_RPC_ENDPOINTS[1]
      ? { ...head, hash: `0x${"56".repeat(32)}` } : value));
    expect(report.consistency).toMatchObject({ status: "unavailable", reason: "inconsistent_block" });
  });
  it("rejects a block changing during inspection", async () => {
    const counters = new Map<string, number>();
    const report = await probeArcMainnet(transport((method, value, endpoint) => {
      if (method !== "eth_getBlockByNumber") return value;
      const count = (counters.get(endpoint) ?? 0) + 1; counters.set(endpoint, count);
      return count === 1 ? value : { ...head, hash: `0x${"56".repeat(32)}` };
    }));
    expect(report.rpc[0]).toMatchObject({ status: "unavailable", reason: "inconsistent_block" });
  });
  it.each(["eth_sendRawTransaction", "eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "eth_estimateGas"])("refuses %s before transport", async method => {
    const fetcher = transport();
    await expect(readOnlyRpc(fetcher, PUBLIC_RPC_ENDPOINTS[0], method)).rejects.toThrow("rpc_method_refused");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses arbitrary endpoints and eth_call payloads", async () => {
    const fetcher = transport();
    await expect(readOnlyRpc(fetcher, "https://secret:credential@example.com", "eth_chainId")).rejects.toThrow("endpoint_refused");
    await expect(readOnlyRpc(fetcher, PUBLIC_RPC_ENDPOINTS[0], "eth_call", [{ to: ref.wallet, data: "0x" }, "latest"])).rejects.toThrow("rpc_params_refused");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([null, { version: 1, domains: {} }, { version: 2, domains: [] }])("rejects malformed Circle metadata", value => {
    expect(() => inspectGatewayMetadata(value)).toThrow();
  });
  it("rejects Circle domain, network, addresses and unsupported tokens", () => {
    for (const change of [{ domain: 27 }, { network: "Testnet" }, { chain: "Base" },
      { walletContract: { address: ref.usdc, supportedTokens: ["USDC"] } },
      { minterContract: { address: ref.minter, supportedTokens: [] } }]) {
      const value = metadata(); Object.assign(value.domains[0], change);
      expect(() => inspectGatewayMetadata(value)).toThrow();
    }
    const duplicate = metadata(); duplicate.domains.push(duplicate.domains[0]);
    expect(() => inspectGatewayMetadata(duplicate)).toThrow("missing_or_duplicate_arc_metadata");
  });
  it.each([302, 403, 500])("fails closed on HTTP %s without retry", async status => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("private upstream body", { status }));
    const report = await probeArcMainnet(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(report.rpc[0]).toMatchObject({ reason: "http_unavailable" });
    expect(JSON.stringify(report)).not.toContain("private upstream body");
  });
  it("redacts transport errors", async () => {
    const report = await probeArcMainnet(vi.fn<typeof fetch>(async () => { throw new Error("https://secret:password@example.com"); }));
    expect(report.rpc[0]).toMatchObject({ status: "unavailable", reason: "request_unavailable" });
    expect(JSON.stringify(report)).not.toContain("password");
  });
  it("bounds stalled transports independently of fetch honoring abort", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
      const pending = probeArcMainnet(fetcher);
      await vi.advanceTimersByTimeAsync(10_000);
      const report = await pending;
      expect(report.rpc[0]).toMatchObject({ status: "unavailable", reason: "timeout" });
      expect(fetcher).toHaveBeenCalledTimes(5);
    } finally { vi.useRealTimers(); }
  });
  it("bounds response bodies", async () => {
    const report = await probeArcMainnet(vi.fn<typeof fetch>(async () => new Response("x".repeat(256 * 1024 + 1))));
    expect(report.rpc[0]).toMatchObject({ reason: "response_too_large" });
  });
});

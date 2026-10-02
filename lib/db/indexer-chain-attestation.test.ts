import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { keccak256, stringToHex } from "viem";

const registry = "0x1111111111111111111111111111111111111111";
const sourceId = `0x${"a".repeat(64)}`;
const deactivatedTopic = keccak256(stringToHex("SourceDeactivated(bytes32)"));

vi.mock("@/lib/config", () => ({ config: {
  rpcUrl: "https://custom-rpc.example.test/v1?token=secret",
  registryAddress: "0x1111111111111111111111111111111111111111",
  registryDeployBlock: "0",
} }));
vi.mock("@/lib/registry/registry-client", () => ({
  REGISTRY_ABI: [{ type: "event", name: "SourceDeactivated", inputs: [{ name: "id", type: "bytes32", indexed: true }] }],
  getRegistrySource: vi.fn(),
}));

const { syncOnce } = await import("./indexer");

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

it.each([
  { failAtChainRead: 2, expectedMethods: ["eth_chainId", "eth_blockNumber", "eth_chainId"] },
  { failAtChainRead: 4, expectedMethods: ["eth_chainId", "eth_blockNumber", "eth_chainId", "eth_chainId", "eth_getLogs", "eth_chainId"] },
])("does not advance the cursor when the RPC changes chain at check $failAtChainRead", async ({ failAtChainRead, expectedMethods }) => {
  const methods: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    methods.push(body.method);
    const result = body.method === "eth_chainId"
      ? methods.filter(method => method === "eth_chainId").length < failAtChainRead ? "0x4cef52" : "0x13b2"
      : body.method === "eth_blockNumber" ? "0x1" : [{
        address: registry, blockHash: `0x${"b".repeat(64)}`, blockNumber: "0x1", data: "0x",
        logIndex: "0x0", removed: false, topics: [deactivatedTopic, sourceId],
        transactionHash: `0x${"c".repeat(64)}`, transactionIndex: "0x0",
      }];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      headers: { "content-type": "application/json" },
    });
  }));
  const db = { getSyncState: vi.fn().mockResolvedValue(null), setSyncState: vi.fn(),
    getSourceByOnchainId: vi.fn().mockResolvedValue({ id: "source", onchainId: sourceId, active: true }),
    getSource: vi.fn(), upsertSource: vi.fn() };
  await expect(syncOnce(db as never)).rejects.toThrow("does not match Arc testnet");
  expect(methods).toEqual(expectedMethods);
  expect(db.setSyncState).not.toHaveBeenCalled();
  expect(db.upsertSource).not.toHaveBeenCalled();
});

it("applies the same event when the endpoint stays on Arc testnet", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    const result = body.method === "eth_chainId" ? "0x4cef52"
      : body.method === "eth_blockNumber" ? "0x1" : [{
        address: registry, blockHash: `0x${"b".repeat(64)}`, blockNumber: "0x1", data: "0x",
        logIndex: "0x0", removed: false, topics: [deactivatedTopic, sourceId],
        transactionHash: `0x${"c".repeat(64)}`, transactionIndex: "0x0",
      }];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      headers: { "content-type": "application/json" },
    });
  }));
  const db = { getSyncState: vi.fn().mockResolvedValue(null), setSyncState: vi.fn(),
    getSourceByOnchainId: vi.fn().mockResolvedValue({ id: "source", onchainId: sourceId, active: true }),
    getSource: vi.fn(), upsertSource: vi.fn() };
  await syncOnce(db as never);
  expect(db.upsertSource).toHaveBeenCalledWith(expect.objectContaining({ id: "source", active: false }));
  expect(db.setSyncState).toHaveBeenCalledWith("lastSyncedBlock", "1");
});

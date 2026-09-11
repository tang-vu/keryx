import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ session: vi.fn(), db: vi.fn(), registry: vi.fn(), write: vi.fn(),
  config: { registryAddress: "", registryReadAddress: "" } }));
vi.mock("@/lib/auth", () => ({ getSession: m.session }));
vi.mock("@/lib/db", () => ({ getDb: m.db }));
vi.mock("@/lib/config", () => ({ config: m.config }));
vi.mock("@/lib/registry/registry-client", () => ({ getRegistrySource: m.registry }));
import { GET, POST } from "@/app/api/creator/[id]/listing/route";

const creator = `0x${"a".repeat(40)}`, payout = `0x${"b".repeat(40)}`, author = `0x${"c".repeat(40)}`;
const registry = `0x${"d".repeat(40)}`, onchainId = `0x${"1".repeat(64)}`;
const source = { id: "synthetic", walletAddress: payout, authors: [{ walletAddress: author, share: 1 }],
  onchainId, active: true, fetchPrice: 0.001 };
const record = { creator, payoutWallet: payout, authors: [{ wallet: author, basisPoints: 10000 }],
  fetchPriceUsdc6: BigInt(1200), active: true, contentCid: "synthetic-cid", tags: "research" };
const ctx = { params: Promise.resolve({ id: source.id }) };
const url = "https://keryx.cc/api/creator/synthetic/listing";
const get = () => GET(new NextRequest(url), ctx);
const post = () => POST(new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ fetchPrice: 0.002 }) }), ctx);
beforeEach(() => {
  vi.clearAllMocks();
  m.config.registryAddress = registry; m.config.registryReadAddress = registry;
  m.session.mockResolvedValue({ address: creator.toUpperCase() });
  m.db.mockResolvedValue({ getSource: async () => source, upsertSource: m.write });
  m.registry.mockResolvedValue(record);
});

it("lets the on-chain creator manage a separate payout wallet without trusting cached terms", async () => {
  const response = await get(); expect(response.status).toBe(200);
  expect(m.registry).toHaveBeenCalledWith(onchainId);
  expect(await response.json()).toMatchObject({ mode: "onchain", creator, fetchPrice: 0.0012,
    current: { payoutWallet: payout, authors: record.authors, fetchPriceUsdc6: "1200", contentCid: "synthetic-cid", tags: "research" } });
  expect(m.write).not.toHaveBeenCalled();
});

it.each([payout, author, `0x${"e".repeat(40)}`])("does not treat recipient %s as registry creator", async address => {
  m.session.mockResolvedValue({ address });
  expect((await get()).status).toBe(403);
  expect(m.write).not.toHaveBeenCalled();
});

it("denies anonymous requests before database or registry access", async () => {
  m.session.mockResolvedValue(null);
  expect((await get()).status).toBe(401); expect((await post()).status).toBe(401);
  expect(m.db).not.toHaveBeenCalled(); expect(m.registry).not.toHaveBeenCalled();
});

it("withholds management terms when the registry fails or has no record", async () => {
  m.registry.mockRejectedValueOnce(new Error("private-rpc-sentinel"));
  const failed = await get(); expect(failed.status).toBe(502);
  expect(await failed.text()).not.toContain("private-rpc-sentinel");
  m.registry.mockResolvedValueOnce(null); expect((await get()).status).toBe(409);
});

it.each(["", `0x${"f".repeat(40)}`])("refuses absent or mismatched write registry %s before reading", async address => {
  m.config.registryAddress = address;
  expect((await get()).status).toBe(409); expect(m.registry).not.toHaveBeenCalled();
});

it("never writes an on-chain listing through POST, including for its creator", async () => {
  expect((await post()).status).toBe(409); expect(m.write).not.toHaveBeenCalled();
});

it("preserves offline recipient ownership and rejects unrelated wallets", async () => {
  m.db.mockResolvedValue({ getSource: async () => ({ ...source, onchainId: undefined }), upsertSource: m.write });
  expect((await get()).status).toBe(403); expect((await post()).status).toBe(403);
  m.session.mockResolvedValue({ address: payout });
  expect((await get()).status).toBe(200); expect((await post()).status).toBe(200);
  expect(m.write).toHaveBeenCalledWith(expect.objectContaining({ fetchPrice: 0.002 }));
  expect(m.registry).not.toHaveBeenCalled();
});

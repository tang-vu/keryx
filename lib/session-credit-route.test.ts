import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ balance: vi.fn() }));
vi.mock("./gateway/gateway-balance", () => ({ getGatewayAvailableAtomic: mocks.balance }));
vi.mock("./config", () => ({ config: { networkId: "eip155:5042002" } }));
import { GET } from "../app/api/session/credit/route";
const address = `0x${"a".repeat(40)}`;
beforeEach(() => mocks.balance.mockReset());
describe("credit endpoint", () => {
  it.each(["", "0x", "0xgarbage"])("rejects malformed address without an upstream lookup: %s", async value => {
    const response = await GET(new NextRequest(`https://keryx.cc/api/session/credit?address=${value}`));
    expect(response.status).toBe(400); expect(mocks.balance).not.toHaveBeenCalled();
    expect((await response.json()).available).toBeNull();
  });
  it("returns non-cacheable unavailable rather than a zero balance", async () => {
    mocks.balance.mockResolvedValue(null);
    const response = await GET(new NextRequest(`https://keryx.cc/api/session/credit?address=${address}`));
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ address, network: "eip155:5042002", status: "unavailable", available: null });
  });
  it.each([BigInt(0), BigInt(50001)])("reports matching known funds without decimal rounding: %s", async funds => {
    mocks.balance.mockResolvedValue(funds);
    const response = await GET(new NextRequest(`https://keryx.cc/api/session/credit?address=${address}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ address, network: "eip155:5042002", status: "known", available: String(funds) });
  });
});

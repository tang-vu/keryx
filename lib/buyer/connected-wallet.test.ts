import { afterEach, describe, expect, it, vi } from "vitest";
import { createWalletClient, custom, type Hex } from "viem";
import { connectedBuyerWallet } from "./connected-wallet";
import { authorizationWithNonce, BUYER_GATEWAY, BUYER_USDC, type BuyerRequirement } from "./protocol";

const payer = `0x${"a".repeat(40)}` as Hex;
const other = `0x${"b".repeat(40)}` as Hex;
const requirement: BuyerRequirement = { scheme: "exact", network: "eip155:5042002", asset: BUYER_USDC, amount: "50000", payTo: other,
  maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
const authorization = authorizationWithNonce(payer, requirement, `0x${"1".repeat(64)}`);
afterEach(() => vi.restoreAllMocks());

function setup() {
  let selected = payer;
  let chain = "0x4cef52"; // 5042002
  const provider = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_accounts") return [selected];
    if (method === "eth_chainId") return chain;
    if (method === "eth_signTypedData_v4") return `0x${"1".repeat(130)}`;
    throw new Error("Unexpected wallet method");
  });
  const wallet = createWalletClient({ account: payer, transport: custom({ request: provider }, { retryCount: 0 }) });
  const http = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ status: "known", address: payer, network: "eip155:5042002", available: "50000" }));
  return { adapter: connectedBuyerWallet(wallet, payer), provider, http,
    changeAccount: () => { selected = other; }, changeChain: () => { chain = "0x1"; } };
}

describe("connected buyer wallet", () => {
  it("reads actual provider identity before and after the Gateway lookup", async () => {
    const { adapter, provider } = setup();
    expect(await adapter.readWallet()).toEqual({ address: payer, chainId: 5042002, gatewayBalanceMicros: "50000" });
    expect(provider.mock.calls.filter(([request]) => request.method === "eth_accounts")).toHaveLength(2);
    await adapter.sign(authorization);
    const signed = provider.mock.calls.find(([request]) => request.method === "eth_signTypedData_v4");
    expect(signed).toBeDefined();
  });
  it.each(["account", "chain"])("rejects %s changes even though wallet.account remains the original address", async kind => {
    const { adapter, http, provider, changeAccount, changeChain } = setup();
    if (kind === "account") changeAccount(); else changeChain();
    await expect(adapter.readWallet()).rejects.toThrow("reviewed wallet");
    await expect(adapter.sign(authorization)).rejects.toThrow("reviewed wallet");
    expect(http).not.toHaveBeenCalled();
    expect(provider.mock.calls.some(([request]) => request.method === "eth_signTypedData_v4")).toBe(false);
  });
  it("rejects a switch while the balance request is in flight", async () => {
    const { adapter, http, changeAccount } = setup();
    http.mockImplementationOnce(async () => { changeAccount(); return Response.json({ status: "known", address: payer, network: "eip155:5042002", available: "50000" }); });
    await expect(adapter.readWallet()).rejects.toThrow("reviewed wallet");
  });
  it("refuses an authorization for another payer", async () => {
    const { adapter, provider } = setup();
    await expect(adapter.sign({ ...authorization, from: other })).rejects.toThrow("Wrong buyer");
    expect(provider.mock.calls.some(([request]) => request.method === "eth_signTypedData_v4")).toBe(false);
  });
});

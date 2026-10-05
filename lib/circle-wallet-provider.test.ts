import { expect, it, vi } from "vitest";
import { parseTransaction, serializeTransaction, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createCircleWalletProvider } from "./circle-wallet-provider";
import { circleUnsignedTransaction, verifyCircleSignedTransaction } from "./circle-wallet-transaction";

const owner = privateKeyToAccount(`0x${"1".repeat(64)}`), other = privateKeyToAccount(`0x${"2".repeat(64)}`);
const transaction = { from: owner.address, to: `0x${"3".repeat(40)}`, chainId: "0x13b2", type: "0x2",
  data: "0x1234", value: "0x0", nonce: "0x2", gas: "0x186a0", maxFeePerGas: "0x64", maxPriorityFeePerGas: "0x1" };
const typed = { domain: { name: "Keryx", version: "1", chainId: 5042 }, primaryType: "Consent" as const,
  types: { Consent: [{ name: "amount", type: "uint256" }] }, message: { amount: "10000" } };
function provider() {
  const rpc = vi.fn(async (request: { method: string }) => request.method === "eth_chainId" ? "0x13b2" : `0x${"4".repeat(64)}`);
  const current = vi.fn();
  const sign = vi.fn(async (kind: string, payload: string) => {
    if (kind === "transaction") return owner.signTransaction(parseTransaction(payload as Hex) as Parameters<typeof owner.signTransaction>[0]);
    if (kind === "typedData") return owner.signTypedData(JSON.parse(payload));
    return owner.signMessage({ message: { raw: payload as Hex } });
  });
  return { rpc, sign, current, api: createCircleWalletProvider({ address: owner.address, chainId: 5042, rpc, sign, assertCurrent: current }) };
}
it("verifies the exact owner message and typed consent signatures independently", async () => {
  const { api, sign, rpc } = provider();
  const message = stringToHex("Synthetic Keryx wallet consent");
  expect(await api.request({ method: "personal_sign", params: [message, owner.address] })).toMatch(/^0x/);
  expect(await api.request({ method: "eth_signTypedData_v4", params: [owner.address, JSON.stringify(typed)] })).toMatch(/^0x/);
  expect(sign).toHaveBeenCalledTimes(2); expect(rpc).not.toHaveBeenCalled();
});
it("refuses another account, another chain and unrecognized signing methods before Circle", async () => {
  const { api, sign, rpc } = provider();
  await expect(api.request({ method: "personal_sign", params: ["0x1234", other.address] })).rejects.toThrow("account differs");
  await expect(api.request({ method: "eth_signTypedData_v4", params: [owner.address, JSON.stringify({ ...typed, domain: { ...typed.domain, chainId: 1 } })] })).rejects.toThrow("network differs");
  await expect(api.request({ method: "eth_sign", params: [owner.address, "0x1234"] })).rejects.toThrow("does not support");
  await expect(api.request({ method: "eth_sendRawTransaction", params: ["0x1234"] })).rejects.toThrow("does not support");
  expect(sign).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
it("checks the original raw transaction tuple and owner before one broadcast", async () => {
  const { api, rpc, sign } = provider();
  expect(await api.request({ method: "eth_sendTransaction", params: [transaction] })).toBe(`0x${"4".repeat(64)}`);
  expect(sign).toHaveBeenCalledTimes(1); expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc.mock.calls[1]).toEqual([{ method: "eth_sendRawTransaction", params: [expect.stringMatching(/^0x02/)] }]);
});
it.each([{ nonce: undefined }, { gas: undefined }, { maxFeePerGas: undefined }, { from: other.address }, { chainId: "0x1" },
  { maxPriorityFeePerGas: "0x65" }, { gas: "0x0" }, { nonce: "0xffffffffffffffff" }, { to: undefined }, { gasPrice: "0x1" }])(
  "refuses missing or changed bounded transaction terms before opening a wallet prompt", async mutation => {
    const { api, sign, rpc } = provider();
    await expect(api.request({ method: "eth_sendTransaction", params: [{ ...transaction, ...mutation }] })).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
it.each([{ nonce: 3 }, { gas: BigInt(100001) }, { maxFeePerGas: BigInt(101) }, { value: BigInt(1) },
  { to: other.address }, { data: "0x5678" }, { chainId: 1 }])("refuses vendor mutation of the reviewed tuple before broadcast", async mutation => {
  const { api, sign, rpc } = provider();
  sign.mockImplementationOnce(async (_kind, raw) => owner.signTransaction({ ...parseTransaction(raw as Hex), ...mutation } as Parameters<typeof owner.signTransaction>[0]));
  await expect(api.request({ method: "eth_sendTransaction", params: [transaction] })).rejects.toThrow();
  expect(rpc.mock.calls.filter(([request]) => request.method === "eth_sendRawTransaction")).toHaveLength(0);
});
it("refuses a correct-looking transaction signed by another wallet", async () => {
  const raw = circleUnsignedTransaction(transaction, owner.address, 5042);
  const signed = await other.signTransaction(parseTransaction(raw) as Parameters<typeof other.signTransaction>[0]);
  await expect(verifyCircleSignedTransaction(raw, signed, owner.address, 5042)).rejects.toThrow("differs");
});
it("does not broadcast after wallet identity changes during confirmation", async () => {
  const { api, sign, current, rpc } = provider();
  sign.mockImplementationOnce(async (_kind, raw) => {
    current.mockImplementation(() => { throw new Error("Synthetic wallet switch"); });
    return owner.signTransaction(parseTransaction(raw as Hex) as Parameters<typeof owner.signTransaction>[0]);
  });
  await expect(api.request({ method: "eth_sendTransaction", params: [transaction] })).rejects.toThrow("wallet switch");
  expect(rpc.mock.calls.filter(([request]) => request.method === "eth_sendRawTransaction")).toHaveLength(0);
});
it("does not retry a broadcast whose response is lost", async () => {
  const { api, rpc, sign } = provider(); rpc.mockImplementation(async request => {
    if (request.method === "eth_chainId") return "0x13b2"; throw new Error("Synthetic lost RPC response");
  });
  await expect(api.request({ method: "eth_sendTransaction", params: [transaction] })).rejects.toThrow("lost RPC");
  expect(rpc.mock.calls.filter(([request]) => request.method === "eth_sendRawTransaction")).toHaveLength(1); expect(sign).toHaveBeenCalledTimes(1);
});
it("raw signing preserves the reviewed tuple without broadcasting", async () => {
  const { api, rpc } = provider();
  expect(await api.request({ method: "eth_signTransaction", params: [transaction] })).toMatch(/^0x02/);
  expect(rpc.mock.calls.filter(([request]) => request.method === "eth_sendRawTransaction")).toHaveLength(0);
});
it("unsigned validation rejects already signed transactions", async () => {
  const { api } = provider(); const raw = await api.request({ method: "eth_signTransaction", params: [transaction] }) as Hex;
  expect(() => serializeTransaction(parseTransaction(raw) as Parameters<typeof serializeTransaction>[0])).not.toThrow();
  await expect(verifyCircleSignedTransaction(raw, raw, owner.address, 5042)).rejects.toThrow("Unsigned");
});
it("refuses a mismatched remote chain before Circle signing and sends zero transactions", async () => {
  const { api, rpc, sign } = provider(); rpc.mockResolvedValue("0x1");
  await expect(api.request({ method: "eth_chainId" })).rejects.toThrow("network differs");
  await expect(api.request({ method: "eth_sendTransaction", params: [transaction] })).rejects.toThrow("network differs");
  expect(sign).not.toHaveBeenCalled(); expect(rpc.mock.calls.filter(([request]) => request.method === "eth_sendRawTransaction")).toHaveLength(0);
});

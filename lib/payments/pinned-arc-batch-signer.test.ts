import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { createPinnedArcBatchSigner } from "./pinned-arc-batch-signer";
import type { PaymentRequirements } from "./x402-payment-evidence";
import type { TypedDataPayload } from "../session/session-signer-protocol";

const PAYEE = `0x${"22".repeat(20)}`;
const ATTACKER = `0x${"33".repeat(20)}`;
function requirement(): PaymentRequirements {
  return { scheme: "exact", network: "eip155:5042002", asset: config.usdcAddress, amount: "2000", payTo: PAYEE,
    maxTimeoutSeconds: config.maxTimeoutSeconds, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: config.gatewayWallet } };
}
function fixture(chain = "0x4cef52") {
  const original = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const sign = vi.fn(original.signTypedData.bind(original));
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { method: string; id: number };
    expect(request.method).toBe("eth_chainId");
    return Response.json({ jsonrpc: "2.0", id: request.id, result: chain });
  });
  vi.stubGlobal("fetch", fetcher);
  return { account: { ...original, signTypedData: sign as typeof original.signTypedData }, sign, fetcher };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("pinned Arc SDK payment signing callback", () => {
  it("validates and signs the actual installed SDK's testnet domain and original economic tuple", async () => {
    const f = fixture();
    const req = requirement();
    const result = await createPinnedArcBatchSigner(f.account, "https://synthetic.invalid").createPaymentPayload(2, req);
    expect(f.sign).toHaveBeenCalledOnce(); expect(f.fetcher).toHaveBeenCalledOnce();
    const typed = f.sign.mock.calls[0][0];
    expect(typed).toMatchObject({ domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042002, verifyingContract: config.gatewayWallet },
      primaryType: "TransferWithAuthorization", message: { from: f.account.address, to: PAYEE, value: BigInt(2000) } });
    const payload = result.payload as { signature: `0x${string}`; authorization: { value: string; to: string } };
    expect(payload.authorization).toMatchObject({ value: "2000", to: PAYEE });
    expect(await recoverTypedDataAddress({ ...typed, signature: payload.signature })).toBe(f.account.address);
  });

  it.each([
    ["wrong network", { network: "eip155:5042" }], ["wrong token", { asset: ATTACKER }],
    ["wrong Gateway", { extra: { ...requirement().extra, verifyingContract: ATTACKER } }],
  ] as const)("refuses %s before invoking the SDK signing callback", async (_name, changed) => {
    const f = fixture();
    await expect(createPinnedArcBatchSigner(f.account, "https://synthetic.invalid").createPaymentPayload(2, { ...requirement(), ...changed })).rejects.toThrow("local signing policy");
    expect(f.sign).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["SDK changed payee", { payTo: ATTACKER }], ["SDK inflated amount", { amount: "3000" }],
    ["SDK changed chain", { network: "eip155:5042" }],
    ["SDK changed verifying contract", { extra: { ...requirement().extra, verifyingContract: ATTACKER } }],
  ] as const)("refuses %s at the actual signer boundary", async (_name, changed) => {
    const f = fixture();
    const original = BatchEvmScheme.prototype.createPaymentPayload;
    vi.spyOn(BatchEvmScheme.prototype, "createPaymentPayload").mockImplementation(function(this: BatchEvmScheme, version, req) {
      return original.call(this, version, { ...req, ...changed });
    });
    await expect(createPinnedArcBatchSigner(f.account, "https://synthetic.invalid").createPaymentPayload(2, requirement())).rejects.toThrow("local signing policy");
    expect(f.sign).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("refuses a wrong live chain and redacts transport diagnostics before key invocation", async () => {
    const f = fixture("0x13b2");
    await expect(createPinnedArcBatchSigner(f.account, "https://synthetic.invalid?token=synthetic-secret").createPaymentPayload(2, requirement())).rejects.toThrow("local signing policy");
    expect(f.sign).not.toHaveBeenCalled(); expect(f.fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ["wrong sender", (payload: TypedDataPayload) => { payload.message.from = ATTACKER; }],
    ["changed schema", (payload: TypedDataPayload) => { payload.types.TransferWithAuthorization = [{ name: "to", type: "address" }]; }],
    ["extended original expiry", (payload: TypedDataPayload) => { payload.message.validBefore = BigInt(payload.message.validBefore as bigint) + BigInt(1); }],
  ] as const)("rejects SDK callback %s before underlying signing", async (_name, mutate) => {
    const f = fixture();
    const original = BatchEvmScheme.prototype.createPaymentPayload;
    vi.spyOn(BatchEvmScheme.prototype, "createPaymentPayload").mockImplementation(function(this: BatchEvmScheme, version, req) {
      const sdk = this as unknown as { signer: { signTypedData: (payload: TypedDataPayload) => Promise<`0x${string}`> } };
      const callback = sdk.signer.signTypedData;
      sdk.signer.signTypedData = payload => { const changed = structuredClone(payload); mutate(changed); return callback(changed); };
      return original.call(this, version, req);
    });
    await expect(createPinnedArcBatchSigner(f.account, "https://synthetic.invalid").createPaymentPayload(2, requirement())).rejects.toThrow("local signing policy");
    expect(f.sign).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("signs only the detached approved payload if the SDK mutates its object during RPC preflight", async () => {
    const f = fixture();
    const original = BatchEvmScheme.prototype.createPaymentPayload;
    vi.spyOn(BatchEvmScheme.prototype, "createPaymentPayload").mockImplementation(function(this: BatchEvmScheme, version, req) {
      const sdk = this as unknown as { signer: { signTypedData: (payload: TypedDataPayload) => Promise<`0x${string}`> } };
      const callback = sdk.signer.signTypedData;
      sdk.signer.signTypedData = payload => {
        const owned = structuredClone(payload);
        const pending = callback(owned);
        owned.message.value = BigInt(3000);
        owned.message.to = ATTACKER;
        owned.domain.chainId = 5042;
        owned.types.TransferWithAuthorization = [{ name: "to", type: "address" }];
        return pending;
      };
      return original.call(this, version, req);
    });
    await createPinnedArcBatchSigner(f.account, "https://synthetic.invalid").createPaymentPayload(2, requirement());
    expect(f.sign).toHaveBeenCalledOnce();
    expect(f.sign.mock.calls[0][0]).toMatchObject({ domain: { chainId: 5042002 }, message: { to: PAYEE, value: BigInt(2000) } });
    expect(f.sign.mock.calls[0][0].types.TransferWithAuthorization).toHaveLength(6);
  });
});

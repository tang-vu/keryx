import { recoverMessageAddress, recoverTypedDataAddress, type Hex, type TypedDataDefinition } from "viem";
import { circleUnsignedTransaction, verifyCircleSignedTransaction } from "./circle-wallet-transaction";

type Request = { method: string; params?: readonly unknown[] | object };
const READ_METHODS = new Set(["eth_blockNumber", "eth_call", "eth_estimateGas", "eth_feeHistory", "eth_gasPrice",
  "eth_getBalance", "eth_getCode", "eth_getTransactionCount", "eth_getBlockByNumber", "eth_getTransactionByHash",
  "eth_getTransactionReceipt", "eth_maxPriorityFeePerGas"]);
const hex = (value: unknown): value is Hex => typeof value === "string" && /^0x(?:[a-fA-F0-9]{2})*$/.test(value);
const addressEquals = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/** An EIP-1193 adapter around user-authorized Circle challenges. No private key reaches Keryx. */
export function createCircleWalletProvider(input: {
  address: Hex; chainId: number; assertCurrent(): void;
  sign(kind: "message" | "typedData" | "transaction", payload: string): Promise<string>;
  rpc(request: Request): Promise<unknown>;
}) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on(event: string, fn: (...args: unknown[]) => void) { const values = listeners.get(event) ?? new Set(); values.add(fn); listeners.set(event, values); },
    removeListener(event: string, fn: (...args: unknown[]) => void) { listeners.get(event)?.delete(fn); },
    async request(request: Request): Promise<unknown> {
      input.assertCurrent();
      const params = Array.isArray(request.params) ? request.params : [];
      if (request.method === "eth_accounts" || request.method === "eth_requestAccounts") return [input.address];
      if (request.method === "eth_chainId") {
        const chain = await input.rpc({ method: "eth_chainId" });
        if (typeof chain !== "string" || !/^0x[a-fA-F0-9]+$/.test(chain) || BigInt(chain) !== BigInt(input.chainId)) throw new Error("Google wallet RPC network differs");
        return chain;
      }
      if (request.method === "wallet_switchEthereumChain") {
        if (params.length !== 1 || !params[0] || typeof params[0] !== "object" || BigInt(params[0].chainId) !== BigInt(input.chainId)) throw new Error("Google wallet supports the selected Arc network only");
        return null;
      }
      if (request.method === "personal_sign") {
        if (params.length !== 2 || !hex(params[0]) || !addressEquals(params[1], input.address)) throw new Error("Message signing account differs");
        const signature = await input.sign("message", params[0]) as Hex;
        input.assertCurrent();
        if ((await recoverMessageAddress({ message: { raw: params[0] }, signature })).toLowerCase() !== input.address.toLowerCase()) throw new Error("Google wallet signature differs from the expected account");
        input.assertCurrent(); return signature;
      }
      if (request.method === "eth_signTypedData_v4") {
        if (params.length !== 2 || !addressEquals(params[0], input.address) || typeof params[1] !== "string") throw new Error("Typed signing account differs");
        const data = JSON.parse(params[1]);
        if (!data?.domain || BigInt(data.domain.chainId) !== BigInt(input.chainId)) throw new Error("Typed data network differs");
        const signature = await input.sign("typedData", params[1]) as Hex;
        input.assertCurrent();
        if ((await recoverTypedDataAddress({ ...data as TypedDataDefinition, signature })).toLowerCase() !== input.address.toLowerCase()) throw new Error("Google wallet typed signature differs from the expected account");
        input.assertCurrent(); return signature;
      }
      if (request.method === "eth_sendTransaction" || request.method === "eth_signTransaction") {
        if (params.length !== 1) throw new Error("Exactly one bounded transaction is required");
        const raw = circleUnsignedTransaction(params[0], input.address, input.chainId);
        const remoteChain = await input.rpc({ method: "eth_chainId" });
        if (typeof remoteChain !== "string" || !/^0x[a-fA-F0-9]+$/.test(remoteChain) || BigInt(remoteChain) !== BigInt(input.chainId)) throw new Error("Google wallet RPC network differs");
        input.assertCurrent();
        const signed = await input.sign("transaction", raw) as Hex;
        input.assertCurrent(); await verifyCircleSignedTransaction(raw, signed, input.address, input.chainId);
        input.assertCurrent();
        if (request.method === "eth_signTransaction") return signed;
        // One broadcast. Lost RPC responses stay uncertain in the caller's original journal.
        return input.rpc({ method: "eth_sendRawTransaction", params: [signed] });
      }
      if (READ_METHODS.has(request.method)) return input.rpc(request);
      throw Object.assign(new Error(`Google wallet does not support ${request.method}`), { code: 4200 });
    },
  };
}

import { hashMessage, hashTypedData, http, keccak256, serializeTransaction,
  type Hex, type LocalAccount, type Transport } from "viem";
import { hashAuthorization } from "viem/utils";
import { privateKeyToAccount, sign } from "viem/accounts";

const guardedAccounts = new WeakMap<object, EvmAuthorityGuard>();
const guardedRequests = new WeakMap<object, EvmAuthorityGuard>();

/** Verifies component provenance, not arbitrary overridden wallet actions.
 * Callers must supply a trusted actual viem client; cloning/overriding its
 * writeContract method is outside this check's guarantee. */
export function assertGuardedEvmWallet(wallet: { account?: unknown; transport?: { request?: unknown } }, guard: EvmAuthorityGuard): void {
  if (!wallet.account || typeof wallet.account !== "object" || guardedAccounts.get(wallet.account) !== guard
    || typeof wallet.transport?.request !== "function" || guardedRequests.get(wallet.transport.request) !== guard) {
    throw new Error("Guarded local account and EVM transport required");
  }
}

export interface EvmAuthorityGuard {
  /** Checks the complete pinned runtime/DB binding. Must throw on drift. */
  assertAuthority(): void;
  /** Re-attests the selected endpoint as Arc testnet, never just a client label. */
  attestChain(): Promise<void>;
}

async function admit(guard: EvmAuthorityGuard): Promise<void> {
  guard.assertAuthority();
  await guard.attestChain();
  guard.assertAuthority();
}

/** A new account surface: never spread private-key/HD helpers or raw sign methods.
 * Checks cannot cancel crypto or networking which has already started. This is
 * binding admission, not a transaction/payee/spend-cap policy. */
export function guardedLocalAccount(privateKey: Hex, guard: EvmAuthorityGuard): LocalAccount {
  const account = privateKeyToAccount(privateKey);
  const wrapped = Object.freeze({
    address: account.address, publicKey: account.publicKey, source: "custom", type: "local",
    sign: async ({ hash }) => { await admit(guard); guard.assertAuthority(); return sign({ hash, privateKey, to: "hex" }); },
    signAuthorization: async parameters => {
      await admit(guard);
      const { chainId, nonce } = parameters;
      const address = parameters.contractAddress ?? parameters.address;
      const hash = hashAuthorization({ address, chainId, nonce });
      guard.assertAuthority();
      const signature = await sign({ hash, privateKey });
      return { address, chainId, nonce, ...signature };
    },
    signMessage: async ({ message }) => {
      await admit(guard); const hash = hashMessage(message); guard.assertAuthority();
      return sign({ hash, privateKey, to: "hex" });
    },
    signTransaction: async (transaction, options) => {
      await admit(guard);
      const serializer = options?.serializer ?? serializeTransaction;
      const signable = transaction.type === "eip4844" ? { ...transaction, sidecars: false } : transaction;
      const serialized = await serializer(signable);
      const hash = keccak256(serialized);
      guard.assertAuthority();
      // Installed viem/accounts sign() invokes synchronous secp256k1.sign
      // before returning its Promise. No delegate/serializer await lies here.
      const signature = await sign({ hash, privateKey });
      return await serializer(transaction, signature);
    },
    signTypedData: async parameters => {
      await admit(guard); const hash = hashTypedData(parameters); guard.assertAuthority();
      return sign({ hash, privateKey, to: "hex" });
    },
  } satisfies LocalAccount);
  guardedAccounts.set(wrapped, guard);
  return wrapped;
}

// Controlled local-account clients need reads while preparing nonce/gas/fees.
// Unknown RPC methods (including remote signing, unlocked sends and bundles)
// refuse rather than receiving a permissive default.
const READ_METHODS = new Set([
  "eth_chainId", "eth_call", "eth_estimateGas", "eth_getBalance", "eth_getTransactionCount",
  "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getBlockByNumber",
  "eth_getBlockByHash", "eth_blockNumber", "eth_getTransactionByHash", "eth_getTransactionReceipt",
  "eth_getCode", "eth_getLogs",
]);

/** Controlled custom-transport composition only; cannot enforce the physical
 * boundary inside arbitrary async delegates. Runtime HTTP clients MUST use
 * guardedEvmHttp, which also guards physical fetch. No send retries here. */
export function guardedEvmTransport(base: Transport, guard: EvmAuthorityGuard): Transport {
  return parameters => {
    const inner = base({ ...parameters, retryCount: 0 });
    const request = (async (args, options) => {
        if (args.method === "eth_sendRawTransaction") { await admit(guard); guard.assertAuthority(); }
        else if (!READ_METHODS.has(args.method)) throw new Error("Unsupported guarded EVM RPC operation");
        else if (args.method !== "eth_chainId") await guard.attestChain();
        return inner.request(args, { ...options, retryCount: 0 });
      }) as typeof inner.request;
    guardedRequests.set(request, guard);
    return { config: { ...inner.config, request, retryCount: 0 }, request };
  };
}

/** Runtime convenience: owns the plain HTTP transport. Do not put another async
 * attestation/fallback/retry wrapper inside guardedEvmTransport: an inner await
 * would create another pre-forward gap. Chain attestation belongs in guard. */
export function guardedEvmHttp(url: string, guard: EvmAuthorityGuard,
  options?: Pick<NonNullable<Parameters<typeof http>[1]>, "timeout" | "onFetchRequest">): Transport {
  const physicalFetch = globalThis.fetch;
  // viem awaits onRequest even when absent. This final synchronous wrapper runs
  // afterwards. No hook or await follows admission before the real fetch call.
  const fetchFn: typeof fetch = (input, init) => {
    if (new URL(String(input)).href !== new URL(url).href) throw new Error("Guarded EVM endpoint changed");
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (!body || typeof body !== "object" || Array.isArray(body)
      || typeof (body as { method?: unknown }).method !== "string") throw new Error("Invalid guarded EVM request");
    const method = (body as { method: string }).method;
    if (method === "eth_sendRawTransaction") guard.assertAuthority();
    else if (!READ_METHODS.has(method)) throw new Error("Unsupported guarded EVM RPC operation");
    return physicalFetch(input, init);
  };
  return guardedEvmTransport(http(url, { ...options, fetchFn, retryCount: 0, batch: false }), guard);
}

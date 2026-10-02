import {
  createWalletClient, http, isAddress, keccak256, parseTransaction, recoverTransactionAddress,
  type Address, type Hex, type PrivateKeyAccount, type TransactionSerializable, type Transport,
} from "viem";
import { chainForProfile } from "../chains";
import { assertArcRpcChain } from "../arc-rpc-attestation";
import { paymentRuntimeConfig } from "../payment-runtime-config";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";

export const ARC_GATEWAY_DEPOSIT_ABI = [{ type: "function", name: "deposit", stateMutability: "nonpayable",
  inputs: [{ name: "token", type: "address" }, { name: "value", type: "uint256" }], outputs: [] }] as const;

export interface IntendedArcTransaction {
  to: Address;
  data?: Hex;
  value?: bigint;
  gas?: bigint;
}

export class GuardedArcSubmissionUnknownError extends Error {
  constructor(readonly transactionHash: Hex) {
    super("Arc transaction submission outcome is unknown; inspect the original transaction hash before any further funding");
    this.name = "GuardedArcSubmissionUnknownError";
  }
}

const SERIALIZED_FIELDS = ["to", "data", "value", "nonce", "gas", "gasPrice", "maxFeePerGas",
  "maxPriorityFeePerGas", "chainId", "type"] as const;
const METADATA_FIELDS = ["account", "chain", "parameters", "nonceManager", "from"];
const RPC_METHODS = new Set(["eth_chainId", "eth_fillTransaction", "eth_getTransactionCount", "eth_getBlockByNumber",
  "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_estimateGas", "eth_sendRawTransaction"]);
const fail = (): never => { throw new Error("Arc transaction refused by the local signing policy"); };
const sameHex = (left: unknown, right: string) => typeof left === "string" && left.toLowerCase() === right.toLowerCase();
function uint(value: unknown): bigint {
  if (typeof value === "bigint" && value >= BigInt(0) && value < BigInt(2) ** BigInt(256)) return value;
  return fail();
}
function rpcUint(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value) || value.length > 66) return fail();
  return BigInt(value);
}

/** Verify the actual prepared request, rather than trusting a client chain label or RPC preflight. */
function checkedTransaction(input: Record<string, unknown>, expected: Readonly<IntendedArcTransaction>, sender: string, profile: ArcNetworkProfile): TransactionSerializable {
  if (input.chainId !== profile.chainId || !sameHex(input.to, expected.to)
    || !sameHex(input.data ?? "0x", expected.data ?? "0x")
    || uint(input.value ?? BigInt(0)) !== (expected.value ?? BigInt(0))
    || (input.from !== undefined && !sameHex(input.from, sender))) fail();
  if (input.accessList !== undefined && (!Array.isArray(input.accessList) || input.accessList.length !== 0)) fail();
  if (Object.entries(input).some(([key, value]) => value !== undefined && key !== "accessList" &&
    !SERIALIZED_FIELDS.includes(key as typeof SERIALIZED_FIELDS[number]) && !METADATA_FIELDS.includes(key))) fail();
  if (typeof input.nonce !== "number" || !Number.isSafeInteger(input.nonce) || input.nonce < 0
    || uint(input.gas) === BigInt(0) || uint(input.gas) >= BigInt(2) ** BigInt(64)
    || (expected.gas !== undefined && input.gas !== expected.gas)) fail();
  if (input.type === "legacy") {
    if (uint(input.gasPrice) === BigInt(0) || input.maxFeePerGas !== undefined || input.maxPriorityFeePerGas !== undefined) fail();
  } else if (input.type === "eip1559") {
    if (input.gasPrice !== undefined || uint(input.maxFeePerGas) === BigInt(0)
      || uint(input.maxPriorityFeePerGas) > uint(input.maxFeePerGas)) fail();
  } else fail();
  // Hand the underlying account only the checked serializable fields.
  return Object.freeze(Object.fromEntries(SERIALIZED_FIELDS.flatMap(key =>
    input[key] === undefined ? [] : [[key, input[key]]]))) as unknown as TransactionSerializable;
}

function checkedFill(result: unknown, expected: Readonly<IntendedArcTransaction>, sender: string, profile: ArcNetworkProfile): void {
  const tx = (result as { tx?: Record<string, unknown> } | null)?.tx;
  // Arc's unsigned fill serialization omits from. Bind only that absence to the
  // captured local account; explicit sender values still must match. The final
  // signed bytes are independently recovered and checked before broadcast.
  const filledSender = tx?.from === undefined ? sender : tx.from;
  if (!tx || rpcUint(tx.chainId) !== BigInt(profile.chainId) || !sameHex(tx.to, expected.to)
    || !sameHex(filledSender, sender) || !sameHex(tx.input ?? tx.data ?? "0x", expected.data ?? "0x")
    || (tx.input !== undefined && tx.data !== undefined && !sameHex(tx.input, String(tx.data)))
    || rpcUint(tx.value ?? "0x0") !== (expected.value ?? BigInt(0))
    || ["authorizationList", "blobs", "blobVersionedHashes", "maxFeePerBlobGas", "feePayer", "feePayerSignature"].some(key => tx[key] !== undefined)
    || (tx.accessList !== undefined && (!Array.isArray(tx.accessList) || tx.accessList.length !== 0))) fail();
}

function guardedTransport(url: string, expected: Readonly<IntendedArcTransaction>, sender: string,
  assertActive: () => void, refuse: () => never, admitRaw: (hash: Hex) => void, profile: ArcNetworkProfile): Transport {
  const base = http(url, { retryCount: 0, timeout: 4_000 });
  return parameters => {
    const transport = base(parameters);
    async function attest() {
      assertActive();
      const observed = await transport.request({ method: "eth_chainId" });
      try { if (rpcUint(observed) !== BigInt(profile.chainId)) refuse(); } catch { refuse(); }
    }
    return { ...transport, request: (async (args, options) => {
      assertActive();
      if (!RPC_METHODS.has(args.method)) refuse();
      let rawHash: Hex | undefined;
      if (args.method === "eth_sendRawTransaction") {
        const raw = (args.params as readonly unknown[] | undefined)?.[0];
        if (typeof raw !== "string" || raw.length > 131_074 || !/^0x(?:[0-9a-f]{2})+$/i.test(raw)) fail();
        const parsed = parseTransaction(raw as Hex);
        if (!sameHex(await recoverTransactionAddress({ serializedTransaction: raw as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"] }), sender)) fail();
        if (parsed.accessList !== undefined && parsed.accessList.length !== 0) fail();
        const { accessList: _emptyAccessList, r: _r, s: _s, v: _v, yParity: _yParity, ...transaction } = parsed;
        checkedTransaction(transaction as unknown as Record<string, unknown>, expected, sender, profile);
        rawHash = keccak256(raw as Hex);
      }
      if (args.method !== "eth_chainId") await attest();
      if (rawHash) admitRaw(rawHash);
      const result = await transport.request(args, options);
      // viem falls back when eth_fillTransaction rejects. Keep a sticky fence so
      // a detected policy violation cannot be laundered through that fallback.
      try {
        if (args.method === "eth_chainId" && rpcUint(result) !== BigInt(profile.chainId)) refuse();
        if (args.method === "eth_fillTransaction") checkedFill(result, expected, sender, profile);
        if (rawHash && !sameHex(result, rawHash)) refuse();
      } catch { refuse(); }
      return result;
    }) as typeof transport.request };
  };
}

/** One caller-authorized Arc testnet operation. Never hands a private key to an SDK transport.
 * The caller owns spend authorization, nonce admission/recovery, funding limits and receipt checks. */
export async function sendGuardedArcTransaction(input: {
  account: PrivateKeyAccount;
  rpcUrl: string;
  transaction: IntendedArcTransaction;
  profile?: ArcNetworkProfile;
}): Promise<Hex> {
  const profile = input.profile ?? paymentRuntimeConfig().profile;
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) fail();
  const expected = Object.freeze({ ...input.transaction });
  if (!isAddress(expected.to) || /^0x0{40}$/i.test(expected.to)
    || (expected.data !== undefined && !/^0x(?:[0-9a-f]{2})*$/i.test(expected.data))
    || Object.keys(expected).some(key => !["to", "data", "value", "gas"].includes(key))) fail();
  uint(expected.value ?? BigInt(0));
  if (expected.gas !== undefined && (uint(expected.gas) === BigInt(0) || expected.gas >= BigInt(2) ** BigInt(64))) fail();
  const sign = input.account.signTransaction.bind(input.account);
  const sender = input.account.address;
  const rpcUrl = input.rpcUrl;
  let refused = false;
  let submittedHash: Hex | undefined;
  const assertActive = () => { if (refused) fail(); };
  const refuse = (): never => { refused = true; return fail(); };
  const admitRaw = (hash: Hex) => { if (submittedHash) refuse(); submittedHash = hash; };
  const account: PrivateKeyAccount = { ...input.account,
    signMessage: async () => fail(), signTypedData: async () => fail(),
    signTransaction: async (transaction, options) => {
      if (options?.serializer !== undefined) fail();
      assertActive();
      const checked = checkedTransaction(transaction as unknown as Record<string, unknown>, expected, sender, profile);
      await assertArcRpcChain(rpcUrl, profile);
      assertActive();
      return sign(checked);
    },
  };
  const wallet = createWalletClient({ account, chain: chainForProfile(profile),
    transport: guardedTransport(rpcUrl, expected, account.address, assertActive, refuse, admitRaw, profile) });
  try { return await wallet.sendTransaction(expected); }
  // RPC errors can embed credential-bearing URLs or signed bearer transactions.
  catch {
    if (submittedHash) throw new GuardedArcSubmissionUnknownError(submittedHash);
    return fail();
  }
}

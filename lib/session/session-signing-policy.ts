import { decodeFunctionData, encodeFunctionData, erc20Abi, isAddress, type Hex } from "viem";
import type { TypedDataPayload } from "./session-signer-protocol";

// Independent, public testnet policy. Never derive signing authority from server config.
export const SESSION_CHAIN_ID = 5042002;
export const SESSION_USDC = "0x3600000000000000000000000000000000000000";
export const SESSION_GATEWAY = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const SESSION_DEPOSIT_ABI = [{ type: "function", name: "deposit", stateMutability: "nonpayable",
  inputs: [{ name: "token", type: "address" }, { name: "value", type: "uint256" }], outputs: [] }] as const;
const PAYMENT_FIELDS = [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
] as const;
const DOMAIN_FIELDS = [{ name: "name", type: "string" }, { name: "version", type: "string" },
  { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] as const;
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const fail = (reason: string): never => { throw new Error(`session signing policy: ${reason}`); };
function keys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}
function address(value: unknown, expected?: string): value is Hex {
  return typeof value === "string" && isAddress(value) && !/^0x0{40}$/i.test(value) &&
    (!expected || value.toLowerCase() === expected.toLowerCase());
}
function uint(value: unknown): bigint {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) fail("unsafe integer");
  if (typeof value !== "bigint" && typeof value !== "number" &&
      !(typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) && value.length <= 78)) fail("invalid integer");
  const integer = BigInt(value as bigint | number | string);
  if (integer < BigInt(0) || integer > UINT256_MAX) fail("integer out of range");
  return integer;
}
function fields(actual: unknown, expected: readonly { name: string; type: string }[]) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((field, i) =>
    field && keys(field, ["name", "type"]) && field.name === expected[i].name && field.type === expected[i].type);
}

/** Validate before any registry lookup or signature. Does not authorize a server journal nonce. */
export function validateSessionPayment(payload: TypedDataPayload, signer: string, nowSeconds = Math.floor(Date.now() / 1000)): void {
  if (payload.primaryType !== "TransferWithAuthorization") fail("signs TransferWithAuthorization only");
  const { domain, types, message } = payload;
  if (!domain || !keys(domain, ["name", "version", "chainId", "verifyingContract"]) ||
      domain.name !== "GatewayWalletBatched" || domain.version !== "1" || domain.chainId !== SESSION_CHAIN_ID ||
      !address(domain.verifyingContract, SESSION_GATEWAY)) fail("invalid payment domain");
  if (!types || !keys(types, "EIP712Domain" in types ? ["TransferWithAuthorization", "EIP712Domain"] : ["TransferWithAuthorization"]) ||
      !fields(types.TransferWithAuthorization, PAYMENT_FIELDS) ||
      ("EIP712Domain" in types && !fields(types.EIP712Domain, DOMAIN_FIELDS))) fail("invalid payment types");
  if (!message || !keys(message, ["from", "to", "value", "validAfter", "validBefore", "nonce"]) ||
      !address(message.from, signer) || !address(message.to) || uint(message.value) <= BigInt(0) ||
      typeof message.nonce !== "string" || !/^0x[0-9a-f]{64}$/i.test(message.nonce)) fail("invalid payment message");
  const after = uint(message.validAfter), before = uint(message.validBefore), now = BigInt(nowSeconds);
  // Mirror live browser timing: 600-second backdate, SDK minimum plus buffer,
  // and the deployed maximum. Retain the SDK's full seven-day remaining minimum;
  // the browser adds its 100-second buffer before the worker call.
  if (after > now || after < now - BigInt(3600) || before < now + BigInt(604800) ||
      before > now + BigInt(691200 + 300) || before <= after) fail("invalid payment lifetime");
}

/** Only canonical approve(Gateway, amount) or deposit(USDC, amount), on Arc testnet. */
export function validateSessionTransaction(tx: Record<string, unknown>, signer: string): void {
  if (!address(tx.to) || (![SESSION_USDC.toLowerCase(), SESSION_GATEWAY.toLowerCase()].includes(tx.to.toLowerCase())))
    fail("will not sign a transaction to this destination");
  if (tx.from !== undefined && !address(tx.from, signer)) fail(`this session key is ${signer}, not ${String(tx.from)}`);
  const allowed = ["from", "to", "data", "value", "nonce", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "chainId", "type"];
  if (Object.keys(tx).some(key => !allowed.includes(key))) fail("unsupported transaction feature");
  if (tx.chainId !== SESSION_CHAIN_ID || uint(tx.value ?? BigInt(0)) !== BigInt(0)) fail("invalid chain or native value");
  if (typeof tx.nonce !== "number" || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0) fail("invalid transaction nonce");
  if (uint(tx.gas) <= BigInt(0) || uint(tx.gas) > (BigInt(1) << BigInt(64)) - BigInt(1)) fail("invalid gas");
  const legacy = tx.type === "legacy" || (tx.type === undefined && tx.gasPrice !== undefined);
  if (legacy) {
    if (tx.maxFeePerGas !== undefined || tx.maxPriorityFeePerGas !== undefined || uint(tx.gasPrice) <= BigInt(0)) fail("invalid legacy fees");
  } else {
    if (tx.type !== undefined && tx.type !== "eip1559") fail("unsupported transaction type");
    if (tx.gasPrice !== undefined || uint(tx.maxFeePerGas) <= BigInt(0) || uint(tx.maxPriorityFeePerGas) > uint(tx.maxFeePerGas)) fail("invalid dynamic fees");
  }
  // Integer and fee consistency checks are not a lifetime gas budget. Native backing
  // and RPC estimates remain the existing funding policy; repeated XSS calls can burn gas.
  if (typeof tx.data !== "string" || !/^0x[0-9a-f]{136}$/i.test(tx.data)) fail("invalid canonical calldata");
  const data = tx.data as Hex;
  const to = tx.to as string;
  try {
    if (to.toLowerCase() === SESSION_USDC.toLowerCase()) {
      const decoded = decodeFunctionData({ abi: erc20Abi, data });
      if (decoded.functionName !== "approve" || !address(decoded.args[0], SESSION_GATEWAY) || uint(decoded.args[1]) <= BigInt(0) ||
          encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SESSION_GATEWAY, decoded.args[1]] }).toLowerCase() !== data.toLowerCase()) fail("invalid Gateway approval");
    } else {
      const decoded = decodeFunctionData({ abi: SESSION_DEPOSIT_ABI, data });
      if (!address(decoded.args[0], SESSION_USDC) || uint(decoded.args[1]) <= BigInt(0) ||
          encodeFunctionData({ abi: SESSION_DEPOSIT_ABI, functionName: "deposit", args: [SESSION_USDC, decoded.args[1]] }).toLowerCase() !== data.toLowerCase()) fail("invalid USDC deposit");
    }
  } catch { fail("invalid canonical approve/deposit calldata"); }
}

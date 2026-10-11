import { decodeFunctionResult, encodeFunctionData } from "viem";
import { ARC_MAINNET_PROFILE } from "./arc-network-profile";
import { readBoundedJson } from "./read-bounded-json";
import { recordedWalkthrough } from "./recorded-walkthrough";
import { REGISTRY_ABI } from "./registry/registry-abi";

/** The one settled payment of the retained public QA receipt, pinned so a third party's
 * record is compared with the digest-checked checkpoint rather than with a live Keryx reply.
 * `recorded-walkthrough-verification.test.ts` binds every value to the retained snapshot. */
export const recordedPayment = Object.freeze({
  network: ARC_MAINNET_PROFILE.networkId,
  chainIdHex: ARC_MAINNET_PROFILE.chainIdHex,
  payee: "0x3d609ef127094624cc434aad5a9faca0851daa2d",
  sourceId: "0x1881535394a6c36b638933dc7f398897d2ceba32e052f3484c4295290dacffc7",
  budgetMicros: 50_000,
  accessMicros: 0,
  citationMicros: 25_000,
  pendingMicros: 0,
  failedMicros: 0,
  /** Production SourceRegistry recorded in docs/mainnet-status.md. */
  registryAddress: "0x42a64061b6cd84067bb660b2a9b8aa881fd225bb",
  circleTransferUrl: `${ARC_MAINNET_PROFILE.gatewayApiUrl}/v1/x402/transfers/${recordedWalkthrough.circleTransferId}`,
  rpcUrl: ARC_MAINNET_PROFILE.rpcUrl,
} as const);

export type CircleTransferCheck = "completed" | "progressing" | "failed" | "mismatch";
export type RegistryPayoutCheck = "registered" | "changed";

const progressing = new Set(["received", "batched", "confirmed"]);
const MAX_BYTES = 65_536;

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length > 256) throw new Error("Invalid Circle transfer record");
  return value;
}

/**
 * Compare Circle's own record with the retained payment. Every payment-critical field is bound:
 * a record that is merely present, or that names another recipient, amount, token or network,
 * is a mismatch. Circle status is an API fact; it is not chain finality.
 */
export function checkCircleTransfer(value: unknown): CircleTransferCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Circle transfer record");
  const row = value as Record<string, unknown>;
  const status = text(row, "status");
  const matches = text(row, "id") === recordedWalkthrough.circleTransferId &&
    text(row, "token") === "USDC" &&
    text(row, "sendingNetwork") === recordedPayment.network &&
    text(row, "recipientNetwork") === recordedPayment.network &&
    text(row, "toAddress").toLowerCase() === recordedPayment.payee &&
    text(row, "amount") === String(recordedPayment.citationMicros);
  if (!matches) return "mismatch";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (progressing.has(status)) return "progressing";
  throw new Error("Unknown Circle transfer status");
}

function publicRead(signal: AbortSignal): RequestInit {
  return {
    credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  };
}

/** One caller-initiated, credential-free GET to Circle's public Gateway API; no Keryx endpoint. */
export async function readCircleTransfer(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<CircleTransferCheck> {
  const response = await fetcher(recordedPayment.circleTransferUrl, {
    ...publicRead(signal), method: "GET", headers: { Accept: "application/json" },
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Circle transfer record unavailable"); }
  return checkCircleTransfer(await readBoundedJson(response, MAX_BYTES));
}

const registryCall = [
  { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
  { jsonrpc: "2.0", id: 2, method: "eth_call", params: [{
    to: recordedPayment.registryAddress,
    data: encodeFunctionData({ abi: REGISTRY_ABI, functionName: "get", args: [recordedPayment.sourceId] }),
  }, "latest"] },
] as const;

function rpcResult(batch: unknown, id: number): string {
  if (!Array.isArray(batch) || batch.length !== registryCall.length) throw new Error("Invalid Arc RPC response");
  const entries = batch.filter(entry => entry && typeof entry === "object" && (entry as { id?: unknown }).id === id);
  const result = entries.length === 1 ? (entries[0] as { result?: unknown }).result : undefined;
  if (typeof result !== "string" || !/^0x[0-9a-f]*$/i.test(result)) throw new Error("Invalid Arc RPC response");
  return result;
}

/**
 * The endpoint must attest Arc mainnet in the same response as the registry read. This reads the
 * registry's current payout authority; it is not a per-payment transaction or historical state.
 */
export function checkRegistryPayout(batch: unknown): RegistryPayoutCheck {
  const chainId = rpcResult(batch, 1);
  if (chainId === "0x" || BigInt(chainId) !== BigInt(recordedPayment.chainIdHex)) throw new Error("Arc RPC chain ID mismatch");
  const source = decodeFunctionResult({ abi: REGISTRY_ABI, functionName: "get", data: rpcResult(batch, 2) as `0x${string}` });
  return source.active && source.payoutWallet.toLowerCase() === recordedPayment.payee ? "registered" : "changed";
}

/** One caller-initiated, credential-free JSON-RPC read against the public Arc endpoint. */
export async function readRegistryPayout(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<RegistryPayoutCheck> {
  const response = await fetcher(recordedPayment.rpcUrl, {
    ...publicRead(signal), method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(registryCall),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Arc registry record unavailable"); }
  return checkRegistryPayout(await readBoundedJson(response, MAX_BYTES));
}

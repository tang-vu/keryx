import { decodeEventLog, encodeAbiParameters, keccak256, type Address, type Hex, type TransactionReceipt } from "viem";

const registrationEvent = [{ type: "event", name: "SourceRegistered", inputs: [
  { name: "id", type: "bytes32", indexed: true },
  { name: "creator", type: "address", indexed: true },
  { name: "contentCid", type: "string", indexed: false },
] }] as const;

export interface RegistrationIdentity {
  registry: Address;
  creator: Address;
  onchainId: Hex;
}

export type RegistrationPhase = "offline" | "signing" | "mining" | "indexing" | "indexed" | "failed" | "unknown";

export const registrationTitles: Record<RegistrationPhase, string> = {
  offline: "Source saved locally (offline)",
  signing: "Waiting for wallet signature",
  mining: "Transaction submitted: confirmation pending",
  indexing: "Registration confirmed: indexing pending",
  indexed: "Registration confirmed and indexed",
  failed: "Registration not confirmed",
  unknown: "Confirmation unknown",
};

export function registrationId(creator: Address, urlHash: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [creator, urlHash]));
}

/** Wallet adapters wrap EIP-1193 rejection errors in several causal layers. */
export function walletRequestWasRejected(error: unknown): boolean {
  for (let depth = 0; depth < 8 && error && typeof error === "object"; depth++) {
    const cause = error as { code?: unknown; name?: unknown; cause?: unknown };
    if (cause.code === 4001 || cause.name === "UserRejectedRequestError") return true;
    error = cause.cause;
  }
  return false;
}

/** A mined self-transfer or cancelled/replaced transaction is not a registration. */
export function confirmsRegistration(receipt: Pick<TransactionReceipt, "status" | "logs">, expected: RegistrationIdentity): boolean {
  if (receipt.status !== "success") return false;
  return receipt.logs.some(log => {
    if (log.address.toLowerCase() !== expected.registry.toLowerCase()) return false;
    try {
      const event = decodeEventLog({ abi: registrationEvent, data: log.data, topics: log.topics, strict: true });
      return event.args.id.toLowerCase() === expected.onchainId.toLowerCase()
        && event.args.creator.toLowerCase() === expected.creator.toLowerCase();
    } catch { return false; }
  });
}

export function confirmsIndex(value: unknown, expected: RegistrationIdentity): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.mode === "onchain" && typeof row.onchainId === "string"
    && row.onchainId.toLowerCase() === expected.onchainId.toLowerCase()
    && typeof row.registryAddress === "string" && row.registryAddress.toLowerCase() === expected.registry.toLowerCase()
    && typeof row.creator === "string" && row.creator.toLowerCase() === expected.creator.toLowerCase();
}

/** Native ARC wallets are not generic EVM signing wallets. Circle's raw transaction
 * endpoint supports SOL/EVM wallet codes only. Never substitute another wallet. */
import type { WalletClient } from "viem";

export const CIRCLE_TRANSACTION_SIGNING_UNAVAILABLE = "Circle does not support the exact transaction signing required for this Arc wallet. Existing records and funds are unchanged.";
export class CircleTransactionSigningUnavailableError extends Error {
  readonly code = 4200;
  constructor() { super(CIRCLE_TRANSACTION_SIGNING_UNAVAILABLE); this.name = "CircleTransactionSigningUnavailableError"; }
}
export function circleTransactionSigningError() {
  return new CircleTransactionSigningUnavailableError();
}

/** Denial-only Keryx metadata over EIP-5792. This is not a standard guarantee of
 * signing support. Legacy wallets without this metadata retain existing checks.
 * A failure here occurs before exposure, never releases an earlier attempt. */
export async function assertExactTransactionSigning(wallet: WalletClient, payer: string, chainId: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (typeof wallet.request !== "function") return;
  const chain = `0x${chainId.toString(16)}`;
  let result: unknown;
  try {
    result = await wallet.request({ method: "wallet_getCapabilities", params: [payer as `0x${string}`, [chain as `0x${string}`]] });
  } catch (error) {
    let current = error;
    for (let i = 0; i < 8 && current && typeof current === "object"; i++) {
      if ("code" in current && (current.code === 4200 || current.code === -32601)) return;
      current = "cause" in current ? current.cause : undefined;
    }
    throw error;
  }
  signal?.throwIfAborted();
  if (!result || typeof result !== "object") return;
  for (const key of [chain, "0x0"]) {
    const capabilities = (result as Record<string, unknown>)[key];
    if (!capabilities || typeof capabilities !== "object") continue;
    const signing = (capabilities as Record<string, unknown>).keryxExactTransactionSigning;
    if (signing && typeof signing === "object" && "supported" in signing && signing.supported === false) throw circleTransactionSigningError();
  }
}

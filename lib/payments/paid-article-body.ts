import type { PaymentRecord, SourceItem } from "../types";
import { contentBodyHash, contentBytes } from "../sources/content-receipt";
import { PaymentPendingError, PaymentSettledError } from "./payment-state";

export interface SelectedArticleBodyContract {
  readonly bodyHash?: string;
  readonly plaintextBytes?: number;
}

/** Capture only explicit plaintext commitments before I/O. The public receipt can infer a byte
 * count from a legacy encrypted row's ciphertext or preview; that is not a plaintext commitment.
 * Hash consistency does not independently authenticate a publisher or its manifest signature. */
export function selectedArticleBodyContract(item?: SourceItem): SelectedArticleBodyContract {
  const hashes = [item?.bodyHash, item?.manifest?.bodyHash].filter(value => value !== undefined);
  const counts = [item?.plaintextBytes, item?.manifest?.plaintextBytes].filter(value => value !== undefined);
  if (hashes.some(value => typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)))
    throw new Error("selected paid article body hash is malformed");
  if (counts.some(value => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0))
    throw new Error("selected paid article body byte count is malformed");
  const bodyHash = hashes[0]?.toLowerCase(), plaintextBytes = counts[0];
  if (hashes.some(value => value.toLowerCase() !== bodyHash) || counts.some(value => value !== plaintextBytes))
    throw new Error("selected paid article body commitments conflict");
  return Object.freeze({ ...(bodyHash !== undefined ? { bodyHash } : {}),
    ...(plaintextBytes !== undefined ? { plaintextBytes } : {}) });
}

/** Failed delivery retains the exact payment original. It authorizes no refund, release or retry. */
export function readPaidArticleBody(
  value: unknown, contract: SelectedArticleBodyContract, payment: PaymentRecord,
): string {
  const reason = typeof value !== "string" || !value.trim() ? "paid article body is missing, empty or not text"
    : contract.bodyHash !== undefined && contentBodyHash(value) !== contract.bodyHash ? "paid article body hash does not match the selected commitment"
    : contract.plaintextBytes !== undefined && contentBytes(value) !== contract.plaintextBytes ? "paid article body byte count does not match the selected commitment"
    : undefined;
  if (reason) {
    if (payment.settled) {
      payment.rationale = `Circle settlement confirmed, but ${reason}.`;
      throw new PaymentSettledError(`payment settled, but ${reason}`, payment);
    }
    payment.rationale = `${payment.rationale ?? "Signed x402 authorization remains pending."} Delivery refused: ${reason}.`;
    throw new PaymentPendingError(`settlement confirmation pending and ${reason}`, payment);
  }
  return value as string;
}

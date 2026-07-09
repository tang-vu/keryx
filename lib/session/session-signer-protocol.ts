/**
 * Message shapes exchanged with the session signer worker.
 *
 * Everything crossing this boundary is structured-cloneable, which is why `wrapped`/`iv` travel as
 * `Uint8Array` and typed-data messages keep their `bigint` fields intact. Notably absent: any
 * message that returns the private key. The worker will sign, and it will hand back ciphertext it
 * cannot be talked into decrypting for anyone else — it never exposes key material.
 */

import type { WrappedKey } from "./session-key-vault";

export interface TypedDataPayload {
  domain: Record<string, unknown>;
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export type SignerRequest =
  /** Derive the session key from a wallet signature, in the worker, and wrap it for storage. */
  | { id: number; type: "deriveFromSignature"; signature: string }
  /** Rehydrate the key from tab-scoped ciphertext (page reload). */
  | { id: number; type: "restore"; wrapped: Uint8Array; iv: Uint8Array }
  | { id: number; type: "signTypedData"; payload: TypedDataPayload }
  | { id: number; type: "signTransaction"; transaction: Record<string, unknown> }
  /** Drop the key and destroy the wrapping key, so existing ciphertext can never be read again. */
  | { id: number; type: "clear" };

export type SignerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

/** `Omit` over a union collapses it to the shared keys; this keeps each variant intact. */
export type SignerRequestBody = SignerRequest extends infer Variant
  ? Variant extends { id: number }
    ? Omit<Variant, "id">
    : never
  : never;

/** Result of `deriveFromSignature` — the address, plus the ciphertext the tab should hold. */
export interface DerivedSession extends WrappedKey {
  address: `0x${string}`;
}

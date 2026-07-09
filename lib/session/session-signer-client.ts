"use client";

/**
 * Main-thread handle on the signer worker.
 *
 * It presents the worker as an ordinary viem account, so every existing call site — the Gateway
 * approve/deposit writes, the x402 `signTypedData` — keeps working while the private key moves out
 * of the page's reach. viem asks the account to sign; the account asks the worker; the worker
 * decides. Nothing here can read the key, which is the point: this file is the part an XSS owns.
 */

import { toAccount } from "viem/accounts";
import type { LocalAccount } from "viem";
import type {
  DerivedSession,
  SignerRequest,
  SignerRequestBody,
  SignerResponse,
  TypedDataPayload,
} from "./session-signer-protocol";
import type { WrappedKey } from "./session-key-vault";

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };

/** The slice of `Worker` this class uses, so tests can drive it over an in-process channel. */
export interface SignerPort {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<SignerResponse>) => void): void;
  addEventListener(type: "error", listener: (event: { message?: string }) => void): void;
  terminate(): void;
}

/**
 * viem hands `signTransaction` the whole prepared request, which carries the account object, the
 * chain object, and a nonce manager — all of them full of functions. `postMessage` structured-clones
 * its argument and throws on the first function it meets, so only the fields that actually get
 * serialized into a transaction may cross. Everything else the worker already knows or ignores.
 */
const SERIALIZABLE_TRANSACTION_FIELDS = [
  "from",
  "to",
  "data",
  "value",
  "nonce",
  "gas",
  "gasPrice",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "maxFeePerBlobGas",
  "accessList",
  "authorizationList",
  "blobs",
  "blobVersionedHashes",
  "chainId",
  "type",
] as const;

export function toCloneableTransaction(transaction: Record<string, unknown>): Record<string, unknown> {
  const cloneable: Record<string, unknown> = {};
  for (const field of SERIALIZABLE_TRANSACTION_FIELDS) {
    if (transaction[field] !== undefined) cloneable[field] = transaction[field];
  }
  return cloneable;
}

/** Kept in its own function so the bundler can see the worker entry statically. */
function createSignerWorker(): Worker {
  return new Worker(new URL("./session-signer.worker.ts", import.meta.url), { type: "module" });
}

export class SessionSigner {
  private worker: SignerPort;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private address: `0x${string}` | null = null;

  constructor(port?: SignerPort) {
    this.worker = port ?? createSignerWorker();
    this.worker.addEventListener("message", (event: MessageEvent<SignerResponse>) => {
      const { id, ok } = event.data;
      const slot = this.pending.get(id);
      if (!slot) return;
      this.pending.delete(id);
      if (ok) slot.resolve(event.data.result);
      else slot.reject(new Error(event.data.error));
    });
    this.worker.addEventListener("error", (event) => {
      const err = new Error(event.message || "session signer worker failed");
      for (const slot of this.pending.values()) slot.reject(err);
      this.pending.clear();
    });
  }

  private call<T>(request: SignerRequestBody): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...request, id } as SignerRequest);
    });
  }

  /** Hand the wallet signature straight to the worker; the key is derived on the other side. */
  async deriveFromSignature(signature: string): Promise<DerivedSession> {
    const session = await this.call<DerivedSession>({ type: "deriveFromSignature", signature });
    this.address = session.address;
    return session;
  }

  /** Rehydrate from tab-scoped ciphertext after a reload. */
  async restore(blob: WrappedKey): Promise<`0x${string}`> {
    const { address } = await this.call<{ address: `0x${string}` }>({
      type: "restore",
      wrapped: blob.wrapped,
      iv: blob.iv,
    });
    this.address = address;
    return address;
  }

  /** Null until a key is loaded. */
  get sessionAddress(): `0x${string}` | null {
    return this.address;
  }

  /**
   * A viem account backed by the worker. `signMessage` throws on purpose: the session key exists to
   * authorise payments, and a free-form message signer is an easy way to launder an approval.
   */
  account(): LocalAccount | null {
    if (!this.address) return null;
    return toAccount({
      address: this.address,
      signMessage: async () => {
        throw new Error("the session key does not sign arbitrary messages");
      },
      signTransaction: async (transaction) =>
        this.call<`0x${string}`>({
          type: "signTransaction",
          transaction: toCloneableTransaction(transaction as unknown as Record<string, unknown>),
        }),
      signTypedData: async (payload) =>
        this.call<`0x${string}`>({
          type: "signTypedData",
          payload: payload as unknown as TypedDataPayload,
        }),
    });
  }

  /** Forget the key and burn the wrapping key, so persisted ciphertext dies with it. */
  async clear(): Promise<void> {
    this.address = null;
    await this.call<null>({ type: "clear" }).catch(() => {
      /* the worker may already be gone — nothing left to protect */
    });
  }

  terminate(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}

/** One signer per tab. Created lazily so the worker is never constructed during SSR. */
let singleton: SessionSigner | null = null;

export function getSessionSigner(): SessionSigner {
  if (typeof window === "undefined") {
    throw new Error("the session signer is browser-only");
  }
  singleton ??= new SessionSigner();
  return singleton;
}

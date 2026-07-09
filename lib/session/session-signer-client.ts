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

export class SessionSigner {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private address: `0x${string}` | null = null;

  constructor() {
    this.worker = new Worker(new URL("./session-signer.worker.ts", import.meta.url), {
      type: "module",
    });
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
          transaction: transaction as unknown as Record<string, unknown>,
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

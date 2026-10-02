"use client";

/**
 * Main-thread handle on the signer worker.
 *
 * Testnet retains its legacy viem account interface. Mainnet exposes specific authenticated
 * journal operations and owner consent proofs. Worker admission is not an XSS-proof vault:
 * same-origin code can access the stored wrapping key/ciphertext and initial derivation
 * signature. See docs/mainnet-browser-custody.md for the custody trust boundary.
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
import { browserPaymentProfile } from "../browser-payment-profile";
import type { BrowserSessionOperation, BrowserQuestionBudget } from "./browser-session-runtime";
import type { BrowserSessionWithdrawalReview } from "./browser-session-withdrawal-runtime";

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
  if (!browserPaymentProfile().testnet) {
    return new Worker(new URL("./mainnet-session-signer.worker.ts", import.meta.url), { type: "module" });
  }
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

  private call<T>(request: SignerRequestBody | BrowserSessionOperation): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...request, id } as SignerRequest);
    });
  }

  /** Hand the wallet signature straight to the worker; the key is derived on the other side. */
  async deriveFromSignature(signature: string): Promise<DerivedSession> {
    if (!browserPaymentProfile().testnet) throw new Error("Initialize retained mainnet custody before deriving");
    const session = await this.call<DerivedSession>({ type: "deriveFromSignature", signature });
    this.address = session.address;
    return session;
  }

  /** Rehydrate from tab-scoped ciphertext after a reload. */
  async restore(blob: WrappedKey): Promise<`0x${string}`> {
    if (!browserPaymentProfile().testnet) throw new Error("Restore the retained mainnet signer by owner");
    const { address } = await this.call<{ address: `0x${string}` }>({
      type: "restore",
      wrapped: blob.wrapped,
      iv: blob.iv,
    });
    this.address = address;
    return address;
  }

  async initializeOwner(owner: string): Promise<{ derivationMessage: string; storageNamespace: string }> {
    return this.call({ type: "initializeOwner", owner });
  }

  async deriveRetained(signature: `0x${string}`): Promise<`0x${string}`> {
    const result = await this.call<{ address: `0x${string}` }>({ type: "deriveFromSignature", signature });
    this.address = result.address; return result.address;
  }

  async restoreRetained(owner: string): Promise<`0x${string}`> {
    await this.initializeOwner(owner);
    const result = await this.call<{ address: `0x${string}` }>({ type: "restoreRetained" });
    this.address = result.address; return result.address;
  }

  async authorizePayment(reqId: string, question: BrowserQuestionBudget): Promise<string> {
    return (await this.call<{ paymentHeader: string }>({ type: "authorizePayment", reqId, question })).paymentHeader;
  }
  async signWithdrawal(requestId: string, review: BrowserSessionWithdrawalReview) {
    if (browserPaymentProfile().testnet) throw new Error("Use the original testnet cashout flow");
    return this.call<{ requestId: string; signature: `0x${string}` }>({ type: "signWithdrawal", requestId, review });
  }
  async cancelUnexposedWithdrawal(requestId: string) {
    if (browserPaymentProfile().testnet) throw new Error("Use the original testnet cashout flow");
    return this.call<{ requestId: string; cancelledUnexposed: true }>({ type: "cancelUnexposedWithdrawal", requestId });
  }
  async reconcileWithdrawal(requestId: string) {
    if (browserPaymentProfile().testnet) throw new Error("Use the original testnet cashout flow");
    return this.call<{ requestId: string; completed: boolean; status: string }>({ type: "reconcileWithdrawal", requestId });
  }

  bindGrant(): Promise<unknown> { return this.call({ type: "bindGrant" }); }
  signGrantConsentProof(consent: unknown, ownerSignature: `0x${string}`): Promise<`0x${string}`> {
    return this.call({ type: "signGrantConsentProof", consent, ownerSignature });
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
      signTransaction: async (transaction) => {
        if (!browserPaymentProfile().testnet) throw new Error("Mainnet session transaction signing refused");
        return this.call<`0x${string}`>({
          type: "signTransaction",
          transaction: toCloneableTransaction(transaction as unknown as Record<string, unknown>),
        });
      },
      signTypedData: async (payload) => {
        if (!browserPaymentProfile().testnet) throw new Error("Mainnet payments require an authenticated journal challenge");
        return this.call<`0x${string}`>({
          type: "signTypedData",
          payload: payload as unknown as TypedDataPayload,
        });
      },
    });
  }

  /** Mainnet locks heap custody and retains funded recovery; legacy testnet destroys its vault. */
  async clear(): Promise<void> {
    this.address = null;
    if (!browserPaymentProfile().testnet) { await this.call<null>({ type: "lock" }); return; }
    await this.call<null>({ type: "clear" }).catch(() => {
      /* the worker may already be gone — nothing left to protect */
    });
  }

  terminate(): void {
    this.worker.terminate();
    for (const slot of this.pending.values()) slot.reject(new Error("Session signer terminated"));
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

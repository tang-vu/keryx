import { concatHex, keccak256, recoverMessageAddress, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { browserSessionCustodyContext } from "./browser-session-custody";
import { createIsolatedSessionVault, type IsolatedWrappedKey, type WrappingKeyStore } from "./isolated-session-vault";
import { createSessionSigningPolicy } from "./session-signing-policy";
import type { TypedDataPayload } from "./session-signer-protocol";
import { parseSessionGrantConsent, createSessionGrantConsentMessage, createSessionGrantSignerProofMessage } from "../payments/session-grant-consent";
import { verifySessionWithdrawalPreparation } from "../gateway/session-withdrawal-protocol";
import { withdrawTypedData } from "../gateway/withdraw-protocol";
import { SessionCustodyMissingError } from "./session-custody-error";

export interface RetainedSessionStore {
  read(namespace: string): Promise<IsolatedWrappedKey | null>;
  /** Atomically keep the original funded signer, even when wallet signatures differ. */
  retain(namespace: string, blob: IsolatedWrappedKey): Promise<IsolatedWrappedKey>;
}

export function indexedDbRetainedSessionStore(): RetainedSessionStore {
  async function open(namespace: string) {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`${namespace}-recovery`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("custody");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Session recovery storage unavailable"));
    });
  }
  async function transact(namespace: string, blob?: IsolatedWrappedKey) {
    const db = await open(namespace);
    try {
      return await new Promise<IsolatedWrappedKey | null>((resolve, reject) => {
        const transaction = db.transaction("custody", blob ? "readwrite" : "readonly");
        const store = transaction.objectStore("custody"), request = store.get("original");
        let result: IsolatedWrappedKey | null = null;
        request.onsuccess = () => {
          result = request.result ?? blob ?? null;
          if (!request.result && blob) store.add(blob, "original");
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = transaction.onerror = () => reject(new Error("Session recovery storage unavailable"));
      });
    } finally { db.close(); }
  }
  return { read: namespace => transact(namespace), retain: async (namespace, blob) => {
    const result = await transact(namespace, structuredClone(blob));
    if (!result) throw new Error("Session recovery storage unavailable");
    return result;
  } };
}

/** Worker custody has no grant expiration. Payment admission enforces signed consent separately.
 * Lock invalidates in-flight results and forgets heap custody; it never deletes funded recovery.
 */
export function createBrowserSessionKey(origin: string, owner: string, dependencies: {
  wrappingKeys: WrappingKeyStore; retained: RetainedSessionStore;
}) {
  const context = browserSessionCustodyContext(ARC_MAINNET_PROFILE, origin, owner);
  const vault = createIsolatedSessionVault(context, dependencies.wrappingKeys);
  const policy = createSessionSigningPolicy(ARC_MAINNET_PROFILE);
  let account: PrivateKeyAccount | null = null, generation = 0, busy = false;
  const refused = (): never => { throw new Error("Browser session custody unavailable"); };
  async function load(blob: IsolatedWrappedKey) {
    const captured = structuredClone(blob), key = await vault.unwrap(captured);
    const restored = privateKeyToAccount(key as Hex);
    if (restored.address.toLowerCase() !== captured.address.toLowerCase()) refused();
    return restored;
  }
  async function lifecycle(operation: () => Promise<PrivateKeyAccount>) {
    if (busy) refused();
    busy = true; const expected = generation; account = null;
    try {
      const restored = await operation();
      if (generation !== expected) refused();
      account = restored; return { address: restored.address };
    } finally { busy = false; }
  }
  return Object.freeze({
    context,
    get address() { return account?.address ?? null; },
    derive(signature: Hex) {
      return lifecycle(async () => {
        if ((await recoverMessageAddress({ message: context.derivationMessage, signature })).toLowerCase() !== context.owner) refused();
        const retained = await dependencies.retained.read(context.storageNamespace);
        if (retained) return load(retained);
        const key = keccak256(concatHex([context.digest, signature]));
        const candidate = privateKeyToAccount(key), wrapped = await vault.wrap(key, candidate.address);
        // Publish only after both the wrapping key and original ciphertext are committed.
        return load(await dependencies.retained.retain(context.storageNamespace, wrapped));
      });
    },
    restore() {
      return lifecycle(async () => {
        const retained = await dependencies.retained.read(context.storageNamespace);
        if (!retained) throw new SessionCustodyMissingError();
        return load(retained);
      });
    },
    async signPayment(payload: TypedDataPayload) {
      const snapshot = structuredClone(payload), captured = account, expected = generation;
      if (!captured || busy) refused();
      policy.validatePayment(snapshot, captured!.address);
      const signature = await captured!.signTypedData(snapshot as Parameters<PrivateKeyAccount["signTypedData"]>[0]);
      if (generation !== expected || account !== captured) refused();
      return signature;
    },
    async signGrantConsentProof(value: unknown, ownerSignature: Hex) {
      const captured = account, expected = generation;
      if (!captured || busy) refused();
      const consent = parseSessionGrantConsent(structuredClone(value), ARC_MAINNET_PROFILE), now = Math.floor(Date.now()/1000);
      if (consent.ownerAddr !== context.owner || consent.sessAddr !== captured!.address.toLowerCase() || consent.origin !== context.origin ||
        BigInt(consent.expirySeconds) <= BigInt(now) || BigInt(consent.expirySeconds) > BigInt(now+86400) ||
        (await recoverMessageAddress({ message: createSessionGrantConsentMessage(consent, ARC_MAINNET_PROFILE), signature: ownerSignature })).toLowerCase() !== context.owner) refused();
      const signature = await captured!.signMessage({ message: createSessionGrantSignerProofMessage(consent, ARC_MAINNET_PROFILE) });
      if (generation !== expected || account !== captured) refused();
      return signature;
    },
    /** Internal restricted primitive. The worker separately admits the original request ID,
     * fresh balance/height and retained local exposure barrier before calling this method. */
    async signWithdrawalPreparation(value: unknown) {
      const snapshot = structuredClone(value), captured = account, expected = generation;
      if (!captured || busy) refused();
      const prepared = await verifySessionWithdrawalPreparation(snapshot);
      if (prepared.ownerAddr !== context.owner || prepared.sessAddr !== captured!.address.toLowerCase() ||
        prepared.authorization.consent.origin !== context.origin) refused();
      const signature = await captured!.signTypedData(withdrawTypedData(prepared.burnIntent));
      if (generation !== expected || account !== captured) refused();
      return signature;
    },
    lock() { generation += 1; account = null; },
  });
}

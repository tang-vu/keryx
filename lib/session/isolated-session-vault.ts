import type { IsolatedSessionContext } from "./isolated-session-context";

/** Implementations must atomically retain the first key for a namespace. Never reuse legacy keys. */
export interface WrappingKeyStore {
  getOrCreate(namespace: string, candidate: CryptoKey): Promise<CryptoKey>;
  destroy(namespace: string): Promise<void>;
}

export interface IsolatedWrappedKey {
  format: "keryx-isolated-session-v2";
  contextDigest: string;
  address: `0x${string}`;
  wrapped: Uint8Array;
  iv: Uint8Array;
}

/** Namespaced IndexedDB contains only a non-exportable wrapping key. Same-origin script can
 * still obtain its handle and decrypt available ciphertext; this is not an XSS boundary.
 */
export function indexedDbWrappingKeyStore(): WrappingKeyStore {
  async function database(namespace: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(namespace, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("wrap-keys");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("isolated session key store unavailable"));
    });
  }
  return {
    async getOrCreate(namespace, candidate) {
      const db = await database(namespace);
      try {
        return await new Promise<CryptoKey>((resolve, reject) => {
          const tx = db.transaction("wrap-keys", "readwrite");
          const store = tx.objectStore("wrap-keys");
          const request = store.get("wrapping-key-v2");
          let key: CryptoKey;
          request.onsuccess = () => {
            key = request.result ?? candidate;
            if (!request.result) store.add(candidate, "wrapping-key-v2");
          };
          tx.oncomplete = () => resolve(key);
          tx.onerror = tx.onabort = () => reject(new Error("isolated session key store unavailable"));
        });
      } finally { db.close(); }
    },
    async destroy(namespace) {
      const db = await database(namespace);
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("wrap-keys", "readwrite");
          tx.objectStore("wrap-keys").delete("wrapping-key-v2");
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => reject(new Error("isolated session key store unavailable"));
        });
      } finally { db.close(); }
    },
  };
}

/** Encryption authenticates the full identity and session address as additional data. */
export function createIsolatedSessionVault(context: Pick<IsolatedSessionContext, "storageNamespace" | "digest">, store: WrappingKeyStore) {
  const namespace = context.storageNamespace;
  const digest = context.digest;
  const getOrCreate = store.getOrCreate.bind(store), destroy = store.destroy.bind(store);
  async function key() {
    const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const retained = await getOrCreate(namespace, candidate);
    if (retained.type !== "secret" || retained.extractable || retained.algorithm.name !== "AES-GCM" ||
      (retained.algorithm as AesKeyAlgorithm).length !== 256 ||
      !retained.usages.includes("encrypt") || !retained.usages.includes("decrypt")) throw new Error("isolated session wrapping key refused");
    return retained;
  }
  function additionalData(address: string) { return new TextEncoder().encode(`${digest}\n${address.toLowerCase()}`); }
  return Object.freeze({
    async wrap(privateKey: string, address: `0x${string}`): Promise<IsolatedWrappedKey> {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(address) },
        await key(), new TextEncoder().encode(privateKey)));
      return { format: "keryx-isolated-session-v2", contextDigest: digest, address, wrapped, iv };
    },
    async unwrap(blob: IsolatedWrappedKey): Promise<string> {
      const snapshot = structuredClone(blob);
      if (!snapshot || Object.keys(snapshot).sort().join(",") !== "address,contextDigest,format,iv,wrapped" ||
        snapshot.format !== "keryx-isolated-session-v2" || snapshot.contextDigest !== digest ||
        !(snapshot.iv instanceof Uint8Array) || snapshot.iv.length !== 12 ||
        !(snapshot.wrapped instanceof Uint8Array) || snapshot.wrapped.length !== 82 ||
        !/^0x[0-9a-fA-F]{40}$/.test(snapshot.address)) throw new Error("isolated session ciphertext context refused");
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Uint8Array.from(snapshot.iv), additionalData: additionalData(snapshot.address) },
        await key(), Uint8Array.from(snapshot.wrapped));
      const decoded = new TextDecoder().decode(plain);
      if (!/^0x[0-9a-f]{64}$/.test(decoded)) throw new Error("isolated session plaintext refused");
      return decoded;
    },
    async destroy() { await destroy(namespace); },
  });
}

export type IsolatedSessionVault = ReturnType<typeof createIsolatedSessionVault>;

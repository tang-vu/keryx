/**
 * Wraps the session private key so it is never written anywhere in the clear.
 *
 * The wrapping key is an AES-GCM `CryptoKey` created with `extractable: false` and kept in
 * IndexedDB. No script can read its bytes — not ours, not an injected one — because the browser
 * only ever hands back a handle. The ciphertext it produces is what the tab persists.
 *
 * This does not make the key unreachable: script on this origin can still ask the browser to
 * decrypt with that handle. What it removes is the one-shot theft — `sessionStorage` used to hold
 * the raw key, so any XSS could exfiltrate a working private key with a single read, and keep
 * spending the funded session EOA long after the tab closed. Now the plaintext key exists only
 * inside the signer worker's memory.
 *
 * Runs inside the worker: IndexedDB and `crypto.subtle` are both available there, and keeping the
 * unwrap on that side means the main thread never touches key material at all.
 */

const DB_NAME = "keryx-session";
const STORE_NAME = "wrap-keys";
const KEY_ID = "session-wrap-v1";

/** Encrypted key material as it is handed to the main thread for tab-scoped storage. */
export interface WrappedKey {
  wrapped: Uint8Array;
  iv: Uint8Array;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("could not open the session key store"));
  });
}

function txRequest<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("session key store request failed"));
  });
}

/**
 * The origin's wrapping key, created on first use. `extractable: false` is the whole point:
 * `crypto.subtle.exportKey` on this handle throws, so the key cannot leave the browser.
 */
async function wrappingKey(): Promise<CryptoKey> {
  const db = await openDb();
  try {
    const existing = await txRequest<CryptoKey | undefined>(db, "readonly", (s) => s.get(KEY_ID));
    if (existing) return existing;

    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await txRequest(db, "readwrite", (s) => s.put(key, KEY_ID));
    return key;
  } finally {
    db.close();
  }
}

export async function wrapKey(privateKeyHex: string): Promise<WrappedKey> {
  const key = await wrappingKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(privateKeyHex)),
  );
  return { wrapped, iv };
}

export async function unwrapKey({ wrapped, iv }: WrappedKey): Promise<string> {
  const key = await wrappingKey();
  // Copy through Uint8Array.from: values arriving over postMessage are backed by an ArrayBufferLike,
  // which is not a BufferSource. The copy pins them to a plain ArrayBuffer.
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Uint8Array.from(iv) },
    key,
    Uint8Array.from(wrapped),
  );
  return new TextDecoder().decode(plain);
}

/** Forget the wrapping key, rendering every stored ciphertext permanently undecryptable. */
export async function destroyWrappingKey(): Promise<void> {
  const db = await openDb();
  try {
    await txRequest(db, "readwrite", (s) => s.delete(KEY_ID));
  } finally {
    db.close();
  }
}

export type BrowserStore = { database: string; store: string; keyPath: string; indexes: { name: string; keyPath: string; unique?: boolean }[] };

function openDatabase(spec: BrowserStore): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => { finished = true; reject(new Error("Buyer storage did not open in time")); }, 8000);
    try {
      const request = globalThis.indexedDB.open(spec.database, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(spec.store, { keyPath: spec.keyPath });
        for (const index of spec.indexes) store.createIndex(index.name, index.keyPath, { unique: index.unique ?? false });
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (finished) { request.result.close(); return; }
        finished = true;
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      const refuse = () => { clearTimeout(timer); finished = true; reject(new Error("Buyer storage is unavailable or blocked")); };
      request.onerror = refuse;
      request.onblocked = refuse;
    } catch { clearTimeout(timer); finished = true; reject(new Error("Buyer storage is unavailable")); }
  });
}

/** Resolve on transaction completion, never on a successful individual write request. */
export async function browserTransaction<T>(spec: BrowserStore, mode: IDBTransactionMode, work: (
  store: IDBObjectStore, done: (result: T) => void, fail: () => void,
) => void): Promise<T> {
  const db = await openDatabase(spec);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(spec.store, mode, { durability: "strict" });
      let value: T;
      let ready = false;
      const timer = setTimeout(() => { try { tx.abort(); } catch { /* already terminal */ } reject(new Error("Buyer storage transaction timed out")); }, 8000);
      tx.oncomplete = () => { clearTimeout(timer); if (ready) resolve(value); else reject(new Error("Buyer storage returned no result")); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(new Error("Buyer storage transaction failed")); };
      const fail = () => { try { tx.abort(); } catch { /* already terminal */ } clearTimeout(timer); reject(new Error("Buyer journal validation failed")); };
      try { work(tx.objectStore(spec.store), result => { value = result; ready = true; }, fail); }
      catch { fail(); }
    });
  } finally { db.close(); }
}


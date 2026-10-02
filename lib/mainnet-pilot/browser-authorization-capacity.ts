/** Conservative cross-tab signed capacity. Never store signatures, and never refund a failed
 * signing/submission: an authorization may have escaped. Retained after logout/key deletion.
 */
export async function reserveBrowserPilotAuthorization(namespace: string, nonce: string, amount: bigint, cap: bigint): Promise<void> {
  if (!/^0x[0-9a-f]{64}$/.test(nonce) || amount <= BigInt(0) || cap <= BigInt(0)) throw new Error("pilot authorization reservation refused");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`${namespace}-authorizations`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("capacity");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("pilot authorization capacity unavailable"));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("capacity", "readwrite"), store = tx.objectStore("capacity");
      const current = store.get("state"); let reason = "pilot authorization capacity unavailable";
      current.onsuccess = () => {
        const state = current.result as { total: string; nonces: string[] } | undefined;
        if (state && (!/^(0|[1-9]\d*)$/.test(state.total) || !Array.isArray(state.nonces) ||
          state.nonces.length > 1000 || state.nonces.some(n => !/^0x[0-9a-f]{64}$/.test(n)))) { tx.abort(); return; }
        const total = BigInt(state?.total ?? "0"), nonces = state?.nonces ?? [];
        if (nonces.includes(nonce) || nonces.length >= 1000 || total + amount > cap) {
          reason = "pilot nonce reused or signed capacity exhausted"; tx.abort(); return;
        }
        store.put({ total: (total + amount).toString(), nonces: [...nonces, nonce] }, "state");
      };
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error(reason));
    });
  } finally { db.close(); }
}

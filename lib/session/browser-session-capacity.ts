/** Cross-tab reservation is retained before cryptography. No failure, logout or timeout releases
 * it. The owner signs an absolute lifetime signer cap. A new epoch never resets accumulated
 * exposure, and no epoch can reuse an already reserved authorization nonce.
 */
export async function reserveBrowserSessionAuthorization(namespace: string, epoch: string, nonce: string,
  amount: bigint, cap: bigint): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(epoch) || !/^0x[0-9a-f]{64}$/.test(nonce) || amount <= BigInt(0) || cap <= BigInt(0) ||
    cap > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Session reservation refused");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`${namespace}-authorizations`, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("nonces"); request.result.createObjectStore("grants"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Session capacity unavailable"));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["nonces", "grants"], "readwrite"), nonces = tx.objectStore("nonces"), grants = tx.objectStore("grants");
      const nonceRead = nonces.get(nonce), capacityRead = grants.get("signed-total"), epochRead = grants.get(epoch);
      let seen = false, capacityLoaded = false, epochLoaded = false;
      let previous: { total: string } | undefined, previousConsent: { cap: string } | undefined;
      let reason = "Session capacity unavailable";
      function reserve() {
        if (!seen || !capacityLoaded || !epochLoaded) return;
        if (nonceRead.result !== undefined || (previous && !/^(0|[1-9]\d*)$/.test(previous.total)) ||
          (previousConsent && previousConsent.cap !== cap.toString()) ||
          BigInt(previous?.total ?? "0") + amount > cap) {
          reason = "Session nonce reused or consent capacity exhausted"; tx.abort(); return;
        }
        nonces.add({ epoch, amount: amount.toString() }, nonce);
        grants.put({ cap: cap.toString() }, epoch);
        grants.put({ total: (BigInt(previous?.total ?? "0") + amount).toString() }, "signed-total");
      }
      nonceRead.onsuccess = () => { seen = true; reserve(); };
      capacityRead.onsuccess = () => { capacityLoaded = true; previous = capacityRead.result; reserve(); };
      epochRead.onsuccess = () => { epochLoaded = true; previousConsent = epochRead.result; reserve(); };
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error(reason));
    });
  } finally { db.close(); }
}

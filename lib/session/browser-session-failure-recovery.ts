import { canonicalJson } from "../canonical-json";
import { readBrowserSessionPaymentAccounting, type BrowserSessionFailedAuthorization } from "./browser-session-withdrawal-liabilities";
import { browserSessionExposureTransaction, openBrowserSessionExposure, readBrowserSessionExposure,
  type LocalSessionAuthorization } from "./browser-session-withdrawal-storage";

/** Retain the original nonce forever. A separate, immutable-by-CAS terminal marker
 * releases its local capacity once; a new epoch cannot release it again. */
export async function releaseBrowserSessionFailedAuthorizations(namespace: string, failures: readonly BrowserSessionFailedAuthorization[]) {
  if (!failures.length) return 0;
  const originalFailures = structuredClone(failures);
  const db = await openBrowserSessionExposure(namespace);
  let released = 0;
  try {
    for (const failure of originalFailures) {
      if (!/^0x[0-9a-f]{64}$/.test(failure.nonce) || !/^[1-9]\d{0,15}$/.test(failure.amount) ||
        BigInt(failure.amount) > BigInt(Number.MAX_SAFE_INTEGER) || !/^[0-9a-f]{64}$/.test(failure.evidenceDigest) ||
        !failure.transferId.trim()) throw new Error("Original failed authorization unavailable");
      await new Promise<void>((resolve, reject) => {
        const tx = browserSessionExposureTransaction(db, ["nonces", "grants"], "readwrite");
        const grants = tx.objectStore("grants"), nonce = tx.objectStore("nonces").get(failure.nonce);
        const terminal = grants.get(`failure:${failure.nonce}`), capacity = grants.get("signed-total"), version = grants.get("authorization-version");
        let ready = 0;
        const check = () => {
          if (++ready !== 4) return;
          const row = nonce.result as Omit<LocalSessionAuthorization, "nonce"> | undefined;
          if (!row || !row.original || row.epoch !== failure.epoch || row.amount !== failure.amount ||
            row.requirementsDigest !== failure.requirementsDigest || canonicalJson(row.original) !== canonicalJson(failure.original)) { tx.abort(); return; }
          const proof = { amount: failure.amount, epoch: failure.epoch, transferId: failure.transferId, evidenceDigest: failure.evidenceDigest };
          if (terminal.result !== undefined) {
            if (canonicalJson(terminal.result) !== canonicalJson(proof)) tx.abort();
            return;
          }
          if (!/^(0|[1-9]\d{0,15})$/.test(capacity.result?.total ?? "") ||
            !/^(0|[1-9]\d*)$/.test(version.result ?? "0") || BigInt(capacity.result.total) < BigInt(failure.amount)) { tx.abort(); return; }
          grants.add(proof, `failure:${failure.nonce}`);
          grants.put({ total: String(BigInt(capacity.result.total) - BigInt(failure.amount)) }, "signed-total");
          grants.put(String(BigInt(version.result ?? "0") + BigInt(1)), "authorization-version");
          // Question totals remain conservative. Old originals do not retain a
          // question identifier, and recovery never invents that association.
          released++;
        };
        nonce.onsuccess = terminal.onsuccess = capacity.onsuccess = version.onsuccess = check;
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(new Error("Original failed authorization recovery refused"));
      });
    }
  } finally { db.close(); }
  return released;
}

export async function reconcileBrowserSessionFailedAuthorizations(namespace: string, owner: string, signer: string,
  epoch: string, json: (path: string) => Promise<unknown>) {
  const snapshot = await readBrowserSessionExposure(namespace);
  const result = await readBrowserSessionPaymentAccounting(snapshot.authorizations, owner, signer, epoch, json);
  return releaseBrowserSessionFailedAuthorizations(namespace, result.failures);
}

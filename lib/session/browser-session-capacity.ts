import type { BrowserSessionAuthorizationBinding } from "./browser-session-runtime";
import { canonicalJson } from "../canonical-json";
import { openBrowserSessionExposure, browserSessionExposureTransaction } from "./browser-session-withdrawal-storage";
/** Cross-tab reservation is retained before cryptography. No failure, logout or timeout releases
 * it. The owner signs an absolute lifetime signer cap. A new epoch never resets accumulated
 * exposure, and no epoch can reuse an already reserved authorization nonce.
 */
export async function reserveBrowserSessionAuthorization(namespace: string, epoch: string, nonce: string,
  amount: bigint, cap: bigint, question?: { id: string; budgetMicroUsdc: string }, original?: BrowserSessionAuthorizationBinding): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(epoch) || !/^0x[0-9a-f]{64}$/.test(nonce) || amount <= BigInt(0) || cap <= BigInt(0) ||
    cap > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Session reservation refused");
  const scope = question ? { ...question } : undefined;
  if (scope && (!/^[0-9a-f-]{36}$/.test(scope.id) || !/^[1-9]\d{0,15}$/.test(scope.budgetMicroUsdc) ||
    BigInt(scope.budgetMicroUsdc) > BigInt(Number.MAX_SAFE_INTEGER))) throw new Error("Question reservation refused");
  const binding = original ? structuredClone(original) : undefined;
  if (binding && (binding.expectedNonce !== nonce || binding.grantEpoch !== epoch || binding.requirements.amount !== amount.toString()))
    throw new Error("Original reservation differs");
  const digest = binding ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(binding.requirements)))),
    byte => byte.toString(16).padStart(2, "0")).join("") : undefined;
  const db = await openBrowserSessionExposure(namespace);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = browserSessionExposureTransaction(db, ["nonces", "grants"], "readwrite"), nonces = tx.objectStore("nonces"), grants = tx.objectStore("grants");
      const nonceRead = nonces.get(nonce), capacityRead = grants.get("signed-total"), epochRead = grants.get(epoch);
      const questionRead = scope ? grants.get(`question:${scope.id}`) : undefined;
      const withdrawalRead = grants.get("active-withdrawal"), versionRead = grants.get("authorization-version");
      let seen = false, capacityLoaded = false, epochLoaded = false, questionLoaded = !scope, withdrawalLoaded = false, versionLoaded = false;
      let previous: { total: string } | undefined, previousConsent: { cap: string } | undefined;
      let previousQuestion: { cap: string; total: string } | undefined;
      let reason = "Session capacity unavailable";
      function reserve() {
        if (!seen || !capacityLoaded || !epochLoaded || !questionLoaded || !withdrawalLoaded || !versionLoaded) return;
        if (withdrawalRead.result !== undefined || !/^(0|[1-9]\d*)$/.test(versionRead.result ?? "0") ||
          nonceRead.result !== undefined || (previous && !/^(0|[1-9]\d*)$/.test(previous.total)) ||
          (previousConsent && previousConsent.cap !== cap.toString()) ||
          BigInt(previous?.total ?? "0") + amount > cap || (scope && (
            (previousQuestion && (previousQuestion.cap !== scope.budgetMicroUsdc || !/^(0|[1-9]\d*)$/.test(previousQuestion.total))) ||
            BigInt(previousQuestion?.total ?? "0")+amount > BigInt(scope.budgetMicroUsdc)))) {
          reason = "Session nonce reused or consent capacity exhausted"; tx.abort(); return;
        }
        nonces.add({ epoch, amount: amount.toString(), ...(binding ? { original: binding, requirementsDigest: digest } : {}) }, nonce);
        grants.put({ cap: cap.toString() }, epoch);
        grants.put({ total: (BigInt(previous?.total ?? "0") + amount).toString() }, "signed-total");
        grants.put((BigInt(versionRead.result ?? "0")+BigInt(1)).toString(), "authorization-version");
        if (scope) grants.put({ cap: scope.budgetMicroUsdc,
          total: (BigInt(previousQuestion?.total ?? "0")+amount).toString() }, `question:${scope.id}`);
      }
      nonceRead.onsuccess = () => { seen = true; reserve(); };
      capacityRead.onsuccess = () => { capacityLoaded = true; previous = capacityRead.result; reserve(); };
      epochRead.onsuccess = () => { epochLoaded = true; previousConsent = epochRead.result; reserve(); };
      withdrawalRead.onsuccess = () => { withdrawalLoaded = true; reserve(); };
      versionRead.onsuccess = () => { versionLoaded = true; reserve(); };
      if (questionRead) questionRead.onsuccess = () => { questionLoaded = true; previousQuestion = questionRead.result; reserve(); };
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error(reason));
    });
  } finally { db.close(); }
}

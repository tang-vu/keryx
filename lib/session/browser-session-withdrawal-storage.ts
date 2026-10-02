import { canonicalJson } from "../canonical-json";
import type { BrowserSessionAuthorizationBinding } from "./browser-session-runtime";
import type { SessionWithdrawalPreparation } from "../gateway/session-withdrawal-protocol";
import type { OwnerWalletMintAttempt } from "../gateway/withdrawal-owner-wallet-mint";

export type LocalSessionAuthorization = { nonce: string; epoch: string; amount: string;
  original?: BrowserSessionAuthorizationBinding; requirementsDigest?: string };
export type BrowserSessionOwnerMint = OwnerWalletMintAttempt;
export type BrowserWithdrawalReservation = { preparation: SessionWithdrawalPreparation; exposed?: true; signature?: string;
  completion?: unknown; cancelled?: true; submissionPossible?: true; mint?: BrowserSessionOwnerMint };

/** Uses the existing lifetime exposure database. A withdrawal never deletes old nonces,
 * payment consumption, consent epochs or historical withdrawal identities. */
export async function openBrowserSessionExposure(namespace: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`${namespace}-authorizations`, 1);
    let finished = false;
    const failed = () => { if (finished) return; finished = true; clearTimeout(timer); reject(new Error("Retained session exposure unavailable")); };
    const timer = setTimeout(failed, 8000);
    request.onupgradeneeded = () => { request.result.createObjectStore("nonces"); request.result.createObjectStore("grants"); };
    request.onsuccess = () => { if (finished) { request.result.close(); return; }
      finished = true; clearTimeout(timer); request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = request.onblocked = failed;
  });
}
/** Exposure must commit durably before any signature or transaction can leave the browser. */
export function browserSessionExposureTransaction(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode) {
  const transaction = db.transaction(stores, mode, { durability: "strict" });
  const timer = setTimeout(() => { try { transaction.abort(); } catch { /* Already completed. */ } }, 8000);
  for (const event of ["complete", "abort", "error"]) transaction.addEventListener(event, () => clearTimeout(timer), { once: true });
  return transaction;
}
/** One local submission/mint slot is committed before network or owner-wallet delivery.
 * A missing response never resets that slot or authorizes an automatic resend. */
export async function claimBrowserSessionWithdrawalDelivery(namespace: string, preparation: SessionWithdrawalPreparation,
  selected: { submissionPossible: true } | { mint: BrowserSessionOwnerMint }) {
  const snapshot=structuredClone({preparation,selected}),db=await openBrowserSessionExposure(namespace);
  try{return await new Promise<boolean>((resolve,reject)=>{
    const tx=browserSessionExposureTransaction(db,"grants","readwrite"),store=tx.objectStore("grants"),read=store.get(`withdrawal:${snapshot.preparation.requestId}`);let admitted=false;
    read.onsuccess=()=>{const row=read.result as BrowserWithdrawalReservation|undefined;
      if(!row||canonicalJson(row.preparation)!==canonicalJson(snapshot.preparation)||!row.signature||row.cancelled||row.completion){tx.abort();return}
      if("mint"in snapshot.selected?row.mint:row.submissionPossible)return;
      store.put({...row,...snapshot.selected},`withdrawal:${snapshot.preparation.requestId}`);admitted=true;
    };
    tx.oncomplete=()=>resolve(admitted);tx.onabort=tx.onerror=()=>reject(new Error("Original withdrawal delivery unavailable"));
  })}finally{db.close()}
}
export async function retainBrowserSessionOwnerMintHash(namespace:string,preparation:SessionWithdrawalPreparation,hash:string){
  if(!/^0x[0-9a-f]{64}$/.test(hash))throw new Error("Owner mint response unavailable");
  const snapshot=structuredClone(preparation),db=await openBrowserSessionExposure(namespace);
  try{await new Promise<void>((resolve,reject)=>{
    const tx=browserSessionExposureTransaction(db,"grants","readwrite"),store=tx.objectStore("grants"),read=store.get(`withdrawal:${snapshot.requestId}`);
    read.onsuccess=()=>{const row=read.result as BrowserWithdrawalReservation|undefined;
      if(!row?.mint||canonicalJson(row.preparation)!==canonicalJson(snapshot)||row.mint.hash&&row.mint.hash!==hash){tx.abort();return}
      store.put({...row,mint:{...row.mint,hash}},`withdrawal:${snapshot.requestId}`);
    };
    tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error("Owner mint original differs"));
  })}finally{db.close()}
}
export async function readBrowserSessionExposure(namespace: string) {
  const db = await openBrowserSessionExposure(namespace);
  try {
    return await new Promise<{ version: string; authorizations: LocalSessionAuthorization[]; withdrawal: string | null }>((resolve, reject) => {
      const tx = browserSessionExposureTransaction(db,["nonces", "grants"], "readonly"), rows: LocalSessionAuthorization[] = [];
      const grants = tx.objectStore("grants"), version = grants.get("authorization-version"), barrier = grants.get("active-withdrawal");
      const cursor = tx.objectStore("nonces").openCursor();
      cursor.onsuccess = () => { const item = cursor.result; if (item) { rows.push({ ...item.value, nonce: String(item.key) }); item.continue(); } };
      tx.oncomplete = () => resolve({ version: version.result ?? "0", authorizations: rows, withdrawal: barrier.result ?? null });
      tx.onabort = tx.onerror = () => reject(new Error("Retained session exposure unavailable"));
    });
  } finally { db.close(); }
}
export async function readBrowserSessionWithdrawal(namespace: string, requestId: string) {
  const db = await openBrowserSessionExposure(namespace);
  try { return await new Promise<BrowserWithdrawalReservation | null>((resolve, reject) => {
    const tx = browserSessionExposureTransaction(db,"grants", "readonly"), read = tx.objectStore("grants").get(`withdrawal:${requestId}`);
    tx.oncomplete = () => resolve(read.result ?? null);
    tx.onabort = tx.onerror = () => reject(new Error("Original withdrawal unavailable"));
  }); } finally { db.close(); }
}
/** Public original references for reload/recovery; never return a burn signature here. */
export async function listBrowserSessionWithdrawalReferences(namespace: string) {
  const db=await openBrowserSessionExposure(namespace);
  try{return await new Promise<Array<{requestId:string;grantEpoch:string;amountMicroUsdc:string;mintHash?:string;completed:boolean;cancelled:boolean}>>((resolve,reject)=>{
    const tx=browserSessionExposureTransaction(db,"grants","readonly"),cursor=tx.objectStore("grants").openCursor();
    const rows:Array<{requestId:string;grantEpoch:string;amountMicroUsdc:string;mintHash?:string;completed:boolean;cancelled:boolean}>=[];
    cursor.onsuccess=()=>{const item=cursor.result;if(!item)return;
      if(String(item.key).startsWith("withdrawal:")){const row=item.value as BrowserWithdrawalReservation;
        rows.push({requestId:row.preparation.requestId,grantEpoch:row.preparation.grantEpoch,amountMicroUsdc:row.preparation.burnIntent.spec.value,
          ...(row.mint?.hash?{mintHash:row.mint.hash}:{}),completed:!!row.completion,cancelled:!!row.cancelled})}
      item.continue();
    };
    tx.oncomplete=()=>resolve(rows);tx.onabort=tx.onerror=()=>reject(new Error("Original cashout references unavailable"));
  })}finally{db.close()}
}
export async function reserveBrowserSessionWithdrawal(namespace: string, preparation: SessionWithdrawalPreparation, expectedVersion: string) {
  const original = structuredClone(preparation), db = await openBrowserSessionExposure(namespace);
  try { await new Promise<void>((resolve, reject) => {
    const tx = browserSessionExposureTransaction(db,"grants", "readwrite"), store = tx.objectStore("grants");
    const active = store.get("active-withdrawal"), version = store.get("authorization-version"), seen = store.get(`withdrawal:${original.requestId}`);
    let ready = 0;
    const checked = () => { if (++ready !== 3) return;
      if ((version.result ?? "0") !== expectedVersion || active.result !== undefined || seen.result !== undefined) { tx.abort(); return; }
      store.add({ preparation: original }, `withdrawal:${original.requestId}`); store.put(original.requestId, "active-withdrawal");
    };
    active.onsuccess = version.onsuccess = seen.onsuccess = checked;
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error("Withdrawal or payment exposure changed"));
  }); } finally { db.close(); }
}
export async function retainBrowserSessionWithdrawalOutcome(namespace: string, preparation: SessionWithdrawalPreparation,
  outcome: { exposed: true } | { signature: string } | { completion: unknown }) {
  const snapshot = structuredClone({ preparation, outcome }), db = await openBrowserSessionExposure(namespace);
  try { await new Promise<void>((resolve, reject) => {
    const tx = browserSessionExposureTransaction(db,"grants", "readwrite"), store = tx.objectStore("grants"), read = store.get(`withdrawal:${snapshot.preparation.requestId}`);
    const active = store.get("active-withdrawal"); let ready = 0;
    const checked = () => { if (++ready !== 2) return;
      const row = read.result as BrowserWithdrawalReservation | undefined;
      if (!row || canonicalJson(row.preparation) !== canonicalJson(snapshot.preparation) ||
        active.result !== snapshot.preparation.requestId || row.completion || row.cancelled ||
        ("signature" in snapshot.outcome && !row.exposed) ||
        ("signature" in snapshot.outcome && row.signature && row.signature !== snapshot.outcome.signature)) { tx.abort(); return; }
      store.put({ ...row, ...snapshot.outcome }, `withdrawal:${snapshot.preparation.requestId}`);
      if ("completion" in snapshot.outcome) store.delete("active-withdrawal");
    };
    read.onsuccess = active.onsuccess = checked;
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error("Original withdrawal outcome refused"));
  }); } finally { db.close(); }
}
export async function cancelUnexposedBrowserWithdrawal(namespace: string, preparation: SessionWithdrawalPreparation) {
  const snapshot = structuredClone(preparation), db = await openBrowserSessionExposure(namespace);
  try { await new Promise<void>((resolve, reject) => {
    const tx = browserSessionExposureTransaction(db,"grants", "readwrite"), store = tx.objectStore("grants"), read = store.get(`withdrawal:${snapshot.requestId}`);
    const active = store.get("active-withdrawal"); let ready = 0;
    const checked = () => { if (++ready !== 2) return;
      const row = read.result as BrowserWithdrawalReservation | undefined;
      if (!row) return; // No local reservation exists to release.
      if (canonicalJson(row.preparation) !== canonicalJson(snapshot) || active.result !== snapshot.requestId ||
        row.exposed || row.signature || row.completion || row.cancelled) { tx.abort(); return; }
      store.put({ ...row, cancelled: true }, `withdrawal:${snapshot.requestId}`); store.delete("active-withdrawal");
    };
    read.onsuccess = active.onsuccess = checked;
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error("Exposed withdrawal cannot be cancelled"));
  }); } finally { db.close(); }
}

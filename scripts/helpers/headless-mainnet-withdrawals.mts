import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../../lib/canonical-json";
import type { BrowserSessionCustodyContext } from "../../lib/session/browser-session-custody";
import type { BrowserSessionAuthorizationBinding } from "../../lib/session/browser-session-runtime";
import type { SessionWithdrawalRuntimeStorage } from "../../lib/session/browser-session-withdrawal-runtime";
import type { BrowserWithdrawalReservation } from "../../lib/session/browser-session-withdrawal-storage";
import { parseSessionWithdrawalPreparation, type SessionWithdrawalPreparation } from "../../lib/gateway/session-withdrawal-protocol";
import type { OwnerWalletMintAttempt } from "../../lib/gateway/withdrawal-owner-wallet-mint";
import { verifySessionWithdrawalCompletion } from "../../lib/gateway/session-withdrawal-completion";
import { decodeFunctionData, encodeFunctionData, keccak256, parseTransaction } from "viem";
import { z } from "zod";
import { ARC_MAINNET_PROFILE } from "../../lib/arc-network-profile";
import { WITHDRAWAL_MINTER_ABI } from "../../lib/gateway/withdrawal-mint-observation";
import { verifySessionWithdrawalAbort } from "../../lib/gateway/session-withdrawal-abort";

const refuse = (): never => { throw new Error("Original headless cashout unavailable; preserve custody and original attempts"); };
type Stored = Omit<BrowserWithdrawalReservation, "signature"> & { signatureCipher?: { iv: string; encrypted: string } };
const uint=z.string().regex(/^(0|[1-9]\d{0,77})$/).refine(v=>BigInt(v)<(BigInt(1)<<BigInt(256)));
const mintSchema=z.object({to:z.literal(ARC_MAINNET_PROFILE.gatewayMinter.toLowerCase()),data:z.string().regex(/^0x(?:[0-9a-f]{2})+$/).max(32768),value:z.literal("0"),
  nonce:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),gas:uint.refine(v=>BigInt(v)>BigInt(0)),maxFeePerGas:uint.refine(v=>BigInt(v)>BigInt(0)),
  maxPriorityFeePerGas:uint,hash:z.string().regex(/^0x[0-9a-f]{64}$/).optional()}).strict().refine(v=>BigInt(v.maxPriorityFeePerGas)<=BigInt(v.maxFeePerGas));
function validatedMint(value:unknown):OwnerWalletMintAttempt {
  const mint=mintSchema.parse(value),decoded=decodeFunctionData({abi:WITHDRAWAL_MINTER_ABI,data:mint.data as `0x${string}`});
  if(decoded.functionName!=="gatewayMint"||encodeFunctionData({abi:WITHDRAWAL_MINTER_ABI,functionName:decoded.functionName,args:decoded.args})!==mint.data)refuse();
  return mint;
}
export const HEADLESS_WITHDRAWAL_SCHEMA = `
CREATE TABLE upgrade_history(singleton INTEGER PRIMARY KEY CHECK(singleton=1),value TEXT NOT NULL) STRICT;
CREATE TRIGGER upgrade_no_update BEFORE UPDATE ON upgrade_history BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER upgrade_no_delete BEFORE DELETE ON upgrade_history BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TABLE withdrawals(id TEXT PRIMARY KEY,value TEXT NOT NULL CHECK(json_valid(value))) STRICT;
CREATE TRIGGER withdrawals_no_delete BEFORE DELETE ON withdrawals BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER withdrawals_original BEFORE UPDATE ON withdrawals WHEN
  new.id IS NOT old.id OR json_extract(new.value,'$.preparation') IS NOT json_extract(old.value,'$.preparation') OR
  (json_extract(old.value,'$.exposed')=1 AND json_extract(new.value,'$.exposed') IS NOT 1) OR
  (json_extract(old.value,'$.signatureCipher') IS NOT NULL AND json_extract(new.value,'$.signatureCipher') IS NOT json_extract(old.value,'$.signatureCipher')) OR
  (json_extract(old.value,'$.submissionPossible')=1 AND json_extract(new.value,'$.submissionPossible') IS NOT 1) OR
  (json_extract(old.value,'$.mint') IS NOT NULL AND (json_extract(new.value,'$.mint.to') IS NOT json_extract(old.value,'$.mint.to') OR
    json_extract(new.value,'$.mint.data') IS NOT json_extract(old.value,'$.mint.data') OR json_extract(new.value,'$.mint.value') IS NOT json_extract(old.value,'$.mint.value') OR json_extract(new.value,'$.mint.nonce') IS NOT json_extract(old.value,'$.mint.nonce') OR
    json_extract(new.value,'$.mint.gas') IS NOT json_extract(old.value,'$.mint.gas') OR json_extract(new.value,'$.mint.maxFeePerGas') IS NOT json_extract(old.value,'$.mint.maxFeePerGas') OR
    json_extract(new.value,'$.mint.maxPriorityFeePerGas') IS NOT json_extract(old.value,'$.mint.maxPriorityFeePerGas') OR
    (json_extract(old.value,'$.mint.hash') IS NOT NULL AND json_extract(new.value,'$.mint.hash') IS NOT json_extract(old.value,'$.mint.hash')))) OR
  (json_extract(old.value,'$.cancelled')=1 OR json_extract(old.value,'$.completion') IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'immutable original'); END;
CREATE TRIGGER exposure_withdrawal_fence BEFORE INSERT ON exposure WHEN
  (SELECT json_extract(value,'$.format') FROM identity WHERE singleton=1) IS NOT 'keryx-headless-session-state-v3' OR
  EXISTS(SELECT 1 FROM withdrawals WHERE json_extract(value,'$.cancelled') IS NOT 1 AND json_extract(value,'$.completion') IS NULL)
BEGIN SELECT RAISE(ABORT,'cashout barrier'); END;
`;

export const HEADLESS_WITHDRAWAL_V4_SCHEMA = `
CREATE TABLE upgrade_v4_history(singleton INTEGER PRIMARY KEY CHECK(singleton=1),value TEXT NOT NULL) STRICT;
CREATE TRIGGER upgrade_v4_no_update BEFORE UPDATE ON upgrade_v4_history BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER upgrade_v4_no_delete BEFORE DELETE ON upgrade_v4_history BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TABLE publication_aborts(id TEXT PRIMARY KEY REFERENCES withdrawals(id),pending INTEGER NOT NULL CHECK(pending IN(0,1)),
  proof TEXT CHECK(proof IS NULL OR json_valid(proof)),CHECK((pending=1 AND proof IS NULL) OR (pending=0 AND proof IS NOT NULL))) STRICT;
CREATE TRIGGER publication_aborts_no_delete BEFORE DELETE ON publication_aborts BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER publication_aborts_original BEFORE UPDATE ON publication_aborts WHEN
  old.pending<>1 OR new.pending<>0 OR old.id IS NOT new.id OR new.proof IS NULL
BEGIN SELECT RAISE(ABORT,'immutable abort'); END;
DROP TRIGGER exposure_withdrawal_fence;
CREATE TRIGGER exposure_withdrawal_fence BEFORE INSERT ON exposure WHEN
  (SELECT json_extract(value,'$.format') FROM identity WHERE singleton=1) IS NOT 'keryx-headless-session-state-v4' OR
  EXISTS(SELECT 1 FROM withdrawals WHERE json_extract(value,'$.cancelled') IS NOT 1 AND json_extract(value,'$.completion') IS NULL) OR
  EXISTS(SELECT 1 FROM publication_aborts WHERE pending=1)
BEGIN SELECT RAISE(ABORT,'cashout barrier'); END;
`;

/** Native injection for the reviewed browser cashout policy. One SQLite writer
 * owns both payment exposure and original cashout barriers, never a second ledger. */
export function headlessWithdrawalStorage(db: DatabaseSync, context: BrowserSessionCustodyContext,
  active: () => void, sync: () => void, aes: CryptoKey) {
  const namespace = (value: string) => { active(); if (value !== context.storageNamespace) refuse(); };
  const original = (value: SessionWithdrawalPreparation) => {
    active(); const p = parseSessionWithdrawalPreparation(structuredClone(value));
    const custody = db.prepare("SELECT value FROM custody WHERE singleton=1").get();
    if (!custody || p.ownerAddr !== context.owner || p.authorization.consent.origin !== context.origin ||
      p.sessAddr !== String(JSON.parse(String(custody.value)).address).toLowerCase()) refuse();
    return p;
  };
  const rows = () => db.prepare("SELECT id,value FROM withdrawals ORDER BY id").all();
  const get = (id: string): Stored | null => {
    active(); if (!/^0x[0-9a-f]{64}$/.test(id)) refuse();
    const row = db.prepare("SELECT value FROM withdrawals WHERE id=?").get(id);
    const parsed=row ? JSON.parse(String(row.value)) as Stored : null;
    const abort=db.prepare("SELECT pending,proof FROM publication_aborts WHERE id=?").get(id);
    if(abort){if(!parsed)return refuse();if(!parsed.cancelled||parsed.signatureCipher||parsed.submissionPossible||parsed.mint||parsed.completion)refuse();
      parsed.publicationAbort={pending:abort.pending===1,...(abort.proof?{proof:JSON.parse(String(abort.proof))}:{})};}
    if(parsed?.mint)validatedMint(parsed.mint);return parsed;
  };
  const activeWithdrawal = () => {
    active(); const pending = rows().filter(row => { const v=get(String(row.id))!; return v.publicationAbort?.pending || !v.cancelled && !v.completion; });
    if (pending.length > 1) refuse(); return pending.length ? String(pending[0].id) : null;
  };
  const version = () => `${db.prepare("SELECT COUNT(*) AS n FROM exposure").get()!.n}:${db.prepare("SELECT COUNT(*) AS n FROM terminal").get()!.n}:${db.prepare("SELECT COUNT(*) AS n FROM failed_terminal").get()!.n}`;
  const transaction = <T,>(callback: () => T): T => {
    active(); db.exec("BEGIN IMMEDIATE");
    try { active(); const result=callback(); db.exec("COMMIT"); sync(); return result; }
    catch { try { db.exec("ROLLBACK"); } catch { /* Retain uncertain committed original. */ } return refuse(); }
  };
  const save = (id: string, value: Stored) => { const text=canonicalJson(value); if(Buffer.byteLength(text)>65536)refuse(); db.prepare("UPDATE withdrawals SET value=? WHERE id=?").run(text,id); };
  const exact = (p: SessionWithdrawalPreparation, row: Stored | null) => {
    if (!row || canonicalJson(row.preparation)!==canonicalJson(p)) return refuse(); return row;
  };
  const storage: SessionWithdrawalRuntimeStorage = {
    async readExposure(value) {
      namespace(value);
      return { version: version(), withdrawal: activeWithdrawal(), authorizations: db.prepare("SELECT nonce,epoch,amount,original,requirements_digest FROM exposure ORDER BY nonce").all().map(row=>({
        nonce:String(row.nonce),epoch:String(row.epoch),amount:String(row.amount),original:JSON.parse(String(row.original)) as BrowserSessionAuthorizationBinding, requirementsDigest:String(row.requirements_digest),
      })) };
    },
    async readWithdrawal(value,id) {
      namespace(value); const row=get(id); if(!row)return null;
      const {signatureCipher,...result}=row;
      if(!signatureCipher)return result;
      if(!/^[0-9a-f]{24}$/.test(signatureCipher.iv)||!/^[0-9a-f]{296}$/.test(signatureCipher.encrypted))refuse();
      const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(Buffer.from(signatureCipher.iv,"hex")),
        additionalData:new TextEncoder().encode(`${context.digest}\nwithdrawal:${id}`)},aes,Uint8Array.from(Buffer.from(signatureCipher.encrypted,"hex")));
      active(); const signature=new TextDecoder().decode(bytes); if(!/^0x[0-9a-fA-F]{130}$/.test(signature))refuse();
      return {...result,signature};
    },
    async reserveWithdrawal(value,preparation,expectedVersion) {
      namespace(value);const p=original(preparation);
      transaction(()=>{if(version()!==expectedVersion||activeWithdrawal()||get(p.requestId))refuse();
        db.prepare("INSERT INTO withdrawals VALUES(?,?)").run(p.requestId,canonicalJson({preparation:p}));});
    },
    async retainOutcome(value,preparation,outcome) {
      namespace(value);const p=original(preparation),captured=structuredClone(outcome);
      let cipher:Stored["signatureCipher"];
      if("signature"in captured){
        if(!/^0x[0-9a-fA-F]{130}$/.test(captured.signature))refuse();
        const iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv,
          additionalData:new TextEncoder().encode(`${context.digest}\nwithdrawal:${p.requestId}`)},aes,new TextEncoder().encode(captured.signature));
        cipher={iv:Buffer.from(iv).toString("hex"),encrypted:Buffer.from(encrypted).toString("hex")};
      }
      if("completion"in captured){
        const completion=await verifySessionWithdrawalCompletion(captured.completion,p),row=exact(p,get(p.requestId)),mint=row.mint;
        const tx=parseTransaction(completion.serializedTransaction);
        if(!mint?.hash||keccak256(completion.serializedTransaction)!==mint.hash||tx.nonce!==mint.nonce||tx.to?.toLowerCase()!==mint.to||
          tx.data!==mint.data||String(tx.value??BigInt(0))!==mint.value||String(tx.gas)!==mint.gas||String(tx.maxFeePerGas)!==mint.maxFeePerGas||
          String(tx.maxPriorityFeePerGas??BigInt(0))!==mint.maxPriorityFeePerGas)refuse();
      }
      transaction(()=>{const row=exact(p,get(p.requestId));
        if(activeWithdrawal()!==p.requestId||row.cancelled||row.completion||("signature"in captured&&!row.exposed))refuse();
        if("signature"in captured){if(row.signatureCipher)refuse();save(p.requestId,{...row,signatureCipher:cipher});}
        else save(p.requestId,{...row,...captured});
      });
    },
    async cancelUnexposed(value,preparation) {
      namespace(value);const p=original(preparation);
      transaction(()=>{const row=get(p.requestId);if(!row)return;
        exact(p,row);if(activeWithdrawal()!==p.requestId||row.exposed||row.signatureCipher||row.completion||row.cancelled||row.submissionPossible||row.mint)refuse();
        save(p.requestId,{...row,cancelled:true});});
    },
    async abortPublication(value,preparation) {
      namespace(value);const p=original(preparation);
      transaction(()=>{const row=exact(p,get(p.requestId));
        if(row.signatureCipher||row.submissionPossible||row.mint||row.completion)refuse();
        if(row.publicationAbort)return;
        if(row.cancelled||activeWithdrawal()!==p.requestId)refuse();
        save(p.requestId,{...row,cancelled:true});
        db.prepare("INSERT INTO publication_aborts VALUES(?,1,NULL)").run(p.requestId);
      });
    },
    async confirmPublicationAbort(value,preparation,proof) {
      namespace(value);const p=original(preparation),verified=await verifySessionWithdrawalAbort(proof,p);
      transaction(()=>{const row=exact(p,get(p.requestId));
        const abort=row.publicationAbort;if(!abort)return refuse();
        if(!row.cancelled||row.signatureCipher||row.submissionPossible||row.mint||row.completion)refuse();
        if(!abort.pending){if(canonicalJson(abort.proof)!==canonicalJson(verified))refuse();return;}
        if(activeWithdrawal()!==p.requestId)refuse();
        db.prepare("UPDATE publication_aborts SET pending=0,proof=? WHERE id=? AND pending=1").run(canonicalJson(verified),p.requestId);
      });
    },
  };
  return Object.freeze({storage,activeWithdrawal,
    references(){active();return rows().map(row=>{const v=get(String(row.id))!;return {requestId:String(row.id),grantEpoch:v.preparation.grantEpoch,
      amountMicroUsdc:v.preparation.burnIntent.spec.value,exposed:!!v.exposed,submitted:!!v.submissionPossible,completed:!!v.completion,cancelled:!!v.cancelled,
      ...(v.publicationAbort?{publicationAbortPending:v.publicationAbort.pending}:{}),...(v.mint?.hash?{mintHash:v.mint.hash}:{}),...(v.mint?{mint:v.mint}:{})};});},
    claimSubmission(preparation:SessionWithdrawalPreparation){const p=original(preparation);return transaction(()=>{const row=exact(p,get(p.requestId));
      if(!row.signatureCipher||row.cancelled||row.completion)refuse();if(row.submissionPossible)return false;save(p.requestId,{...row,submissionPossible:true});return true;});},
    claimMint(preparation:SessionWithdrawalPreparation,mint:OwnerWalletMintAttempt){const p=original(preparation),captured=validatedMint(structuredClone(mint));return transaction(()=>{const row=exact(p,get(p.requestId));
      if(!row.signatureCipher||!row.submissionPossible||row.cancelled||row.completion||captured.hash)refuse();if(row.mint)return false;save(p.requestId,{...row,mint:captured});return true;});},
    retainMintHash(preparation:SessionWithdrawalPreparation,hash:string){const p=original(preparation);if(!/^0x[0-9a-f]{64}$/.test(hash))refuse();
      transaction(()=>{const row=exact(p,get(p.requestId));if(!row.mint||row.mint.hash&&row.mint.hash!==hash)refuse();save(p.requestId,{...row,mint:{...row.mint!,hash}});});},
  });
}

import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { createSessionSigningPolicy } from "../session/session-signing-policy";
import type { TypedDataPayload } from "../session/session-signer-protocol";
import { hostedTreasuryPolicyDigest, validateHostedTreasuryPolicy, type HostedTreasuryPolicy } from "../payments/hosted-treasury-policy";
import type { StorageIdentity } from "./storage-identity";
import { sqliteJournalTransaction } from "./sqlite-browser-journal";
import type { ServerX402Submission } from "../payments/server-x402-client";

export const HOSTED_TREASURY_SQL = `
CREATE TABLE hosted_treasury_policies(digest TEXT PRIMARY KEY, signer TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN('public','private')),
 data TEXT NOT NULL CHECK(length(data)<=4096 AND json_valid(data)));
CREATE TABLE hosted_treasury_authorizations(nonce TEXT PRIMARY KEY, policy_digest TEXT NOT NULL REFERENCES hosted_treasury_policies(digest),
 signer TEXT NOT NULL, query_id TEXT NOT NULL, amount_micro INTEGER NOT NULL CHECK(amount_micro>0),
 original TEXT NOT NULL CHECK(length(original)<=8192 AND json_valid(original)), header_hash TEXT, submitted INTEGER NOT NULL DEFAULT 0 CHECK(submitted IN(0,1)));
CREATE TRIGGER hosted_policy_insert_writer BEFORE INSERT ON hosted_treasury_policies WHEN NOT EXISTS(SELECT 1 FROM browser_journal_writer)
 BEGIN SELECT RAISE(ABORT,'hosted writer required'); END;
CREATE TRIGGER hosted_policy_immutable BEFORE UPDATE ON hosted_treasury_policies BEGIN SELECT RAISE(ABORT,'hosted policy immutable'); END;
CREATE TRIGGER hosted_policy_retained BEFORE DELETE ON hosted_treasury_policies BEGIN SELECT RAISE(ABORT,'hosted policy retained'); END;
CREATE TRIGGER hosted_original_insert_writer BEFORE INSERT ON hosted_treasury_authorizations WHEN NOT EXISTS(SELECT 1 FROM browser_journal_writer)
 BEGIN SELECT RAISE(ABORT,'hosted writer required'); END;
CREATE TRIGGER hosted_original_update_writer BEFORE UPDATE ON hosted_treasury_authorizations WHEN NOT EXISTS(SELECT 1 FROM browser_journal_writer)
 BEGIN SELECT RAISE(ABORT,'hosted writer required'); END;
CREATE TRIGGER hosted_original_immutable BEFORE UPDATE ON hosted_treasury_authorizations
 WHEN NEW.nonce IS NOT OLD.nonce OR NEW.policy_digest IS NOT OLD.policy_digest OR NEW.signer IS NOT OLD.signer OR NEW.query_id IS NOT OLD.query_id
 OR NEW.amount_micro IS NOT OLD.amount_micro OR NEW.original IS NOT OLD.original OR NEW.submitted<OLD.submitted
 OR (OLD.header_hash IS NOT NULL AND NEW.header_hash IS NOT OLD.header_hash)
 BEGIN SELECT RAISE(ABORT,'hosted original immutable'); END;
CREATE TRIGGER hosted_original_retained BEFORE DELETE ON hosted_treasury_authorizations BEGIN SELECT RAISE(ABORT,'hosted original retained'); END;
CREATE TRIGGER hosted_payment_update_writer BEFORE UPDATE ON payment_events
 WHEN EXISTS(SELECT 1 FROM hosted_treasury_authorizations WHERE 'x402:'||nonce=OLD.id) AND NOT EXISTS(SELECT 1 FROM browser_journal_writer)
 BEGIN SELECT RAISE(ABORT,'hosted original payment writer required'); END;
CREATE TRIGGER hosted_payment_immutable BEFORE UPDATE ON payment_events
 WHEN EXISTS(SELECT 1 FROM hosted_treasury_authorizations WHERE 'x402:'||nonce=OLD.id)
 AND (NEW.id IS NOT OLD.id OR NEW.payer IS NOT OLD.payer OR NEW.payee IS NOT OLD.payee OR NEW.amount_usdc IS NOT OLD.amount_usdc
 OR NEW.network IS NOT OLD.network OR NEW.authorization_id IS NOT OLD.authorization_id OR NEW.authorization_expires_at IS NOT OLD.authorization_expires_at
 OR NEW.kind IS NOT OLD.kind OR NEW.query_id IS NOT OLD.query_id OR NEW.source_id IS NOT OLD.source_id)
 BEGIN SELECT RAISE(ABORT,'hosted payment immutable'); END;
CREATE TRIGGER hosted_payment_retained BEFORE DELETE ON payment_events
 WHEN EXISTS(SELECT 1 FROM hosted_treasury_authorizations WHERE 'x402:'||nonce=OLD.id)
 BEGIN SELECT RAISE(ABORT,'hosted payment retained'); END;
CREATE TRIGGER hosted_signer_grant_refused BEFORE INSERT ON session_grants
 WHEN EXISTS(SELECT 1 FROM hosted_treasury_policies WHERE signer=lower(NEW.sess_addr))
 BEGIN SELECT RAISE(ABORT,'dedicated hosted signer cannot become browser authority'); END;
CREATE TRIGGER hosted_signer_grant_update_refused BEFORE UPDATE ON session_grants
 WHEN EXISTS(SELECT 1 FROM hosted_treasury_policies WHERE signer=lower(NEW.sess_addr))
 BEGIN SELECT RAISE(ABORT,'dedicated hosted signer cannot become browser authority'); END;
`;
const text = z.string().min(1).max(256), micro = z.string().regex(/^(0|[1-9][0-9]{0,15})$/).refine(v => BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER));
export const hostedPaymentContextSchema = z.object({ queryId: text, kind: z.enum(["fetch", "citation"]), sourceId: text,
 itemId: text.nullable(), queryBudgetMicroUsdc: micro.refine(v => BigInt(v) > BigInt(0)),
 privateJob: z.object({id:text,owner:z.string().regex(/^0x[0-9a-f]{40}$/),workerId:text}).strict().nullable() }).strict();
export type HostedPaymentContext = z.infer<typeof hostedPaymentContextSchema>;
export type HostedTreasuryAccounting = { retainedMicroUsdc: string; confirmedMicroUsdc: string };
export type HostedAuthorizationAdmission = { policy: HostedTreasuryPolicy; context: HostedPaymentContext; payload: TypedDataPayload;
 accounting: HostedTreasuryAccounting; availableMicroUsdc: string };
const checked = (v: unknown) => { const n = Number(v); if (!Number.isSafeInteger(n) || n < 0) throw new Error("Hosted accounting unavailable"); return n; };
function originalPayload(value: TypedDataPayload, signer: string) {
 const p = JSON.parse(JSON.stringify(value, (_k, v) => typeof v === "bigint" ? String(v) : v)) as TypedDataPayload;
 createSessionSigningPolicy(ARC_MAINNET_PROFILE).validatePayment(p, signer);
 return p;
}
export function admitSqliteHostedPolicy(db: DatabaseSync, value: HostedTreasuryPolicy, identity: StorageIdentity, role:"public"|"private") {
 const p = validateHostedTreasuryPolicy(value, identity), digest = hostedTreasuryPolicyDigest(p);
 if (!["public","private"].includes(role) || p.expiresAtSeconds <= Math.floor(Date.now() / 1000)) throw new Error("Hosted policy expired or role unavailable");
 sqliteJournalTransaction(db, () => {
  if (db.prepare("SELECT 1 FROM browser_signer_capacity WHERE signer=?").get(p.signer) ||
      db.prepare("SELECT 1 FROM session_grants WHERE lower(sess_addr)=?").get(p.signer)) throw new Error("Dedicated hosted signer already belongs to browser custody");
  if(db.prepare("SELECT 1 FROM hosted_treasury_policies WHERE signer=? AND role!=?").get(p.signer,role)) throw new Error("Historical hosted custody role cannot change");
  db.prepare("INSERT INTO hosted_treasury_policies(digest,signer,role,data) VALUES(?,?,?,?) ON CONFLICT DO NOTHING").run(digest,p.signer,role,canonicalJson(p));
  if (db.prepare("SELECT data FROM hosted_treasury_policies WHERE digest=?").get(digest)?.data !== canonicalJson(p)) throw new Error("Hosted policy conflict");
 });
 return digest;
}
export function sqliteHostedAccounting(db: DatabaseSync, signer: string, role?: "public" | "private"): HostedTreasuryAccounting {
 if (!/^0x[0-9a-f]{40}$/.test(signer)) throw new Error("Hosted accounting unavailable");
 if (role !== undefined && (!["public","private"].includes(role) || db.prepare("SELECT 1 FROM hosted_treasury_policies WHERE signer=? AND role!=?").get(signer,role)))
   throw new Error("Historical hosted custody role cannot change");
 const rows = db.prepare(`SELECT a.nonce,a.original,a.amount_micro,a.submitted,p.* FROM hosted_treasury_authorizations a
 LEFT JOIN payment_events p ON p.id='x402:'||a.nonce WHERE a.signer=? LIMIT 10001`).all(signer);
 if (rows.length>10000) throw new Error("Hosted accounting inspection limit exceeded");
 let retained=0, confirmed=0;
 for (const row of rows) {
  const o=JSON.parse(String(row.original)), m=o.payload.message, amount=checked(row.amount_micro);
  if(o.context.privateJob) {
   const submission=db.prepare("SELECT job_id,worker_id,data FROM private_creator_submissions WHERE authorization_id=?").get(row.nonce);
   const savedSubmission=submission ? JSON.parse(String(submission.data)) : null;
   const proof=savedSubmission?.submission;
   if(row.submitted===1 && (!proof || proof.authorizationId!==row.nonce || proof.payer!==signer || proof.payee!==String(m.to).toLowerCase() ||
      proof.amountMicros!==String(amount) || proof.network!==ARC_MAINNET_PROFILE.networkId ||
      proof.asset!==ARC_MAINNET_PROFILE.usdcAddress.toLowerCase() || proof.authorizationExpiresAt!==new Date(Number(m.validBefore)*1000).toISOString() ||
      submission?.job_id!==o.context.privateJob.id || submission?.worker_id!==o.context.privateJob.workerId ||
      savedSubmission.kind!==o.context.kind || savedSubmission.sourceId!==o.context.sourceId || savedSubmission.itemId!==o.context.itemId))
     throw new Error("Original private hosted submission unavailable");
   const confirmation=db.prepare("SELECT data FROM private_creator_confirmations WHERE authorization_id=?").get(row.nonce);
   if(confirmation) {
    const saved=JSON.parse(String(confirmation.data));
    if(!proof || canonicalJson(saved.submission)!==canonicalJson(proof) || typeof saved.transaction!=='string' || !saved.transaction)
      throw new Error("Original private hosted settlement unavailable");
    confirmed=checked(confirmed+amount);
   }
   if(row.id!==null) throw new Error("Private hosted payment cannot become public");
   retained=checked(retained+amount); continue;
  }
  if (row.id !== 'x402:'+row.nonce || row.authorization_id!==row.nonce || row.network!==ARC_MAINNET_PROFILE.networkId ||
      row.payer!==signer || row.payee!==String(m.to).toLowerCase() || Number(row.amount_usdc)!==amount/1e6 ||
      String(m.value)!==String(amount) || !["pending","settled","failed"].includes(String(row.settlement_status)) ||
      (row.settlement_status==='settled') !== (row.settled===1) || (row.settled===1 && (!row.tx_hash || typeof row.tx_hash!=='string')))
   throw new Error("Original hosted payment accounting unavailable");
  retained=checked(retained+amount); if(row.settled===1) confirmed=checked(confirmed+amount);
 }
 return {retainedMicroUsdc:String(retained),confirmedMicroUsdc:String(confirmed)};
}
export function admitSqliteHostedAuthorization(db: DatabaseSync, input: HostedAuthorizationAdmission, identity: StorageIdentity) {
 const p=validateHostedTreasuryPolicy(input.policy,identity), c=hostedPaymentContextSchema.parse(input.context), payload=originalPayload(input.payload,p.signer);
 const nonce=String(payload.message.nonce).toLowerCase(), amount=checked(payload.message.value), digest=hostedTreasuryPolicyDigest(p);
 const available=BigInt(micro.parse(input.availableMicroUsdc)), original=canonicalJson({context:c,payload});
 if (amount<=0 || p.expiresAtSeconds<=Math.floor(Date.now()/1000) || BigInt(c.queryBudgetMicroUsdc)>BigInt(p.queryCapMicroUsdc)) throw new Error("Hosted authority refused");
 sqliteJournalTransaction(db,()=>{
  const admittedPolicy=db.prepare("SELECT data,role FROM hosted_treasury_policies WHERE digest=?").get(digest);
  if(admittedPolicy?.data!==canonicalJson(p) || admittedPolicy.role!==(c.privateJob?"private":"public")) throw new Error("Hosted policy not admitted for this role");
  if(db.prepare("SELECT 1 FROM hosted_treasury_authorizations WHERE nonce=?").get(nonce) ||
     db.prepare("SELECT 1 FROM payment_events WHERE authorization_id=?").get(nonce)) throw new Error("Hosted nonce already admitted");
  const now=sqliteHostedAccounting(db,p.signer);
  if(canonicalJson(now)!==canonicalJson(input.accounting)) throw new Error("Hosted accounting changed");
  const query=checked(db.prepare("SELECT COALESCE(sum(amount_micro),0) AS n FROM hosted_treasury_authorizations WHERE signer=? AND query_id=?").get(p.signer,c.queryId)?.n);
  const first=db.prepare("SELECT original FROM hosted_treasury_authorizations WHERE signer=? AND query_id=? LIMIT 1").get(p.signer,c.queryId);
  if(first && JSON.parse(String(first.original)).context.queryBudgetMicroUsdc!==c.queryBudgetMicroUsdc) throw new Error("Original query budget changed");
  if(c.privateJob) {
   const job=db.prepare(`SELECT e.worker_id,i.payer,i.data FROM private_research_executions e JOIN private_research_intents i ON i.id=e.id
    WHERE e.id=? AND NOT EXISTS(SELECT 1 FROM private_research_results r WHERE r.id=e.id)
    AND NOT EXISTS(SELECT 1 FROM private_research_interruptions x WHERE x.id=e.id)`).get(c.privateJob.id);
   if(c.queryId!==c.privateJob.id || !job || job.worker_id!==c.privateJob.workerId || job.payer!==c.privateJob.owner ||
    Number(JSON.parse(String(job.data)).submission.request.budget)<Number(c.queryBudgetMicroUsdc)/1e6) throw new Error("Private original execution unavailable");
  }
  if(BigInt(now.retainedMicroUsdc)+BigInt(amount)>BigInt(p.lifetimeCapMicroUsdc) || BigInt(query)+BigInt(amount)>BigInt(c.queryBudgetMicroUsdc) ||
     BigInt(now.retainedMicroUsdc)-BigInt(now.confirmedMicroUsdc)+BigInt(amount)>available) throw new Error("Hosted capacity refused");
  db.prepare("INSERT INTO hosted_treasury_authorizations(nonce,policy_digest,signer,query_id,amount_micro,original) VALUES(?,?,?,?,?,?)").run(nonce,digest,p.signer,c.queryId,amount,original);
  if(!c.privateJob) db.prepare(`INSERT INTO payment_events(id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,network,settled,settlement_status,
   authorization_id,authorization_expires_at,item_id,origin,authorization_phase) VALUES(?,?,?,?,?,?,?,?,?,?,0,'pending',?,?,?,'engine','prepared')`)
   .run('x402:'+nonce,new Date().toISOString(),c.kind,c.queryId,c.sourceId,c.sourceId,p.signer,String(payload.message.to).toLowerCase(),amount/1e6,
    ARC_MAINNET_PROFILE.networkId,nonce,new Date(Number(payload.message.validBefore)*1000).toISOString(),c.itemId);
 });
 return nonce;
}
export function submitSqliteHostedAuthorization(db: DatabaseSync, signer:string, submission:Readonly<ServerX402Submission>, headerHash:string) {
 const input=z.object({authorizationId:z.string().regex(/^0x[0-9a-f]{64}$/),authorizationExpiresAt:z.string().datetime(),
  payer:z.literal(signer),payee:z.string().regex(/^0x[0-9a-f]{40}$/),amountMicros:micro,
  network:z.literal(ARC_MAINNET_PROFILE.networkId),asset:z.literal(ARC_MAINNET_PROFILE.usdcAddress.toLowerCase())}).strict().parse(submission);
 const nonce=input.authorizationId;
 if(!/^0x[0-9a-f]{40}$/.test(signer)||!/^0x[0-9a-f]{64}$/.test(nonce)||!/^0x[0-9a-f]{64}$/.test(headerHash)) throw new Error("Hosted submission refused");
 sqliteJournalTransaction(db,()=>{
  const row=db.prepare("SELECT header_hash,submitted,original FROM hosted_treasury_authorizations WHERE nonce=? AND signer=?").get(nonce,signer);
  if(!row || row.submitted!==0 || row.header_hash!==null) throw new Error("Recover original hosted submission; do not resubmit");
  const m=JSON.parse(String(row.original)).payload.message;
  if(String(m.to).toLowerCase()!==input.payee || String(m.value)!==input.amountMicros ||
   new Date(Number(m.validBefore)*1000).toISOString()!==input.authorizationExpiresAt) throw new Error("Original hosted signed tuple conflict");
  db.prepare("UPDATE hosted_treasury_authorizations SET header_hash=?,submitted=1 WHERE nonce=?").run(headerHash,nonce);
  db.prepare("UPDATE payment_events SET authorization_phase='submission_attempted' WHERE id=? AND authorization_phase='prepared'").run('x402:'+nonce);
 });
}
/** Receipt or existing original-network reconciliation may confirm this row;
 * unknown/rejected states never manufacture refunds or a fresh authorization. */
export function confirmSqliteHostedAuthorization(db:DatabaseSync,signer:string,nonce:string,transaction:string) {
 if(!/^0x[0-9a-f]{40}$/.test(signer)||!/^0x[0-9a-f]{64}$/.test(nonce)||typeof transaction!=='string'||!transaction||transaction.length>256)
  throw new Error("Hosted settlement evidence refused");
 sqliteJournalTransaction(db,()=>{
  const row=db.prepare("SELECT submitted,original FROM hosted_treasury_authorizations WHERE nonce=? AND signer=?").get(nonce,signer);
  if(row?.submitted!==1) throw new Error("Original hosted submission unavailable");
  if(JSON.parse(String(row.original)).context.privateJob) {
   const proof=db.prepare("SELECT data FROM private_creator_confirmations WHERE authorization_id=?").get(nonce);
   if(!proof || JSON.parse(String(proof.data)).transaction!==transaction) throw new Error("Original private confirmation unavailable"); return;
  }
  db.prepare("UPDATE payment_events SET settled=1,settlement_status='settled',authorization_phase='settled',tx_hash=? WHERE id=? AND settlement_status='pending'").run(transaction,'x402:'+nonce);
  const saved=db.prepare("SELECT settled,tx_hash FROM payment_events WHERE id=?").get('x402:'+nonce);
  if(saved?.settled!==1||saved.tx_hash!==transaction) throw new Error("Original settlement conflict");
 });
}
export function terminalSqliteHostedAuthorization(db:DatabaseSync,id:string,nonce:string,transaction:string,failed:boolean) {
 const row=db.prepare("SELECT signer,submitted,original FROM hosted_treasury_authorizations WHERE nonce=?").get(nonce);
 if(!row || id!=='x402:'+nonce) return null;
 if(JSON.parse(String(row.original)).context.privateJob) return null;
 if(row.submitted!==1) return {resolved:false,reservationReleased:false};
 if(!failed) {confirmSqliteHostedAuthorization(db,String(row.signer),nonce,transaction);return {resolved:true,reservationReleased:false};}
 sqliteJournalTransaction(db,()=>{
  db.prepare("UPDATE payment_events SET settlement_status='failed',authorization_phase='failed',tx_hash=? WHERE id=? AND settlement_status='pending'").run(transaction,id);
 });
 return {resolved:true,reservationReleased:false}; // Lifetime exposure never reset by an operator expiry or empty search.
}
export function hostedPaymentHeaderHash(header: string) { return '0x'+createHash('sha256').update(header).digest('hex'); }

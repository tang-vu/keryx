import { createHash } from 'node:crypto';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { canonicalJson } from '../../canonical-json';
import { prepareBrowserJournal,type BrowserAuthorizationJournal,type BrowserJournalAdmission,type BrowserSignedMetadata } from '../browser-authorization-journal';
import { prepareBrowserAuthorizationIntent,type BrowserAuthorizationIntent } from '../browser-authorization-admission';
import type { SessionGrantRecord } from '../keryx-db';
import { verifyBrowserQueryPolicy,type BrowserQueryPolicyProof } from '../../payments/browser-query-policy';
import { validateBrowserSigningSnapshot,type BrowserSigningSnapshot,type BrowserOriginalAdmission,type BrowserSourceOriginalAdmission } from '../browser-signing-originals';
import { capturePaymentEvent,capturePaymentEventRow,sqlitePaymentScalarText } from './payment-events-packet';

export const BROWSER_JOURNAL_CELL_BYTES=1048576;
export const BROWSER_JOURNAL_PACKET_BYTES=8388608;
export const BROWSER_JOURNAL_SNAPSHOT_BYTES=4194304;
export function browserJournalSha256(value:string){return createHash('sha256').update(value).digest('hex');}
export function browserJournalCopy<T>(raw:T):T{
 const wire=JSON.stringify(raw);if(typeof wire!=='string'||Buffer.byteLength(wire)>BROWSER_JOURNAL_CELL_BYTES)throw Error('Native browser original bound');return JSON.parse(wire) as T;
}
/** Closed native selectors cannot encode NUL. Source scalar binding replaces
 * lone UTF-16 before lookup; serialized JSON originals retain their escapes. */
export function browserJournalText(raw:unknown,limit=1024):string{
 if(typeof raw!=='string')throw Error('Native browser selector unsupported');const value=sqlitePaymentScalarText(raw);
 if(!value||value.includes('\0')||Buffer.byteLength(value)>limit)throw Error('Native browser selector unsupported');return value;
}
export function captureBrowserJournalSelector(sessionId:string,requestId:string){return Object.freeze({sessionId:browserJournalText(sessionId),requestId:browserJournalText(requestId),sourceSessionWire:JSON.stringify(sessionId),sourceRequestWire:JSON.stringify(requestId)});}
function wire(value:unknown){const text=JSON.stringify(value);if(typeof text!=='string'||Buffer.byteLength(text)>BROWSER_JOURNAL_CELL_BYTES)throw Error('Native browser original bound');return text;}
/** Generate one server nonce/time, before policy or database awaits. Never
 * substitute a caller nonce, an old unresolved nonce or a renewed grant. */
export function captureBrowserJournalAdmission(raw:BrowserJournalAdmission){
 const input=browserJournalCopy(raw),journal=prepareBrowserJournal(input,ARC_MAINNET_PROFILE);
 const lookup=captureBrowserJournalSelector(journal.sessionId,journal.requestId);
 for(const value of [input.queryId,input.grantEpoch,input.sourceId,journal.nonce,journal.signer,input.payee,input.network,input.token,input.gatewayContract])browserJournalText(value);
 if(input.offerId!==null)browserJournalText(input.offerId);
 const contextClaim=input.paymentContext?.sourceClaim??input.paymentContext?.item?.sourceClaim;
 const contextConflict=Boolean(input.paymentContext?.sourceClaim&&input.paymentContext.item?.sourceClaim&&canonicalJson(input.paymentContext.sourceClaim)!==canonicalJson(input.paymentContext.item.sourceClaim)||canonicalJson(input.payment.sourceClaim??null)!==canonicalJson(contextClaim??null));
 const intent={nonce:journal.nonce,session_id:lookup.sessionId,request_id:lookup.requestId,query_id:sqlitePaymentScalarText(input.queryId),grant_epoch:sqlitePaymentScalarText(journal.grantEpoch),signer:sqlitePaymentScalarText(journal.signer),network:input.network,token:input.token,gateway_contract:input.gatewayContract,source_id:sqlitePaymentScalarText(input.sourceId),offer_id:input.offerId===null?null:sqlitePaymentScalarText(input.offerId),kind:input.kind,payee:input.payee,amount_micro_usdc:input.amountMicroUsdc,phase:'prepared',created_at:journal.admittedAt};
 const payment=capturePaymentEventRow({...capturePaymentEvent(journal.payment).row,origin:journal.payment.origin??'web',authorization_phase:'prepared',authorization_expires_at:null,tx_hash:null});
 return Object.freeze({input,journal,intent,requirementsWire:wire(journal.requirements),paymentMetadataWire:wire(journal.payment),paymentContextWire:journal.paymentContext?wire(journal.paymentContext):null,payment,contextConflict});
}
export function captureBrowserAuthorizationIntent(raw:BrowserAuthorizationIntent){
 const input=browserJournalCopy(raw),intent=prepareBrowserAuthorizationIntent(input,ARC_MAINNET_PROFILE);
 for(const key of ['sessionId','requestId','queryId','grantEpoch','sourceId','signer','payee'] as const)browserJournalText(intent[key]);
 if(intent.offerId!==null)browserJournalText(intent.offerId);return Object.freeze({input,intent});
}
export function captureBrowserJournalGrant(raw:Omit<SessionGrantRecord,'spent'>){
 const grant=browserJournalCopy(raw);for(const key of ['sessionId','sessAddr','ownerAddr','grantEpoch','txHash'] as const)browserJournalText(grant[key]);
 const capMicros=browserJournalMicros(grant.cap);if(!Number.isSafeInteger(grant.expiry))throw Error('Native browser grant expiry unsupported');return Object.freeze({grant,capMicros:String(capMicros)});
}
export function browserJournalMicros(value:number){const scaled=value*1e6,amount=Math.round(scaled);if(!Number.isSafeInteger(amount)||amount<0||Math.abs(scaled-amount)>=0.000001)throw Error('Retained browser capacity mismatch');return amount;}
export interface BrowserJournalStoredRow {
 nonce:string;created_at:string;grant_epoch:string;signer:string;requirements:string;payment_metadata:string;payment_context:string|null;
 valid_after:string|null;valid_before:string|null;header_hash:string|null;authorization_phase:string|null;settlement_status:string;
 tx_hash:string|null;authorization_expires_at:string|null;
}
/** Source reads JSON TEXT, then overlays only these current scalar columns.
 * In particular raw metadata strings are not rebuilt from payment projection. */
export function decodeBrowserJournal(row:BrowserJournalStoredRow|null,selector:ReturnType<typeof captureBrowserJournalSelector>):BrowserAuthorizationJournal|null{
 if(row===null)return null;
 for(const field of ['nonce','created_at','grant_epoch','signer','requirements','payment_metadata','settlement_status'] as const)if(typeof row[field]!=='string'||Buffer.byteLength(row[field])>BROWSER_JOURNAL_CELL_BYTES)throw Error('Native browser retained original unavailable');
 const payment=JSON.parse(row.payment_metadata);payment.authorizationPhase=row.authorization_phase;payment.settlementStatus=row.settlement_status;payment.settled=row.settlement_status==='settled';payment.txHash=row.tx_hash;
 if(row.authorization_expires_at)payment.authorizationExpiresAt=row.authorization_expires_at;
 return {nonce:row.nonce,admittedAt:row.created_at,sessionId:JSON.parse(selector.sourceSessionWire),requestId:JSON.parse(selector.sourceRequestWire),grantEpoch:row.grant_epoch,signer:row.signer,phase:row.authorization_phase as BrowserAuthorizationJournal['phase'],requirements:JSON.parse(row.requirements),payment,...(row.payment_context?{paymentContext:JSON.parse(row.payment_context)}:{}),signedValidAfter:row.valid_after as string|undefined,signedValidBefore:row.valid_before as string|undefined,signedHeaderHash:row.header_hash as string|undefined};
}
export function captureBrowserJournalMetadata(raw:BrowserSignedMetadata){
 const metadata=browserJournalCopy(raw);for(const key of ['validAfter','validBefore','headerHash'] as const)if(typeof metadata[key]!=='string'||Buffer.byteLength(JSON.stringify(metadata[key]))>8192)throw Error('Native browser signed metadata bound');
 return JSON.stringify(metadata);
}
export async function captureBrowserQueryPolicy(raw:BrowserQueryPolicyProof,sessionId:string){
 const proof=browserJournalCopy(raw),session=browserJournalText(sessionId),verified=await verifyBrowserQueryPolicy(proof);
 return Object.freeze({sessionId:session,verified,proofWire:canonicalJson({policy:verified.policy,signature:verified.signature})});
}
export function captureBrowserDurableInput<T extends BrowserOriginalAdmission|BrowserSourceOriginalAdmission>(raw:T){
 const inputWire=canonicalJson(raw);if(Buffer.byteLength(inputWire)>BROWSER_JOURNAL_CELL_BYTES)throw Error('Native browser original bound');
 const input=JSON.parse(inputWire) as T;return Object.freeze({input,inputWire,selector:captureBrowserJournalSelector(input.journal.sessionId,input.journal.requestId)});
}
export interface BrowserSourceSnapshot {
 selector:ReturnType<typeof captureBrowserJournalSelector>;
 intent:Record<string,unknown>|null;binding:Record<string,unknown>|null;paymentWire:string|null;
 original:Record<string,unknown>|null;query:Record<string,unknown>|null;namespace:Record<string,unknown>|null;grant:Record<string,unknown>|null;
 signerSpent:string|null;epochSpent:string|null;controls:{journalActive:boolean;signingActive:boolean;floor:number;ever:number};
}
export function decodeBrowserSourceEnvelope(raw:unknown,selector:ReturnType<typeof captureBrowserJournalSelector>){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='sha256,wire')throw Error('Native browser snapshot unavailable');
 const {wire,sha256}=raw as Record<string,unknown>;
 if(typeof wire!=='string'||Buffer.byteLength(wire)>BROWSER_JOURNAL_SNAPSHOT_BYTES||typeof sha256!=='string'||browserJournalSha256(wire)!==sha256)throw Error('Native browser snapshot unavailable');
 const snapshot=JSON.parse(wire) as BrowserSourceSnapshot;
 if(!snapshot||Array.isArray(snapshot)||Object.keys(snapshot).sort().join(',')!=='binding,controls,epochSpent,grant,intent,namespace,original,paymentWire,query,selector,signerSpent'||canonicalJson(snapshot.selector)!==canonicalJson(selector)||!snapshot.controls||typeof snapshot.controls.journalActive!=='boolean'||typeof snapshot.controls.signingActive!=='boolean'||![2,3].includes(snapshot.controls.floor)||![0,1].includes(snapshot.controls.ever))throw Error('Native browser snapshot unavailable');
 return {snapshot,wire,sha256};
}
export function browserJournalFromSnapshot(snapshot:BrowserSourceSnapshot){
 const {intent:i,binding:b,paymentWire}=snapshot;if(!i||!b||paymentWire===null)return null;
 if(typeof paymentWire!=='string'||Buffer.byteLength(paymentWire)>BROWSER_JOURNAL_CELL_BYTES)throw Error('Native browser payment original bound');const p=JSON.parse(paymentWire);
 if(!p||Array.isArray(p)||p.id!=='x402:'+i.nonce)throw Error('Native browser payment original unavailable');
 return decodeBrowserJournal({nonce:i.nonce,created_at:i.created_at,grant_epoch:i.grant_epoch,signer:i.signer,requirements:b.requirements,payment_metadata:b.payment_metadata,payment_context:b.payment_context,valid_after:b.valid_after,valid_before:b.valid_before,header_hash:b.header_hash,authorization_phase:p.authorization_phase,settlement_status:p.settlement_status,tx_hash:p.tx_hash,authorization_expires_at:p.authorization_expires_at} as BrowserJournalStoredRow,snapshot.selector);
}
export async function browserSigningSnapshot(snapshot:BrowserSourceSnapshot,identity:{owner:string}|{signer:string}):Promise<BrowserSigningSnapshot|null>{
 const journal=browserJournalFromSnapshot(snapshot);if(!journal)return null;
 if('signer'in identity&&(journal.signer.toLowerCase()!==identity.signer||!['exposed','signed','submission_attempted','settled','failed'].includes(journal.phase)))return null;
 const {original:o,query:q,namespace:n,grant:g}=snapshot;if(!o)return null;
 if(!q||!n||snapshot.signerSpent===null||snapshot.epochSpent===null||'owner'in identity&&n.owner!==identity.owner.toLowerCase()||q.session_id!==snapshot.selector.sessionId)throw Error('Browser signing snapshot refused');
 const value:BrowserSigningSnapshot={journal,original:JSON.parse(String(o.original)),currentGrant:g?{sessionId:String(g.session_id),sessAddr:String(g.sess_addr),ownerAddr:String(g.owner_addr),cap:Number(g.cap),spent:Number(g.spent),expiry:Number(g.expiry),txHash:String(g.tx_hash),grantEpoch:String(g.grant_epoch)}:null,
 policy:JSON.parse(String(q.proof)),active:snapshot.controls.journalActive&&snapshot.controls.signingActive,
 namespace:{namespace:String(n.namespace),owner:String(n.owner),signer:String(n.signer),service:String(n.service),network:String(n.network),ceilingMicros:String(n.ceiling_micro),jobLimit:Number(n.job_limit),allocatedMicros:String(n.allocated_micro),jobs:Number(n.jobs),ceilingProof:JSON.parse(String(n.proof))},
 query:{queryId:String(q.query_id),namespace:String(q.namespace),ceilingMicros:String(q.ceiling_micro),spentMicros:String(q.spent_micro),proofDigest:String(q.proof_digest)},signerSpentMicros:snapshot.signerSpent,retainedEpochSpentMicros:snapshot.epochSpent};
 return validateBrowserSigningSnapshot(value,'owner'in identity?identity.owner:String(n.owner));
}

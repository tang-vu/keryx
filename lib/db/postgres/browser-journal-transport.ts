import { canonicalJson } from '../../canonical-json';
import { ARC_TESTNET_PROFILE } from '../../arc-network-profile';
import type { BrowserAuthorizationIntent,BrowserAdmissionResult } from '../browser-authorization-admission';
import { prepareBrowserJournal,type BrowserAuthorizationJournal,type BrowserJournalAdmission,type BrowserJournalAdmissionResult,type BrowserSignedMetadata } from '../browser-authorization-journal';
import type { BrowserQueryPolicyProof } from '../../payments/browser-query-policy';
import type { BrowserOriginalAdmission,BrowserSourceOriginalAdmission,BrowserOriginalAdmissionResult,BrowserQueryAdmissionResult,BrowserSigningSnapshot } from '../browser-signing-originals';
import { browserSigningOriginalSchema,verifyBrowserSigningOriginalSource,verifyBrowserSigningHeader } from '../../payments/browser-signing-original';
import type { SessionGrantRecord } from '../keryx-db';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { sourceClaimPolicyRuntime,sourceClaimPolicySelector,captureHostedSourceClaimPolicy } from './source-claim-purchase-policy';
import { BROWSER_JOURNAL_PACKET_BYTES,browserJournalSha256,browserJournalText,captureBrowserJournalSelector,captureBrowserJournalAdmission,captureBrowserAuthorizationIntent,captureBrowserJournalGrant,captureBrowserJournalMetadata,captureBrowserQueryPolicy,captureBrowserDurableInput,decodeBrowserSourceEnvelope,browserJournalFromSnapshot,browserSigningSnapshot,type BrowserSourceSnapshot } from './browser-journal-packet';

export interface PostgresBrowserJournalPort {
 browserJournalActive():Promise<boolean>;activateBrowserJournal():Promise<void>;
 upsertSessionGrant(grant:Omit<SessionGrantRecord,'spent'>):Promise<void>;
 admitBrowserAuthorization(input:BrowserAuthorizationIntent):Promise<BrowserAdmissionResult>;
 admitBrowserJournal(input:BrowserJournalAdmission):Promise<BrowserJournalAdmissionResult>;
 getBrowserJournal(sessionId:string,requestId:string):Promise<BrowserAuthorizationJournal|null>;
 exposeBrowserJournal(sessionId:string,requestId:string):Promise<boolean>;submitBrowserJournal(sessionId:string,requestId:string):Promise<boolean>;cancelPreparedBrowserJournal(sessionId:string,requestId:string):Promise<boolean>;
 signBrowserJournal(sessionId:string,requestId:string,metadata:BrowserSignedMetadata):Promise<boolean>;
 admitBrowserQueryPolicy(proof:BrowserQueryPolicyProof,sessionId:string):Promise<BrowserQueryAdmissionResult>;
 admitBrowserSigningOriginal(input:BrowserOriginalAdmission):Promise<BrowserOriginalAdmissionResult>;
 admitBrowserSourceSigningOriginal(input:BrowserSourceOriginalAdmission):Promise<BrowserOriginalAdmissionResult>;
 readBrowserSigningSnapshot(owner:string,sessionId:string,requestId:string):Promise<BrowserSigningSnapshot|null>;
 readExposedBrowserSigningSnapshotForSigner(signer:string,sessionId:string,requestId:string):Promise<BrowserSigningSnapshot|null>;
 signBrowserSigningOriginal(sessionId:string,requestId:string,header:string):Promise<boolean>;
}
/** Source protocols on one fixed native channel. Composition never registers an
 * installed facade, SQLite brand, signer, owner proof or funding authority. */
export function composePostgresBrowserJournal(channel:PostgresDomainChannel,readOnly:boolean):PostgresBrowserJournalPort {
 const unavailable=()=>new PostgresStorageUnavailable();if(typeof readOnly!=='boolean')throw unavailable();
 const live=()=>{if(channel.closed)throw unavailable();},writer=()=>{live();if(readOnly)throw unavailable();};
 const call=(op:'browserJournalState'|'browserJournalFinish'|'browserJournalControl'|'browserJournalAction'|'browserJournalReplay',args:readonly(string|null)[])=>channel.call(op as Parameters<PostgresDomainChannel['call']>[0],args);
 const encoded=(value:unknown)=>{const wire=JSON.stringify(value);if(typeof wire!=='string'||Buffer.byteLength(wire)>BROWSER_JOURNAL_PACKET_BYTES)throw unavailable();return wire;};
 const state=async(selector:ReturnType<typeof captureBrowserJournalSelector>)=>{live();const raw=await call('browserJournalState',[encoded(selector)]);live();return decodeBrowserSourceEnvelope(raw,selector);};
 const changed=async(action:string,packet:unknown)=>{writer();const result=await call('browserJournalAction',[action,encoded(packet)]);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();return result;};
 const bool=(value:unknown)=>{if(typeof value!=='boolean')throw new PostgresDomainWriteOutcomeUnknown();return value;};
 const transition=async(action:'expose'|'submit'|'cancel',sessionId:string,requestId:string)=>{writer();return bool(await changed(action,{selector:captureBrowserJournalSelector(sessionId,requestId)}));};
 const retainedResult=(raw:unknown,selector:ReturnType<typeof captureBrowserJournalSelector>):{status:'admitted';snapshot:BrowserSourceSnapshot}|{status:'inactive'|'refused'|'missing'}=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw unavailable();const value=raw as Record<string,unknown>;
  if(value.status==='admitted'&&Object.keys(value).sort().join(',')==='snapshot,status')return {status:'admitted',snapshot:decodeBrowserSourceEnvelope(value.snapshot,selector).snapshot};
  if(['inactive','refused','missing'].includes(String(value.status))&&Object.keys(value).join(',')==='status')return {status:value.status as 'inactive'|'refused'|'missing'};throw unavailable();
 };
 const signingRead=async(identity:{owner:string}|{signer:string},sessionId:string,requestId:string)=>{
  live();const selector=captureBrowserJournalSelector(sessionId,requestId),before=await state(selector),value=await browserSigningSnapshot(before.snapshot,identity);live();
  // Crypto validation awaits. The final native statement must see the SAME
  // current scope/original/grant/counters; no stale pre-validation frame escapes.
  const raw=await call('browserJournalFinish',[encoded({selector,snapshotSha256:before.sha256})]);live();decodeBrowserSourceEnvelope(raw,selector);return value;
 };
 return Object.freeze({
  async browserJournalActive(){live();const value=await call('browserJournalControl',[]);live();if(typeof value!=='boolean')throw unavailable();return value;},
  async activateBrowserJournal(){writer();if(await changed('activate',{})!==true)throw new PostgresDomainWriteOutcomeUnknown();},
  async upsertSessionGrant(raw){writer();const captured=captureBrowserJournalGrant(raw);if(await changed('grant',captured)!==true)throw new PostgresDomainWriteOutcomeUnknown();},
  async admitBrowserAuthorization(raw){writer();const captured=captureBrowserAuthorizationIntent(raw),result=await changed('intent',{intent:captured.projection});if(result==='admitted')return {status:'admitted',intent:captured.intent};if(result==='grant_or_cap_refused')return {status:result};throw new PostgresDomainWriteOutcomeUnknown();},
  async admitBrowserJournal(raw){
   writer();const captured=captureBrowserJournalAdmission(raw),active=await call('browserJournalControl',[]);live();if(active===false)return {status:'inactive'};if(active!==true)throw unavailable();if(captured.contextConflict)throw Error('Browser journal source claim differs from original payment context');
   const runtime=sourceClaimPolicyRuntime(),runtimeWire=canonicalJson(runtime),selector=sourceClaimPolicySelector({sourceId:captured.input.sourceId,identity:null});
   const envelope=await channel.call('hostedSourcePolicySnapshot' as Parameters<PostgresDomainChannel['call']>[0],[selector]);live();
   if(canonicalJson(sourceClaimPolicyRuntime())!==runtimeWire)throw unavailable();
   const claim=captured.input.paymentContext?.sourceClaim??captured.input.paymentContext?.item?.sourceClaim;
   const sourcePolicy=captureHostedSourceClaimPolicy(envelope,{sourceId:captured.input.sourceId,expected:claim,kind:captured.input.kind,network:captured.input.network},runtime),p=captured.payment;
   const result=await changed('admit',{intent:captured.intent,requirementsWire:captured.requirementsWire,paymentMetadataWire:captured.paymentMetadataWire,paymentContextWire:captured.paymentContextWire,payment:{rowWire:p.rowWire,sha256:p.sha256,projection:p.projection,unprojectedFields:p.unprojectedFields},sourcePolicy});
   if(result==='inactive'||result==='grant_or_cap_refused')return {status:result};
   if(result!=='admitted')throw new PostgresDomainWriteOutcomeUnknown();try{if(canonicalJson(sourceClaimPolicyRuntime())!==runtimeWire)throw new PostgresDomainWriteOutcomeUnknown();}catch{throw new PostgresDomainWriteOutcomeUnknown();}return {status:'admitted',journal:captured.journal};
  },
  async getBrowserJournal(sessionId,requestId){const selector=captureBrowserJournalSelector(sessionId,requestId);return browserJournalFromSnapshot((await state(selector)).snapshot);},
  exposeBrowserJournal:(sessionId,requestId)=>transition('expose',sessionId,requestId),submitBrowserJournal:(sessionId,requestId)=>transition('submit',sessionId,requestId),cancelPreparedBrowserJournal:(sessionId,requestId)=>transition('cancel',sessionId,requestId),
  async signBrowserJournal(sessionId,requestId,raw){writer();const selector=captureBrowserJournalSelector(sessionId,requestId),metadataWire=captureBrowserJournalMetadata(raw);return bool(await changed('sign',{selector,metadataWire,canonical:false,originalSha256:null}));},
  async admitBrowserQueryPolicy(raw,sessionId){writer();const captured=await captureBrowserQueryPolicy(raw,sessionId);writer();const value=await changed('query',captured);if(!value||typeof value!=='object'||Array.isArray(value))throw new PostgresDomainWriteOutcomeUnknown();const result=value as Record<string,unknown>;
   if(result.status==='admitted'&&Object.keys(result).sort().join(',')==='namespace,queryId,status'&&result.namespace===captured.verified.namespace&&result.queryId===captured.verified.policy.queryId)return {status:'admitted',namespace:String(result.namespace),queryId:String(result.queryId)};
   if((result.status==='inactive'||result.status==='refused')&&Object.keys(result).join(',')==='status')return {status:result.status};throw new PostgresDomainWriteOutcomeUnknown();},
  async admitBrowserSigningOriginal(raw){writer();const captured=captureBrowserDurableInput(raw),prepared=prepareBrowserJournal(captured.input.journal),result=retainedResult(await call('browserJournalReplay',['v2',encoded({selector:captured.selector,inputWire:captured.inputWire,hint:{queryId:captured.input.queryId,namespace:captured.input.queryNamespace,grantEpoch:prepared.grantEpoch,signer:prepared.signer,amountMicroUsdc:captured.input.journal.amountMicroUsdc,network:ARC_TESTNET_PROFILE.networkId}})]),captured.selector);live();
   if(result.status==='admitted'){const journal=browserJournalFromSnapshot(result.snapshot);if(!journal||!result.snapshot.original)throw unavailable();return {status:'admitted',journal,original:JSON.parse(String(result.snapshot.original.original))};}if(result.status==='missing')throw unavailable();return {status:result.status};},
  async admitBrowserSourceSigningOriginal(raw){writer();const captured=captureBrowserDurableInput(raw),result=retainedResult(await call('browserJournalReplay',['v3',encoded({selector:captured.selector,inputWire:captured.inputWire})]),captured.selector);live();
   if(result.status==='admitted'){
    const journal=browserJournalFromSnapshot(result.snapshot);if(!journal||!result.snapshot.original)throw unavailable();const stored=JSON.parse(String(result.snapshot.original.input));delete stored.sourceContext;if(canonicalJson(stored)!==captured.inputWire)return {status:'refused'};const original=browserSigningOriginalSchema.parse(JSON.parse(String(result.snapshot.original.original)));await verifyBrowserSigningOriginalSource(original,journal);live();
    const final=retainedResult(await call('browserJournalReplay',['v3-finish',encoded({selector:captured.selector,inputWire:captured.inputWire,originalSha256:importedOriginalSha(result.snapshot),inputSha256:browserJournalSha256(String(result.snapshot.original.input))})]),captured.selector);live();if(final.status!=='admitted')throw unavailable();const current=browserJournalFromSnapshot(final.snapshot);if(!current)throw unavailable();return {status:'admitted',journal:current,original};
   }
   if(result.status!=='missing')return {status:result.status};
   if(captured.input.protocol!=='durable-v3'||captured.input.journal.kind!=='fetch')return {status:'refused'};
   // Source's resolver first uses this historical preparer. A mainnet input
   // refuses here, before catalog/RPC. A historical fresh payment cannot pass
   // the selected mainnet intent fence; never call a provider to promote it.
   prepareBrowserJournal(captured.input.journal);throw Error('storage authority profile mismatch');
  },
  async readBrowserSigningSnapshot(owner,sessionId,requestId){return signingRead({owner:browserJournalText(owner).toLowerCase()},sessionId,requestId);},
  async readExposedBrowserSigningSnapshotForSigner(signer,sessionId,requestId){if(typeof signer!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(signer))throw unavailable();return signingRead({signer:signer.toLowerCase()},sessionId,requestId);},
  async signBrowserSigningOriginal(sessionId,requestId,header){writer();const selector=captureBrowserJournalSelector(sessionId,requestId),before=await state(selector),journal=browserJournalFromSnapshot(before.snapshot);if(!journal||!before.snapshot.original)return false;
   const original=JSON.parse(String(before.snapshot.original.original)),metadata=await verifyBrowserSigningHeader(original,header);writer();return bool(await changed('sign',{selector,metadataWire:captureBrowserJournalMetadata(metadata),canonical:true,originalSha256:importedOriginalSha(before.snapshot)}));},
 } satisfies PostgresBrowserJournalPort);
}
function importedOriginalSha(snapshot:BrowserSourceSnapshot){if(!snapshot.original||typeof snapshot.original.original!=='string')throw new PostgresStorageUnavailable();return browserJournalSha256(snapshot.original.original);}

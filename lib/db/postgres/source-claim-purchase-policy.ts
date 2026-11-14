import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { config } from '../../config';
import { configuredRegistryAuthorities } from '../../registry/source-registry-authority';
import { sourceRegistryAuthoritySchema, sameRegistryAuthority } from '../../registry/source-registry-authority-schema';
import { canonicalSourceUrl, claimControlIsFresh, sourceClaimSchema, sourceClaimChallengeSchema, sourceClaimReceiptSchema, type SourceClaim } from '../../sources/public-source-claim';
import { hostedTreasuryPolicySchema } from '../../payments/hosted-treasury-policy';
import { operatingFeeContextSchema, operatingFeePolicySchema, operatingFeePolicyDigest, operatingFeeRequestHash, operatingFeeMaxMicroUsdc, OPERATING_FEE_SOURCE_ID, OPERATING_FEE_POLICY_KEY_PREFIX } from '../../payments/operating-fee-policy';
import type { SourceClaimReceipt } from '../../types';

const PREFIX='keryx:source-claims:v1:',sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const identitySchema=z.object({network:z.string(),payer:z.string(),authorizationId:z.string()}).strict();
const selectorSchema=z.object({sourceId:z.string().min(1).max(256).nullable(),identity:identitySchema.nullable()}).strict();
const row=z.record(z.string(),z.unknown());
const snapshotSchema=z.object({selector:selectorSchema,source:row.nullable(),rows:z.array(z.object({key:z.string(),value:z.string()}).strict()).max(10000),
 browser:z.object({intent:row,binding:row.nullable()}).strict().nullable(),
 hosted:z.object({authorization:row,policy:row.nullable()}).strict().nullable(),purchase:row.nullable()}).strict();
const historySchema=z.object({claim:sourceClaimSchema,action:z.enum(['verified','linked-free','policy']),at:z.string().datetime(),evidence:z.unknown()}).strict();
const bindingSchema=z.object({sourceId:z.string().min(1).max(256),claimId:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const runtimeSchema=z.object({deploymentOrigin:z.string().url(),fallbackAddress:z.string(),authorities:z.array(sourceRegistryAuthoritySchema).max(4),unavailable:z.boolean().optional()}).strict();
export type SourceClaimPolicyRuntime=z.infer<typeof runtimeSchema>;
export interface SourceClaimPolicySelector {sourceId:string|null;identity:{network:string;payer:string;authorizationId:string}|null;}
export interface SourceClaimPurchasePolicyInput {identity:{network:string;payer:string;authorizationId:string};existing:boolean;sourceId?:string;receipt?:SourceClaimReceipt;kind?:'fetch'|'citation'|'operating-fee';payee:string;amountMicros:number;requestHash?:string;}
export interface SourceClaimPolicyCapture {selector:string;snapshotSha256:string;policySnapshot:{sourceId:string;receipt:SourceClaimReceipt|null;kind:'fetch'|'citation'|'operating-fee'}|null;policyWire:string|null;existing:boolean;}
export function sourceClaimPolicyRuntime():SourceClaimPolicyRuntime{
 // Source's unmanaged and ordinary existing-purchase paths never need the
 // deployment URL. Retain an invalid value here; the managed-policy parser
 // rejects it only on the path that actually consumes that authority.
 let deploymentOrigin=config.baseUrl;try{deploymentOrigin=new URL(config.baseUrl).origin;}catch{}
 let authorities:SourceClaimPolicyRuntime['authorities']=[],unavailable=false;try{authorities=configuredRegistryAuthorities();}catch{unavailable=true;}
 return {deploymentOrigin,fallbackAddress:config.registryReadAddress?.toLowerCase()??'',authorities,...(unavailable?{unavailable:true}:{})};
}
export function sourceClaimPolicySelector(value:SourceClaimPolicySelector):string{
 const parsed=selectorSchema.parse(value),wire=canonicalJson(parsed);
 if(Buffer.byteLength(wire)>2048||[parsed.sourceId,...(parsed.identity?Object.values(parsed.identity):[])].some(v=>v!==null&&(v.includes('\0')||Buffer.from(v).toString('utf8')!==v)))throw Error('Source policy selector unavailable');
 return wire;
}
/** Exact retained TEXT enters JS before decoding. This digest binds only the
 * local SOURCE projection; it never authenticates chain/provider settlement. */
export function decodeSourceClaimPolicySnapshot(value:unknown,selector:string){
 const envelope=z.object({wire:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(value);
 if(Buffer.byteLength(envelope.wire)>8388608||sha(envelope.wire)!==envelope.sha256)throw Error('Source policy snapshot digest unavailable');
 const snapshot=snapshotSchema.parse(JSON.parse(envelope.wire));
 if(canonicalJson(snapshot.selector)!==selector||new Set(snapshot.rows.map(r=>r.key)).size!==snapshot.rows.length)throw Error('Source policy snapshot selector unavailable');
 return {snapshot,sha256:envelope.sha256};
}
type Snapshot=ReturnType<typeof decodeSourceClaimPolicySnapshot>['snapshot'];
function reader(snapshot:Snapshot){const values=new Map(snapshot.rows.map(r=>[r.key,r.value]));return {values,read:(key:string)=>{const v=values.get(PREFIX+key);return v===undefined?null:JSON.parse(v);}};}
function currentClaim(snapshot:Snapshot,sourceId:string):SourceClaim|null{
 const {values,read}=reader(snapshot),suffix=sha(sourceId),bound=values.get(PREFIX+'source:'+suffix),marker=values.get(PREFIX+'marker:'+suffix)??bound;
 if(bound===undefined){
  if(marker!==undefined)throw Error('Retained managed source binding is unavailable');
  for(const [key,raw] of values)if(key.startsWith(PREFIX+'claim:')||key.startsWith(PREFIX+'history:')){
   // Unsupported malformed retained JSON is an explicit hold. It cannot be
   // reinterpreted as absence or grant unmanaged payment authority.
   const v=JSON.parse(raw),linked=v?.linkedSourceId??v?.claim?.linkedSourceId;
   if(linked===sourceId)throw Error('Retained managed source binding is unavailable');
  }
  return null;
 }
 const binding=bindingSchema.parse(JSON.parse(bound));
 if(binding.sourceId!==sourceId||canonicalJson(bindingSchema.parse(JSON.parse(marker!)))!==canonicalJson(binding))throw Error('Retained source binding differs from its marker');
 const raw=read('claim:'+binding.claimId);if(!raw)throw Error('Orphaned source claim binding');
 const claim=sourceClaimSchema.parse(raw),original=historySchema.parse(read('history:'+binding.claimId+':0000000000000001')),
  latest=historySchema.parse(read('history:'+binding.claimId+':'+String(claim.revision).padStart(16,'0')));
 if(original.action!=='verified'||original.claim.revision!==1||original.claim.mode!=='free'||original.claim.ownerWallet!==claim.ownerWallet||original.claim.canonicalUrl!==claim.canonicalUrl||original.claim.network!==claim.network||original.claim.deploymentOrigin!==claim.deploymentOrigin||canonicalJson(latest.claim)!==canonicalJson(claim))throw Error('Source claim history is missing or inconsistent');
 const proof=z.object({challengeId:z.string().regex(/^[a-f0-9]{64}$/),proofDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(original.evidence),challenge=sourceClaimChallengeSchema.parse(read('challenge:'+proof.challengeId));
 if(!challenge.consumedAt||challenge.claimId!==claim.id||challenge.wallet!==claim.ownerWallet)throw Error('Original source-control proof history is unavailable');
 if(claim.linkedSourceId!==sourceId)throw Error('Orphaned source claim binding');
 return claim;
}
/** Metadata refresh uses the same retained identity/history reader without
 * adding the separate paid-mode or fresh-proof admission requirements. */
export function sourceClaimForSourceSnapshot(snapshot:Snapshot,sourceId:string):SourceClaim|null{return currentClaim(snapshot,sourceId);}
export function assertSourceClaimPaymentPolicy(snapshot:Snapshot,input:{sourceId:string;expected?:SourceClaimReceipt|null;kind:'fetch'|'citation';network:string;now?:number},runtime:SourceClaimPolicyRuntime):SourceClaim|null{
 const claim=currentClaim(snapshot,input.sourceId),source=snapshot.source;
 if(!claim){if(input.expected||source?.source_claim_id)throw Error('Managed source claim binding is unavailable');return null;}
 const expected=sourceClaimReceiptSchema.parse(input.expected),now=input.now??Date.now(),settings=runtimeSchema.parse(runtime),onchain=source?.onchain_id;
 if(settings.unavailable)throw Error('Source registry configuration unavailable');
 let authority:ReturnType<typeof sourceRegistryAuthoritySchema.parse>|undefined;
 if(typeof onchain==='string'&&/^0x[0-9a-fA-F]{64}$/.test(onchain)){
  const raw=reader(snapshot).values.get('keryx:source-registry-origin:v1:'+onchain.toLowerCase());
  if(raw!==undefined){const envelope=z.object({format:z.literal('keryx-source-registry-origin-v1'),onchainId:z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v=>v.toLowerCase()),authority:sourceRegistryAuthoritySchema}).strict().parse(JSON.parse(raw));if(envelope.onchainId!==onchain.toLowerCase())throw Error('Source registry origin unavailable');authority=envelope.authority;}
 }
 if(authority&&!settings.authorities.some(v=>sameRegistryAuthority(v,authority!))||!authority&&onchain&&settings.authorities.length)throw Error('Source registry origin outside current authority');
 if(claim.id!==expected.id||claim.revision!==expected.revision||claim.mode!==expected.mode||claim.effectiveAt!==expected.effectiveAt||claim.verifiedAt!==expected.verifiedAt||claim.network!==input.network||claim.deploymentOrigin!==settings.deploymentOrigin||claim.registryAddress!==(authority?.address??settings.fallbackAddress)||authority&&authority.network!==input.network||!claimControlIsFresh(claim,now)||Date.parse(claim.effectiveAt)>now||!claim.distributionPermission||claim.mode==='free'||input.kind==='fetch'&&claim.mode!=='paid')throw Error('Current source claim policy does not admit this new payment');
 if(!source||source.active===0||source.verified!==1||source.scholarly_enrolled===1||source.evidence_provenance==='synthetic-demo'||canonicalSourceUrl(String(source.url))!==claim.canonicalUrl||String(onchain).toLowerCase()!==claim.onchainId?.toLowerCase()||claim.rssUrl&&source.rss_url!==claim.rssUrl)throw Error('Retained managed source identity is inactive, unverified or incompatible');
 return claim;
}
function assertSigningOriginal(snapshot:Snapshot,input:SourceClaimPurchasePolicyInput,runtime:SourceClaimPolicyRuntime){
 const policy=input.receipt?sourceClaimReceiptSchema.parse(input.receipt):null,browser=snapshot.browser;
 if(browser){
  if(input.kind==='operating-fee'||!browser.binding?.payment_metadata)throw Error('Original browser payment binding unavailable');
  const row={...browser.intent,...browser.binding},metadata=JSON.parse(String(row.payment_metadata)),context=row.payment_context?JSON.parse(String(row.payment_context)):null;
  const originalPolicy=metadata.sourceClaim??null,contextPolicy=context?.sourceClaim??context?.item?.sourceClaim??null;
  if(row.network!==input.identity.network||String(row.signer).toLowerCase()!==input.identity.payer||row.source_id!==input.sourceId||row.kind!==input.kind||String(row.payee).toLowerCase()!==input.payee||row.amount_micro_usdc!==input.amountMicros||canonicalJson(originalPolicy)!==canonicalJson(policy)||context&&canonicalJson(contextPolicy)!==canonicalJson(originalPolicy))throw Error('Seller policy differs from original browser authorization');
 }
 const hosted=snapshot.hosted;
 if(hosted){
  const row=hosted.authorization,original=JSON.parse(String(row.original)),context=original.context,message=original.payload?.message;
  if(!context||!message||input.identity.network!=='eip155:5042'||row.signer!==input.identity.payer||context.sourceId!==input.sourceId||context.kind!==input.kind||String(message.to).toLowerCase()!==input.payee||String(message.value)!==String(input.amountMicros)||canonicalJson(context.sourceClaim??null)!==canonicalJson(policy))throw Error('Seller policy differs from original hosted authorization');
  if(input.kind==='operating-fee'){
   const fee=operatingFeeContextSchema.parse(context.operatingFee),treasury=hostedTreasuryPolicySchema.parse(hosted.policy?.data?JSON.parse(String(hosted.policy.data)):null),retained=reader(snapshot).values.get(OPERATING_FEE_POLICY_KEY_PREFIX+fee.policyDigest),feePolicy=operatingFeePolicySchema.parse(retained?JSON.parse(retained):null);
   if(hosted.policy?.role!=='public'||treasury.signer!==row.signer||treasury.origin!==runtime.deploymentOrigin||operatingFeePolicyDigest(feePolicy)!==fee.policyDigest||canonicalJson(feePolicy)!==retained||feePolicy.beneficiary!==input.payee||feePolicy.origin!==treasury.origin||feePolicy.network!==treasury.network||feePolicy.storageIdentityDigest!==treasury.storageIdentityDigest||input.sourceId!==OPERATING_FEE_SOURCE_ID||context.itemId!==null||context.privateJob!==null||policy!==null||row.submitted!==1||typeof row.header_hash!=='string'||!/^0x[0-9a-f]{64}$/.test(row.header_hash)||input.payee===row.signer||!Number.isSafeInteger(input.amountMicros)||input.amountMicros<=0||input.requestHash!==operatingFeeRequestHash(context.queryId,fee)||fee.amountMicroUsdc!==String(input.amountMicros)||BigInt(input.amountMicros)>BigInt(operatingFeeMaxMicroUsdc(context.queryBudgetMicroUsdc)))throw Error('Operating seller terms differ from original authorization');
  }
  return;
 }
 if(input.kind==='operating-fee')throw Error('Operating fee requires original public hosted authorization');
}
/** Pure new-write capture. Historical replay compares its immutable policy and
 * linked signing original, without applying a later changed/expired policy. */
export function captureSourceClaimPurchasePolicy(value:unknown,input:SourceClaimPurchasePolicyInput,runtime:SourceClaimPolicyRuntime):SourceClaimPolicyCapture{
 const selector=sourceClaimPolicySelector({sourceId:input.sourceId??null,identity:input.identity}),{snapshot,sha256}=decodeSourceClaimPolicySnapshot(value,selector);
 if(input.existing!==(snapshot.purchase!==null))throw Error('Source purchase existence changed');
 assertSigningOriginal(snapshot,input,runtime);
 const original=reader(snapshot).read('purchase-policy:'+sha(canonicalJson(input.identity))),policySnapshot=input.sourceId?{sourceId:input.sourceId,receipt:input.receipt?sourceClaimReceiptSchema.parse(input.receipt):null,kind:input.kind??'fetch'}:null;
 if(input.existing){if(original&&canonicalJson(original)!==canonicalJson(policySnapshot)||!original&&input.receipt||input.kind==='operating-fee'&&!original)throw Error('Original research source claim policy conflict');}
 else {if(original)throw Error('Orphaned original research source claim policy');if(policySnapshot&&policySnapshot.kind!=='operating-fee')assertSourceClaimPaymentPolicy(snapshot,{sourceId:policySnapshot.sourceId,expected:policySnapshot.receipt,kind:policySnapshot.kind,network:input.identity.network},runtime);}
 return {selector,snapshotSha256:sha256,policySnapshot,policyWire:policySnapshot===null?null:canonicalJson(policySnapshot),existing:input.existing};
}
export function captureHostedSourceClaimPolicy(value:unknown,input:{sourceId:string;expected?:SourceClaimReceipt|null;kind:'fetch'|'citation';network:string},runtime:SourceClaimPolicyRuntime):SourceClaimPolicyCapture{
 const selector=sourceClaimPolicySelector({sourceId:input.sourceId,identity:null}),{snapshot,sha256}=decodeSourceClaimPolicySnapshot(value,selector);
 assertSourceClaimPaymentPolicy(snapshot,input,runtime);
 const policySnapshot={sourceId:input.sourceId,receipt:input.expected??null,kind:input.kind};
 return {selector,snapshotSha256:sha256,policySnapshot,policyWire:canonicalJson(policySnapshot),existing:false};
}

import { createHash,randomBytes } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { canonicalSourceUrl,sourceClaimSchema,sourceClaimChallengeSchema,SOURCE_CLAIM_CHALLENGE_TTL_MS,SOURCE_CLAIM_PROOF_MAX_AGE_MS,type IssueSourceClaimChallenge,type VerifySourceClaim,type BindSourceClaim,type UpdateSourceClaimPolicy,type SourceClaim } from '../../sources/public-source-claim';
import { SourceClaimError } from '../public-source-claims';
import { SOURCE_UPKEEP_BATCH,SOURCE_UPKEEP_KEY,SOURCE_UPKEEP_LEASE_MS,type SourceUpkeepClaim,type SourceUpkeepSummary } from '../source-upkeep';
import { PUBLIC_FEED_BATCH_ITEMS } from '../../public-references/limits';
import { sourceClaimByIdSnapshot,sourceClaimForSourceSnapshot } from './source-claim-purchase-policy';
import { PostgresStorageUnavailable } from './connection';

export const SOURCE_PRODUCER_PREFIX='keryx:source-claims:v1:';
const sha=(text:string)=>createHash('sha256').update(text).digest('hex'),hash=z.string().regex(/^[a-f0-9]{64}$/),clock=z.number(),text=z.string().max(2048),wallet=z.string().max(256),revision=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const selection=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('issue'),input:z.object({now:clock,challenge:sourceClaimChallengeSchema}).strict()}).strict(),
 z.object({operation:z.literal('reserve'),input:z.object({now:clock,challengeId:hash,wallet}).strict()}).strict(),
 z.object({operation:z.literal('verify'),input:z.object({now:clock,challengeId:hash,wallet,proofDigest:hash}).strict()}).strict(),
 z.object({operation:z.literal('bind'),input:z.object({now:clock,claimId:hash,wallet,expectedRevision:revision,sourceId:z.string().min(1).max(256),onchainId:text,registryAddress:text}).strict()}).strict(),
 z.object({operation:z.literal('policy'),input:z.object({now:clock,claimId:hash,wallet,expectedRevision:revision,mode:z.enum(['free','citation-only','paid']),distributionPermission:z.boolean()}).strict()}).strict(),
 z.object({operation:z.literal('upkeep-claim'),input:z.object({now:clock}).strict()}).strict(),
 // Source deliberately ignores malformed completion metadata for a stale slot.
 z.object({operation:z.literal('upkeep-finish'),input:z.object({now:clock,claim:z.object({slot:z.number(),sourceIds:z.array(z.string()).max(1000)}).strict(),summary:z.unknown()}).strict()}).strict(),
]);
export type SourceProducerSelection=z.infer<typeof selection>;
const row=z.object({key:z.string(),value:z.string()}).strict(),snapshot=z.object({selector:selection,rows:z.array(row).max(10000),source:z.record(z.string(),z.unknown()).nullable(),candidates:z.array(z.string().max(512)).max(10000)}).strict();
export interface SourceProducerChange {key:string;value:string;updatedAt:string;insertOnly:boolean;}
export interface SourceProducerPlan {selector:string;snapshotSha256:string;sourceParser:{rawUrlSha256:string;canonicalUrl:string}|null;changes:SourceProducerChange[];result:unknown;}
const representable=(value:unknown):boolean=>typeof value==='string'?!value.includes('\0')&&Buffer.from(value).toString('utf8')===value:Array.isArray(value)?value.every(representable):value!==null&&typeof value==='object'?Object.entries(value).every(([k,v])=>representable(k)&&representable(v)):true;
export function sourceProducerSelector(value:SourceProducerSelection):string{
 const parsed=selection.parse(value);if(!representable(parsed))throw new PostgresStorageUnavailable();const wire=canonicalJson(parsed);if(Buffer.byteLength(wire)>32768)throw new PostgresStorageUnavailable();return wire;
}
export function captureSourceClaimIssue(input:IssueSourceClaimChallenge,random:()=>string=()=>randomBytes(32).toString('hex')):SourceProducerSelection{
 const now=input.now??Date.now(),canonicalUrl=canonicalSourceUrl(input.canonicalUrl),rssUrl=input.rssUrl?canonicalSourceUrl(input.rssUrl):undefined;
 if(rssUrl&&new URL(rssUrl).origin!==new URL(canonicalUrl).origin)throw new SourceClaimError('Feed and source must share an HTTPS origin',400,'feed_origin_mismatch');
 if(input.proofMethod==='rss-channel'&&(!rssUrl||!input.publicReferenceId&&canonicalUrl!==rssUrl))throw new SourceClaimError('General RSS claims verify the exact feed URL; an approved catalog reference is required to bind a different homepage',400,'feed_scope_mismatch');
 const claimId=sha(canonicalJson({canonicalUrl,deploymentOrigin:input.deploymentOrigin,network:input.network})),challenge=sourceClaimChallengeSchema.parse({id:random(),claimId,wallet:input.wallet,canonicalUrl,...(rssUrl?{rssUrl}:{}),...(input.publicReferenceId?{publicReferenceId:input.publicReferenceId}:{}),deploymentOrigin:input.deploymentOrigin,network:input.network,nonce:random(),createdAt:new Date(now).toISOString(),expiresAt:new Date(now+SOURCE_CLAIM_CHALLENGE_TTL_MS).toISOString(),proofMethod:input.proofMethod??'website-file'});
 return selection.parse({operation:'issue',input:{now,challenge}});
}
export function captureSourceClaimReserve(challengeId:string,owner:string,now=Date.now()):SourceProducerSelection{return selection.parse({operation:'reserve',input:{now,challengeId,wallet:owner.toLowerCase()}});}
export function captureSourceClaimVerify(input:VerifySourceClaim):SourceProducerSelection{return selection.parse({operation:'verify',input:{now:input.now??Date.now(),challengeId:input.challengeId,wallet:input.wallet.toLowerCase(),proofDigest:input.proofDigest}});}
export function captureSourceClaimBind(input:BindSourceClaim):SourceProducerSelection{return selection.parse({operation:'bind',input:{now:input.now??Date.now(),claimId:input.claimId,wallet:input.wallet.toLowerCase(),expectedRevision:input.expectedRevision,sourceId:input.sourceId,onchainId:input.onchainId,registryAddress:input.registryAddress}});}
export function captureSourceClaimPolicy(input:UpdateSourceClaimPolicy):SourceProducerSelection{return selection.parse({operation:'policy',input:{now:input.now??Date.now(),claimId:input.claimId,wallet:input.wallet.toLowerCase(),expectedRevision:input.expectedRevision,mode:input.mode,distributionPermission:input.distributionPermission}});}
export function captureSourceUpkeepClaim(now:number):SourceProducerSelection{if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid upkeep clock');return selection.parse({operation:'upkeep-claim',input:{now}});}
export function captureSourceUpkeepFinish(claim:SourceUpkeepClaim,summary:SourceUpkeepSummary,now:number):SourceProducerSelection{return selection.parse({operation:'upkeep-finish',input:{now,claim:{slot:claim.slot,sourceIds:[...claim.sourceIds]},summary:JSON.parse(JSON.stringify(summary))}});}
export function decodeSourceProducerSnapshot(raw:unknown,selector:string){
 const envelope=z.object({wire:z.string(),sha256:hash}).strict().parse(raw);if(Buffer.byteLength(envelope.wire)>8388608||sha(envelope.wire)!==envelope.sha256)throw new PostgresStorageUnavailable();
 const value=snapshot.parse(JSON.parse(envelope.wire));if(sourceProducerSelector(value.selector)!==selector||new Set(value.rows.map(r=>r.key)).size!==value.rows.length)throw new PostgresStorageUnavailable();return {snapshot:value,sha256:envelope.sha256};
}
function upkeepState(raw:string){
 const state=JSON.parse(raw) as {slot:number;cursor:string;leaseUntil:number;completedAt?:string;summary?:SourceUpkeepSummary}|null,integer=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
 if(!state||!integer(state.slot)||!integer(state.leaseUntil)||typeof state.cursor!=='string'||state.cursor.length>512||state.completedAt!==undefined&&(typeof state.completedAt!=='string'||!Number.isFinite(Date.parse(state.completedAt)))||state.summary!==undefined&&(!state.summary||!integer(state.summary.attempted)||state.summary.attempted>SOURCE_UPKEEP_BATCH||!integer(state.summary.added)||state.summary.added>SOURCE_UPKEEP_BATCH*PUBLIC_FEED_BATCH_ITEMS||!integer(state.summary.failed)||state.summary.failed>SOURCE_UPKEEP_BATCH||!integer(state.summary.skipped)||state.summary.skipped>SOURCE_UPKEEP_BATCH))throw Error('Invalid upkeep journal');return state;
}
/** Pure Source transition. No SQLite engine, network, SQL or callback is used.
 * SQL checks this exact closed transition again after obtaining the writer lock. */
export function reduceSourceProducer(raw:unknown,query:SourceProducerSelection):SourceProducerPlan{
 const selector=sourceProducerSelector(query),decoded=decodeSourceProducerSnapshot(raw,selector),data=decoded.snapshot,values=new Map(data.rows.map(r=>[r.key,r.value])),changes:SourceProducerChange[]=[],prefix=SOURCE_PRODUCER_PREFIX;
 const read=(key:string)=>{const v=values.get(prefix+key);return v===undefined?null:JSON.parse(v);},now=query.input.now;
 const put=(key:string,value:unknown,insertOnly=false,ordinary=false)=>{const full=ordinary?key:prefix+key;if(insertOnly&&values.has(full))throw new SourceClaimError('Source claim revision already exists');const wire=ordinary?JSON.stringify(value):canonicalJson(value);changes.push({key:full,value:wire,updatedAt:new Date(now).toISOString(),insertOnly});};
 const claim=(id:string)=>{const value=sourceClaimByIdSnapshot({rows:data.rows,retainedValues:values},id);if(value&&value.id!==id)throw Error('Retained source claim key differs');if(!value&&(values.has(prefix+'claim:'+id)||data.rows.some(r=>r.key.startsWith(prefix+'history:'+id+':'))))throw Error('Retained current source claim unavailable');return value;};
 const owned=(id:string,owner:string,expected:number)=>{const c=claim(id);if(!c)throw new SourceClaimError('Source claim not found',404,'claim_not_found');if(c.ownerWallet!==owner.toLowerCase())throw new SourceClaimError('Only the verified source owner may change this claim',403,'wrong_owner');if(c.revision!==expected)throw new SourceClaimError('Source claim changed; refresh before continuing');return c;};
 const save=(value:SourceClaim,action:string,evidence:unknown={})=>{const checked=sourceClaimSchema.parse(value);put('history:'+checked.id+':'+String(checked.revision).padStart(16,'0'),{claim:checked,action,at:new Date(now).toISOString(),evidence},true);put('claim:'+checked.id,checked);return checked;};
 const rate=(key:string,limit:number)=>{const raw=read(key),old=raw?z.object({hour:z.number().int().nonnegative(),count:z.number().int().nonnegative().max(10)}).strict().parse(raw):null,hour=Math.floor(now/3600000),count=old?.hour===hour?old.count:0;if(count>=limit)throw new SourceClaimError(limit===5?'Source claim challenge limit reached; retry next hour':'Source verification limit reached; retry next hour',429,'claim_rate_limit');put(key,{hour,count:count+1});};
 let result:unknown;
 if(query.operation==='issue'){
  const challenge=query.input.challenge,current=claim(challenge.claimId);if(current&&current.ownerWallet!==challenge.wallet)throw new SourceClaimError('This source already has a verified owner');if(current&&(current.rssUrl!==challenge.rssUrl||current.publicReferenceId!==challenge.publicReferenceId))throw new SourceClaimError('Retain the original feed and catalog identity when refreshing proof');
  if(values.has(prefix+'challenge:'+challenge.id))throw Error('Source challenge identity already retained');rate('rate:'+challenge.wallet,5);put('challenge:'+challenge.id,challenge,true);result=challenge;
 }else if(query.operation==='reserve'||query.operation==='verify'){
  const input=query.input,raw=read('challenge:'+input.challengeId),challenge=raw?sourceClaimChallengeSchema.parse(raw):null;
  if(!challenge||challenge.id!==input.challengeId||challenge.wallet!==input.wallet.toLowerCase())throw new SourceClaimError('Claim challenge unavailable for this wallet',403);
  if(challenge.consumedAt||now<Date.parse(challenge.createdAt)||now>=Date.parse(challenge.expiresAt))throw new SourceClaimError('Claim challenge expired or already used',409,'challenge_expired');
  if(query.operation==='reserve'){rate('verify-rate:'+challenge.wallet,10);result=challenge;}else{
   const current=claim(challenge.claimId);if(current&&current.ownerWallet!==challenge.wallet)throw new SourceClaimError('Source ownership changed during verification');if(current&&(current.rssUrl!==challenge.rssUrl||current.publicReferenceId!==challenge.publicReferenceId))throw new SourceClaimError('Source feed or catalog identity changed during verification');
   const at=new Date(now).toISOString(),next=current?{...current,verifiedAt:at,proofMethod:challenge.proofMethod,revision:current.revision+1}:{id:challenge.claimId,canonicalUrl:challenge.canonicalUrl,rssUrl:challenge.rssUrl,publicReferenceId:challenge.publicReferenceId,ownerWallet:challenge.wallet,deploymentOrigin:challenge.deploymentOrigin,network:challenge.network,verifiedAt:at,revision:1,effectiveAt:at,mode:'free' as const,distributionPermission:false,proofMethod:challenge.proofMethod};
   result=save(next,'verified',{challengeId:challenge.id,proofDigest:query.input.proofDigest});put('challenge:'+challenge.id,{...challenge,consumedAt:at});
  }
 }else if(query.operation==='bind'){
  const input=query.input,current=owned(input.claimId,input.wallet,input.expectedRevision);if(input.sourceId.startsWith('public:'))throw new SourceClaimError('Public reference identities remain permanently free',400);
  const s=data.source;if(s&&(s.id!==input.sourceId||canonicalSourceUrl(String(s.url))!==current.canonicalUrl||String(s.onchain_id).toLowerCase()!==input.onchainId.toLowerCase()||current.rssUrl&&s.rss_url!==current.rssUrl))throw new SourceClaimError('Indexed source changed before the claim could be bound');
  if(current.linkedSourceId&&(current.linkedSourceId!==input.sourceId||current.onchainId?.toLowerCase()!==input.onchainId.toLowerCase()||current.registryAddress!==input.registryAddress.toLowerCase()))throw new SourceClaimError('This claim is already linked to another registry source');
  const other=sourceClaimForSourceSnapshot({rows:data.rows,retainedValues:values},input.sourceId);if(other&&other.id!==current.id)throw new SourceClaimError('Registry source already belongs to another claim');
  if(current.linkedSourceId){put('marker:'+sha(input.sourceId),{sourceId:input.sourceId,claimId:current.id});result=current;}else{result=save({...current,linkedSourceId:input.sourceId,onchainId:input.onchainId,registryAddress:input.registryAddress,mode:'free',distributionPermission:false,effectiveAt:new Date(now).toISOString(),revision:current.revision+1},'linked-free');put('source:'+sha(input.sourceId),{sourceId:input.sourceId,claimId:current.id});put('marker:'+sha(input.sourceId),{sourceId:input.sourceId,claimId:current.id});}
 }else if(query.operation==='policy'){
  const input=query.input,current=owned(input.claimId,input.wallet,input.expectedRevision);if(input.mode!=='free'&&(!current.linkedSourceId||!input.distributionPermission))throw new SourceClaimError('Link a registry source and explicitly confirm distribution permission before enabling earnings',400);
  if(input.mode!=='free'&&(now<Date.parse(current.verifiedAt)||now-Date.parse(current.verifiedAt)>SOURCE_CLAIM_PROOF_MAX_AGE_MS))throw new SourceClaimError('Refresh source-control proof before enabling earnings',409,'proof_refresh_required');result=save({...current,mode:input.mode,distributionPermission:input.mode!=='free'&&input.distributionPermission,effectiveAt:new Date(now).toISOString(),revision:current.revision+1},'policy');
 }else{
  const raw=values.get(SOURCE_UPKEEP_KEY),state=raw===undefined?null:upkeepState(raw);
  if(query.operation==='upkeep-claim'){
   if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid upkeep clock');const slot=Math.floor(now/3600000);if(state&&(slot<=state.slot||now<state.leaseUntil))result=null;
   else{const cursor=Buffer.from(state?.cursor??''),ids=[...data.candidates].sort((a,b)=>{const left=Buffer.from(a),right=Buffer.from(b),section=Number(Buffer.compare(left,cursor)<=0)-Number(Buffer.compare(right,cursor)<=0);return section||Buffer.compare(left,right);}).slice(0,SOURCE_UPKEEP_BATCH);put(SOURCE_UPKEEP_KEY,{slot,cursor:ids.at(-1)??state?.cursor??'',leaseUntil:now+SOURCE_UPKEEP_LEASE_MS},false,true);result={slot,sourceIds:ids};}
  }else{if(state?.slot===query.input.claim.slot){const value={...state,leaseUntil:0,completedAt:new Date(now).toISOString(),summary:query.input.summary};upkeepState(JSON.stringify(value));put(SOURCE_UPKEEP_KEY,value,false,true);}result=null;}
 }
 // Protected Node owns WHATWG parsing, as with Source. This derivative is
 // calculated only from the observed row and bound to both its exact URL SHA
 // and the complete SQL snapshot CAS. It is never external ownership proof.
 const sourceParser=query.operation==='bind'&&data.source?{rawUrlSha256:sha(String(data.source.url)),canonicalUrl:canonicalSourceUrl(String(data.source.url))}:null;
 const plan={selector,snapshotSha256:decoded.sha256,sourceParser,changes,result};if(Buffer.byteLength(canonicalJson(plan))>524288)throw new PostgresStorageUnavailable();return plan;
}

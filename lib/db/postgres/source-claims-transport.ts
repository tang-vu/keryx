import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { sourceClaimSchema,sourceClaimChallengeSchema,type SourceClaim,type SourceClaimChallenge } from '../../sources/public-source-claim';
import { normalizePreviewDepth } from '../../sources/preview-depth';
import { sourceRegistryAuthoritySchema } from '../../registry/source-registry-authority-schema';
import type { Source } from '../../types';
import type { SourceMeta } from '../keryx-db';
import { sourceClaimByIdSnapshot,sourceClaimForSourceSnapshot,retainedSourceLinkedIdentity } from './source-claim-purchase-policy';
import { PostgresStorageUnavailable } from './connection';
import type { PostgresDomainChannel } from './domain-channel';

const prefix='keryx:source-claims:v1:',sha=(v:string)=>createHash('sha256').update(v).digest('hex'),hash=/^[a-f0-9]{64}$/;
const sqliteLower=(v:string)=>v.replace(/[A-Z]/g,c=>c.toLowerCase());
const operation=z.enum(['claim','for-source','challenge','claims','source','onchain','sources','all-sources','source-meta']);
const selection=z.object({operation,selector:z.string().nullable()}).strict(),record=z.record(z.string(),z.unknown());
const snapshot=z.object({selector:selection,sources:z.array(record).max(1000),rows:z.array(z.object({key:z.string(),value:z.string()}).strict()).max(10000),meta:record.nullable()}).strict();
const binding=z.object({sourceId:z.string().min(1).max(256),claimId:z.string().regex(hash)}).strict();
const origin=z.object({format:z.literal('keryx-source-registry-origin-v1'),onchainId:z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v=>v.toLowerCase()),authority:sourceRegistryAuthoritySchema}).strict();
export type SourceClaimsSelection=z.infer<typeof selection>;
type Snapshot=z.infer<typeof snapshot>;
export interface PostgresSourceClaimsPort {
 getSourceClaim(id:string):Promise<SourceClaim|null>;
 getSourceClaimForSource(sourceId:string):Promise<SourceClaim|null>;
 getSourceClaimChallenge(id:string):Promise<SourceClaimChallenge|null>;
 listSourceClaims(wallet?:string):Promise<SourceClaim[]>;
 getSource(id:string):Promise<Source|null>;
 getSourceByOnchainId(onchainId:string):Promise<Source|null>;
 listSources():Promise<Source[]>;
 listAllSources():Promise<Source[]>;
 getSourceMeta(id:string):Promise<SourceMeta|null>;
}
function selector(input:SourceClaimsSelection){
 const value=selection.parse(input),text=value.selector;
 if(text!==null&&(text.length>256||text.includes('\0')||Buffer.from(text).toString('utf8')!==text)||!['claims','sources','all-sources'].includes(value.operation)&&!text)throw new PostgresStorageUnavailable();
 return canonicalJson(value);
}
function decode(raw:unknown,wire:string):Snapshot{
 const value=z.object({wire:z.string(),sha256:z.string().regex(hash)}).strict().parse(raw);
 if(Buffer.byteLength(value.wire)>8388608||sha(value.wire)!==value.sha256)throw new PostgresStorageUnavailable();
 const parsed=snapshot.parse(JSON.parse(value.wire));
 if(canonicalJson(parsed.selector)!==wire||new Set(parsed.rows.map(r=>r.key)).size!==parsed.rows.length||new Set(parsed.sources.map(r=>r.id)).size!==parsed.sources.length)throw new PostgresStorageUnavailable();
 if(Buffer.byteLength(JSON.stringify(parsed.sources))>4194304||parsed.meta!==null&&Buffer.byteLength(JSON.stringify(parsed.meta))>4194304)throw new PostgresStorageUnavailable();
 return parsed;
}
interface ReadContext {retained:ReadonlyMap<string,string>;linked?:Map<string,string>;}
function retainedMarker(context:ReadContext,sourceId:string):string|null{
 const retained=context.retained,suffix=sha(sourceId),direct=retained.get(prefix+'marker:'+suffix)??retained.get(prefix+'source:'+suffix),unavailable=sha('unavailable-source-claim:'+sourceId);
 if(direct!==undefined){try{const parsed=binding.parse(JSON.parse(direct));return parsed.sourceId===sourceId?parsed.claimId:unavailable;}catch{return unavailable;}}
 if(!context.linked){const linked=new Map<string,string>();for(const [key,raw] of retained)if(key.startsWith(prefix+'claim:')||key.startsWith(prefix+'history:')){
  const id=retainedSourceLinkedIdentity(raw);if(id===undefined)continue;
  const unavailable=sha('unavailable-source-claim:'+id);let marker=unavailable;try{const parsed=JSON.parse(raw),claim=sourceClaimSchema.safeParse(key.startsWith(prefix+'history:')?parsed.claim:parsed);if(claim.success&&claim.data.linkedSourceId===id)marker=claim.data.id;}catch{}
  const prior=linked.get(id);linked.set(id,prior!==undefined&&prior!==marker?unavailable:marker);
 }context.linked=linked;}
 return context.linked.get(sourceId)??null;
}
function registryOrigin(context:ReadContext,id:unknown){
 if(typeof id!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(id))return undefined;
 const raw=context.retained.get('keryx:source-registry-origin:v1:'+id.toLowerCase());if(raw===undefined)return undefined;
 const parsed=origin.parse(JSON.parse(raw));if(parsed.onchainId!==id.toLowerCase())throw new PostgresStorageUnavailable();return parsed.authority;
}
function source(context:ReadContext,row:Record<string,unknown>):Source{
 if(typeof row.id!=='string')throw new PostgresStorageUnavailable();
 const marker=retainedMarker(context,row.id),authority=registryOrigin(context,row.onchain_id);
 return {...(row.scholarly_enrolled===1?{scholarlyEnrolled:true}:{}),...(marker?{sourceClaimId:marker}:{}),...(authority?{registryAuthority:authority}:{}),
  evidenceProvenance:row.evidence_provenance==='synthetic-demo'?'synthetic-demo':undefined,id:row.id,name:row.name as string,url:row.url as string,description:row.description as string,rssUrl:(row.rss_url as string)??undefined,walletAddress:row.wallet_address as string,fetchPrice:row.fetch_price as number,tags:(row.tags===undefined?[]:row.tags) as Source['tags'],authors:(row.authors===undefined?[]:row.authors) as Source['authors'],createdAt:row.created_at as string,ipfsCid:(row.ipfs_cid as string)??undefined,active:row.active===undefined||row.active===null?true:Boolean(row.active),onchainId:(row.onchain_id as string)??undefined,registerTx:(row.register_tx as string)??undefined,verified:row.verified===undefined||row.verified===null?true:Boolean(row.verified),previewDepth:normalizePreviewDepth(row.preview_depth)};
}
/** One protected transaction supplies the complete current catalog row and its
 * retained marker/origin. No prior price/URL/body is enriched after an await. */
export function decodeSourceClaimsRead(raw:unknown,query:SourceClaimsSelection):Source|Source[]|SourceClaim|SourceClaim[]|SourceClaimChallenge|SourceMeta|null{
 const input=decode(raw,selector(query)),retained=new Map(input.rows.map(row=>[row.key,row.value])),context:ReadContext={retained},rows={rows:input.rows,retainedValues:retained},id=query.selector;
 if(query.operation==='claim'){
  const claim=sourceClaimByIdSnapshot(rows,id!);
  if(!claim&&(retained.has(prefix+'claim:'+id)||input.rows.some(row=>row.key.startsWith(prefix+'history:'+id+':'))))throw Error('Retained current source claim unavailable');
  if(claim&&claim.id!==id)throw Error('Retained source claim key identity differs');return claim;
 }
 if(query.operation==='for-source')return sourceClaimForSourceSnapshot(rows,id!);
 if(query.operation==='challenge'){const raw=retained.get(prefix+'challenge:'+id);if(raw===undefined)return null;const value=sourceClaimChallengeSchema.parse(JSON.parse(raw));if(value.id!==id)throw Error('Retained source challenge key identity differs');return value;}
 if(query.operation==='claims'){
  const claims=input.rows.filter(row=>row.key.startsWith(prefix+'claim:'));if(claims.length>1000)throw Error('Source claim listing limit exceeded');
  const current=new Set(claims.map(row=>row.key.slice((prefix+'claim:').length)));for(const row of input.rows)if(row.key.startsWith(prefix+'history:')){const id=row.key.slice((prefix+'history:').length).split(':')[0];if(!current.has(id))throw Error('Retained source claim listing unavailable');}
  return claims.map(row=>{const parsed=sourceClaimSchema.parse(JSON.parse(row.value)),claim=sourceClaimByIdSnapshot(rows,parsed.id);if(!claim||row.key!==prefix+'claim:'+claim.id)throw Error('Retained source claim listing unavailable');return claim;}).filter(claim=>!id||claim.ownerWallet===id.toLowerCase());
 }
 if(query.operation==='source-meta'){const row=input.meta;if(row===null)return null;if(row.id!==id)throw new PostgresStorageUnavailable();const authority=registryOrigin(context,id);return {...(authority?{registryAuthority:authority}:{}),name:(row.name as string)??'',description:(row.description as string)??'',url:(row.url as string)??'',rssUrl:(row.rss_url as string)||undefined};}
 const sources=input.sources.map(row=>source(context,row));
 if(query.operation==='sources'||query.operation==='all-sources'){
  if(query.operation==='sources'&&sources.some(row=>!row.active))throw new PostgresStorageUnavailable();return sources;
 }
 if(sources.length>1||sources.length===1&&(query.operation==='source'?sources[0].id!==id:typeof sources[0].onchainId!=='string'||sqliteLower(sources[0].onchainId!)!==sqliteLower(id!)))throw new PostgresStorageUnavailable();
 return sources[0]??null;
}
export function composePostgresSourceClaims(channel:PostgresDomainChannel):PostgresSourceClaimsPort{
 const read=async(query:SourceClaimsSelection)=>{if(channel.closed)throw new PostgresStorageUnavailable();const wire=selector(query),raw=await channel.call('sourceClaimsRead' as Parameters<PostgresDomainChannel['call']>[0],[wire]);if(channel.closed)throw new PostgresStorageUnavailable();return decodeSourceClaimsRead(raw,query);};
 return Object.freeze({
  async getSourceClaim(id:string){if(channel.closed)throw new PostgresStorageUnavailable();if(typeof id!=='string'||!hash.test(id))return null;return await read({operation:'claim',selector:id}) as SourceClaim|null;},
  async getSourceClaimForSource(id:string){return await read({operation:'for-source',selector:id}) as SourceClaim|null;},
  async getSourceClaimChallenge(id:string){if(channel.closed)throw new PostgresStorageUnavailable();if(typeof id!=='string'||!hash.test(id))return null;return await read({operation:'challenge',selector:id}) as SourceClaimChallenge|null;},
  async listSourceClaims(wallet?:string){return await read({operation:'claims',selector:wallet??null}) as SourceClaim[];},
  async getSource(id:string){return await read({operation:'source',selector:id}) as Source|null;},
  async getSourceByOnchainId(id:string){return await read({operation:'onchain',selector:id}) as Source|null;},
  async listSources(){return await read({operation:'sources',selector:null}) as Source[];},
  async listAllSources(){return await read({operation:'all-sources',selector:null}) as Source[];},
  async getSourceMeta(id:string){return await read({operation:'source-meta',selector:id}) as SourceMeta|null;},
 });
}

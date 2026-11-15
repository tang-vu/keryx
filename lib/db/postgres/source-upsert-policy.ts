import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { canonicalSourceUrl } from '../../sources/public-source-claim';
import { sourceRegistryAuthoritySchema,sameRegistryAuthority } from '../../registry/source-registry-authority-schema';
import { configuredRegistryAuthorities,assertConfiguredRegistryAuthority } from '../../registry/source-registry-authority';
import { config } from '../../config';
import type { Source } from '../../types';
import type { SourceMeta } from '../keryx-db';
import { decodeSourceClaimPolicySnapshot,sourceClaimForSourceSnapshot,sourceClaimPolicySelector,sourceClaimPolicyRuntime,type SourceClaimPolicyRuntime } from './source-claim-purchase-policy';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';

const sha=(text:string)=>createHash('sha256').update(text).digest('hex'),originPrefix='keryx:source-registry-origin:v1:';
const idSchema=z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v=>v.toLowerCase());
const originSchema=z.object({format:z.literal('keryx-source-registry-origin-v1'),onchainId:idSchema,authority:sourceRegistryAuthoritySchema}).strict();
function retainedOrigin(id:unknown,raw:string|null){
 const parsed=idSchema.safeParse(id);if(!parsed.success||raw===null)return undefined;
 const envelope=originSchema.parse(JSON.parse(raw));if(envelope.onchainId!==parsed.data)throw Error('Source registry origin journal unavailable');return envelope.authority;
}
export function captureSourceUpsertInput(raw:Source){
 const source=JSON.parse(canonicalJson({id:raw.id,name:raw.name,url:raw.url,description:raw.description,rssUrl:raw.rssUrl,walletAddress:raw.walletAddress,fetchPrice:raw.fetchPrice,tags:raw.tags,authors:raw.authors,createdAt:raw.createdAt,ipfsCid:raw.ipfsCid,active:raw.active,verified:raw.verified,onchainId:raw.onchainId,registerTx:raw.registerTx,previewDepth:raw.previewDepth,evidenceProvenance:raw.evidenceProvenance,sourceClaimId:raw.sourceClaimId,registryAuthority:raw.registryAuthority,scholarlyEnrolled:raw.scholarlyEnrolled})) as Source;
 if(typeof source.id!=='string'||source.id.length<1||source.id.length>256||source.id.startsWith('public:'))throw Error('Source upsert identity refused');
 if(source.scholarlyEnrolled)throw Error('Scholarly enrolled sources require their original supported rights writer');
 if(source.registryAuthority&&!source.onchainId)throw Error('Registry origin requires the exact on-chain source ID');
 if(source.registryAuthority){idSchema.parse(source.onchainId);source.registryAuthority=sourceRegistryAuthoritySchema.parse(source.registryAuthority);}
 const representable=(v:unknown):boolean=>typeof v==='string'?!v.includes('\0')&&Buffer.from(v).toString('utf8')===v:Array.isArray(v)?v.every(representable):v!==null&&typeof v==='object'?Object.entries(v).every(([k,value])=>representable(k)&&representable(value)):true;
 if(!representable(source))throw Error('Source upsert text cannot be represented natively');
 const row={id:source.id,name:source.name,url:source.url,description:source.description,rss_url:source.rssUrl??null,wallet_address:source.walletAddress,fetch_price:source.fetchPrice,tags:source.tags,authors:source.authors,created_at:source.createdAt,ipfs_cid:source.ipfsCid??null,active:source.active!==false,verified:source.verified!==false,preview_depth:source.previewDepth??null,evidence_provenance:source.evidenceProvenance??null,onchain_id:source.onchainId??null,register_tx:source.registerTx??null};
 const rowWire=canonicalJson(row);if(Buffer.byteLength(rowWire)>262144)throw Error('Source row capture bound');
 const selector=canonicalJson({sourceId:source.id,onchainId:source.onchainId??null,bindOrigin:Boolean(source.registryAuthority)});if(Buffer.byteLength(selector)>2048)throw Error('Source selector bound');
 return {source,rowWire,selector};
}
export interface SourceUpsertCapture {sourceSelector:string;sourceSnapshotSha256:string;candidateOriginWire:string|null;bindOrigin:boolean;registryBinding:{key:string;value:string}|null;rowSha256:string;}
/** SourceMeta is independent of catalog/claim state. These are observed SQLite
 * scalar bindings, not sanitized originals. NUL requires a separate qualified
 * raw-scalar storage/read protocol and remains a whole-packet refusal here. */
export function captureSourceMetaInput(id:string,raw:SourceMeta){
 if(typeof id!=='string'||id.length<1||id.length>256||id.includes('\0')||Buffer.from(id).toString('utf8')!==id)throw Error('Native metadata identity unsupported');
 const scalar=(value:unknown)=>{if(typeof value!=='string')throw Error('Source metadata scalar unavailable');if(value.length>262144)throw Error('Source metadata packet bound');const bound=Buffer.from(value).toString('utf8');if(bound.includes('\0'))throw Error('Native metadata NUL surface unsupported');return bound;};
 const name=raw.name,description=raw.description,url=raw.url,rss=raw.rssUrl,proposed=raw.registryAuthority;
 const row={id,name:scalar(name),description:scalar(description),url:scalar(url),rss_url:rss==null?null:scalar(rss)};
 const authority=proposed?assertConfiguredRegistryAuthority(proposed):null;
 const selector=authority?canonicalJson({operation:'source-meta-origin',onchainId:idSchema.parse(id)}):null;
 const value={row,authority,selector};if(Buffer.byteLength(canonicalJson({p_row:{row,origin:null}}))>262144)throw Error('Source metadata packet bound');return value;
}
const metaOriginSelector=z.object({operation:z.literal('source-meta-origin'),onchainId:idSchema}).strict();
function metadataOriginRuntime(){return canonicalJson({network:config.networkId??config.profile.networkId,authorities:configuredRegistryAuthorities()});}
/** Local raw-origin CAS only; never a claim, registry-event or funding proof. */
export function captureSourceMetaOrigin(raw:unknown,input:ReturnType<typeof captureSourceMetaInput>){
 if(input.authority===null||input.selector===null)throw Error('Metadata origin was not requested');
 const envelope=z.object({wire:z.string().max(32768),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(raw);
 if(Buffer.byteLength(envelope.wire)>32768||sha(envelope.wire)!==envelope.sha256)throw Error('Metadata origin snapshot digest unavailable');
 const snapshot=z.object({selector:metaOriginSelector,originWire:z.string().nullable()}).strict().parse(JSON.parse(envelope.wire));
 if(canonicalJson(snapshot.selector)!==input.selector||snapshot.originWire!==null&&Buffer.byteLength(snapshot.originWire)>8192)throw Error('Metadata origin snapshot differs');
 const retained=retainedOrigin(snapshot.selector.onchainId,snapshot.originWire);if(retained&&!sameRegistryAuthority(retained,input.authority))throw Error('Source ID already belongs to another immutable registry origin');
 return {authority:input.authority,beforeWire:snapshot.originWire,snapshotSha256:envelope.sha256};
}
/** Pure current SqliteAdapter.upsertSource guard. This does not authenticate
 * registry events, alter payout authority, refresh proof or change claim mode. */
export function captureSourceUpsertPolicy(raw:unknown,input:ReturnType<typeof captureSourceUpsertInput>,runtime:SourceClaimPolicyRuntime):SourceUpsertCapture{
 const envelope=z.object({source:z.unknown(),candidateOrigin:z.string().nullable()}).strict().parse(raw),sourceSelector=sourceClaimPolicySelector({sourceId:input.source.id,identity:null}),{snapshot,sha256}=decodeSourceClaimPolicySnapshot(envelope.source,sourceSelector),values=new Map(snapshot.rows.map(r=>[r.key,r.value])),priorIdentity=snapshot.source?.onchain_id;
 const priorRaw=typeof priorIdentity==='string'?values.get(originPrefix+priorIdentity.toLowerCase())??null:null;
 if(typeof priorIdentity==='string'&&retainedOrigin(priorIdentity,priorRaw)&&input.source.onchainId&&input.source.onchainId.toLowerCase()!==priorIdentity.toLowerCase())throw Error('Source row must retain its original bound on-chain identity');
 let registryBinding:SourceUpsertCapture['registryBinding']=null;
 if(input.source.registryAuthority){
  if(runtime.unavailable)throw Error('Source registry configuration unavailable');
  const authority=sourceRegistryAuthoritySchema.parse(input.source.registryAuthority),onchainId=idSchema.parse(input.source.onchainId);
  if(!runtime.authorities.some(candidate=>sameRegistryAuthority(candidate,authority)))throw Error('Source registry origin outside reviewed deployment allowlist');
  const retained=retainedOrigin(onchainId,envelope.candidateOrigin);
  if(retained&&!sameRegistryAuthority(retained,authority))throw Error('Source ID already belongs to another immutable registry origin');
  if(!retained)registryBinding={key:originPrefix+onchainId,value:canonicalJson({format:'keryx-source-registry-origin-v1',onchainId,authority})};
 }
 const claim=sourceClaimForSourceSnapshot(snapshot,input.source.id);
 if(input.source.sourceClaimId&&input.source.sourceClaimId!==claim?.id)throw Error('Managed source import requires original source claim history');
 if(claim&&(canonicalSourceUrl(input.source.url)!==claim.canonicalUrl||input.source.onchainId?.toLowerCase()!==claim.onchainId?.toLowerCase()||claim.rssUrl&&input.source.rssUrl!==claim.rssUrl))throw Error('Managed source identity differs from retained claim');
 if(!input.source.registryAuthority&&envelope.candidateOrigin!==null)throw Error('Unexpected registry candidate snapshot');
 return {sourceSelector,sourceSnapshotSha256:sha256,candidateOriginWire:envelope.candidateOrigin,bindOrigin:Boolean(input.source.registryAuthority),registryBinding,rowSha256:sha(input.rowWire)};
}
/** Fixed port; Source is captured before awaits. A changed locked predecessor
 * refuses, and an uncertain write is never retried or reported as committed. */
export function composePostgresSourceUpsert(channel:PostgresDomainChannel,readOnly:boolean):{upsertSource(source:Source):Promise<void>;setSourceMeta(id:string,meta:SourceMeta):Promise<void>}{
 if(typeof readOnly!=='boolean')throw new PostgresStorageUnavailable();
 return Object.freeze({async upsertSource(raw:Source){
  if(channel.closed||readOnly)throw new PostgresStorageUnavailable();
  const input=captureSourceUpsertInput(raw),runtime=sourceClaimPolicyRuntime(),configWire=input.source.registryAuthority?canonicalJson(runtime):null;
  const snapshot=await channel.call('content_source_upsert_snapshot' as Parameters<PostgresDomainChannel['call']>[0],[input.selector]);
  if(channel.closed||configWire!==null&&canonicalJson(sourceClaimPolicyRuntime())!==configWire)throw new PostgresStorageUnavailable();
  const sourceUpsertCapture=captureSourceUpsertPolicy(snapshot,input,runtime),wire=canonicalJson({p_row:{rowWire:input.rowWire,sourceUpsertCapture}});
  if(Buffer.byteLength(wire)>524288)throw new PostgresStorageUnavailable();
  const result=await channel.call('content_upsert_source',[wire]);
  if(channel.closed||result!==null||configWire!==null&&canonicalJson(sourceClaimPolicyRuntime())!==configWire)throw new PostgresDomainWriteOutcomeUnknown();
 },async setSourceMeta(id:string,raw:SourceMeta){
  if(channel.closed||readOnly)throw new PostgresStorageUnavailable();
  const input=captureSourceMetaInput(id,raw),runtime=input.authority===null?null:metadataOriginRuntime();
  let origin:ReturnType<typeof captureSourceMetaOrigin>|null=null;
  if(input.selector!==null){
   const snapshot=await channel.call('content_source_meta_origin_snapshot' as Parameters<PostgresDomainChannel['call']>[0],[input.selector]);
   let current:string;try{current=metadataOriginRuntime();}catch{throw new PostgresStorageUnavailable();}
   if(channel.closed||current!==runtime)throw new PostgresStorageUnavailable();origin=captureSourceMetaOrigin(snapshot,input);
  }
  const packet=canonicalJson({p_row:{row:input.row,origin}});if(Buffer.byteLength(packet)>262144)throw new PostgresStorageUnavailable();
  const result=await channel.call('content_set_source_meta',[packet]);
  let stable=true;if(runtime!==null){try{stable=metadataOriginRuntime()===runtime;}catch{stable=false;}}
  if(channel.closed||result!==null||!stable)throw new PostgresDomainWriteOutcomeUnknown();
 }});
}

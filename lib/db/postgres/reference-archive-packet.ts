import { createHash } from 'node:crypto';
import { canonicalJson } from '../../canonical-json';
import { sourceItemContentVersion } from '../../sources/source-item-asset';
import { publicReferenceSchema,publicReferenceItemSchema,type PublicReference } from '../../public-references/catalog-contract';
import { archiveSearchTerms,type PublicReferenceItem,type PublicReferenceCollectionKind,type PublicReferenceQuery } from '../../public-references/archive';
import { decodeReference,normalizeItem,digest,prefer,timestamp,prepareArchiveQuery,finishArchiveQuery } from '../public-reference-archive-contract';
import { sqlitePaymentScalarText } from './payment-events-packet';

/** Bounded native operation capacity, never a lifetime publisher/library cap.
 * PostgreSQL allocation is qualified separately from SQLite file allocation. */
export const REFERENCE_ARCHIVE_NATIVE_LIMITS=Object.freeze({items:1000,inputBytes:32*1024*1024,fieldBytes:2*1024*1024,frameBytes:64*1024*1024,packetBytes:128*1024*1024,rows:500000,relationBytes:256*1024*1024});
export const archiveWireSha256=(wire:string)=>createHash('sha256').update(wire).digest('hex');
function bound(wire:string,bytes:number){if(Buffer.byteLength(wire)>bytes)throw Error('Native public archive operation bound');return wire;}
function copy<T>(value:T):T{return JSON.parse(bound(JSON.stringify(value),REFERENCE_ARCHIVE_NATIVE_LIMITS.inputBytes)) as T;}
function id(value:unknown):string{if(typeof value!=='string'||!/^public:[a-z0-9-]{1,80}$/.test(value))throw Error('Native public publisher selector refused');return value;}
export interface ReferenceArchiveSelector {referenceId:string;itemIds:string[];}
export interface ReferenceArchiveFrame {selector:ReferenceArchiveSelector;publisher:Record<string,unknown>|null;articles:Record<string,unknown>[];}
interface Version {reference_id:string;item_id:string;revision:string;content_version:string;snapshot:string;original_snapshot:string;collection_kind:PublicReferenceCollectionKind;collected_at:string;}
interface Article {reference_id:string;item_id:string;canonical_url:string;current_revision:string;first_collected_at:string;last_collected_at:string;published_at:string|null;sort_at:string;}
interface Current {row:Article;item:PublicReferenceItem;kind:PublicReferenceCollectionKind;}
export function captureReferenceUpsert(raw:PublicReference){const reference=publicReferenceSchema.parse(copy(raw)),at=new Date().toISOString();return Object.freeze({action:'upsert' as const,referenceId:reference.id,reference,items:reference.items,kind:'feed' as const,observedAt:reference.refreshedAt??at,capturedAt:at});}
export function captureReferenceArchive(referenceId:string,raw:PublicReferenceItem[],kind:PublicReferenceCollectionKind,observedAt=new Date().toISOString()){
 id(referenceId);if(!Array.isArray(raw)||raw.length>REFERENCE_ARCHIVE_NATIVE_LIMITS.items||!['feed','article'].includes(kind))throw Error('Invalid public archive batch');
 const items=copy(raw);return Object.freeze({action:'archive' as const,referenceId,items,kind,observedAt:timestamp(observedAt),capturedAt:new Date().toISOString()});
}
export type ReferenceArchiveCapture=ReturnType<typeof captureReferenceUpsert>|ReturnType<typeof captureReferenceArchive>;
export function referenceArchiveSelector(captured:ReferenceArchiveCapture):ReferenceArchiveSelector{return {referenceId:id(captured.referenceId),itemIds:[...new Set(captured.items.map(item=>normalizeItem(captured.referenceId,item).id))].sort()};}
export function completeReferenceArchiveSelector(captured:ReferenceArchiveCapture,frame:ReferenceArchiveFrame):ReferenceArchiveSelector {const selector=referenceArchiveSelector(captured);if(captured.action==='upsert'&&frame.publisher)for(const item of decodeReference(frame.publisher).items)selector.itemIds.push(normalizeItem(captured.referenceId,item).id);selector.itemIds=[...new Set(selector.itemIds)].sort();return selector;}
export function decodeReferenceArchiveFrame(raw:unknown,selector:ReferenceArchiveSelector){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='sha256,wire')throw Error('Native public archive frame unavailable');const value=raw as Record<string,unknown>;
 if(typeof value.wire!=='string'||typeof value.sha256!=='string'||archiveWireSha256(bound(value.wire,REFERENCE_ARCHIVE_NATIVE_LIMITS.frameBytes))!==value.sha256)throw Error('Native public archive frame unavailable');
 const frame=JSON.parse(value.wire) as ReferenceArchiveFrame;if(!frame||Object.keys(frame).sort().join(',')!=='articles,publisher,selector'||canonicalJson(frame.selector)!==canonicalJson(selector)||!Array.isArray(frame.articles)||frame.articles.length>2000)throw Error('Native public archive frame unavailable');return {frame,sha256:value.sha256};
}
/** Source writes immutable versions for every input, then chooses the current
 * pointer by delivery quality and UTF-16 body length. No database callback runs. */
export function prepareReferenceArchiveMutation(captured:ReferenceArchiveCapture,observed:ReturnType<typeof decodeReferenceArchiveFrame>){
 const referenceId=captured.referenceId,priorPublisher=observed.frame.publisher?decodeReference(observed.frame.publisher):null;
 const required=completeReferenceArchiveSelector(captured,observed.frame);if(required.itemIds.some(id=>!observed.frame.selector.itemIds.includes(id)))throw Error('Native public publisher item frame changed');const requiredIds=new Set(required.itemIds);
 if(captured.action==='archive'&&!priorPublisher?.active)throw Error('Active public publisher required');
 const current=new Map<string,Current>();
 for(const raw of observed.frame.articles){
  if(!requiredIds.has(String(raw.item_id)))continue;
  for(const key of ['item_id','canonical_url','current_revision','first_collected_at','last_collected_at','sort_at','snapshot'] as const)if(typeof raw[key]!=='string')throw Error('Public archived article provenance differs');
  if(raw.published_at!==null&&typeof raw.published_at!=='string'||!['feed','article'].includes(String(raw.collection_kind))||raw.reference_id!==referenceId||current.has(String(raw.item_id)))throw Error('Public archived article provenance differs');
  const item=publicReferenceItemSchema.parse(JSON.parse(String(raw.snapshot))),row:Article={reference_id:referenceId,item_id:String(raw.item_id),canonical_url:String(raw.canonical_url),current_revision:String(raw.current_revision),first_collected_at:String(raw.first_collected_at),last_collected_at:String(raw.last_collected_at),published_at:raw.published_at as string|null,sort_at:String(raw.sort_at)};
  current.set(row.item_id,{row,item,kind:raw.collection_kind as PublicReferenceCollectionKind});
 }
 const changes=new Map<string,Article>(),versions:Version[]=[],indexes=new Map<string,PublicReferenceItem>();
 function apply(inputs:PublicReferenceItem[],kind:PublicReferenceCollectionKind,at:string){
  const collectedAt=timestamp(at);let added=0,updated=0,bytes=0;
  for(const raw of inputs){const original=canonicalJson(publicReferenceItemSchema.parse(raw)),item=normalizeItem(referenceId,raw),snapshot=canonicalJson(item);bytes+=Buffer.byteLength(original);
   if(bytes>REFERENCE_ARCHIVE_NATIVE_LIMITS.inputBytes||Buffer.byteLength(original)>REFERENCE_ARCHIVE_NATIVE_LIMITS.fieldBytes||Buffer.byteLength(snapshot)>REFERENCE_ARCHIVE_NATIVE_LIMITS.fieldBytes)throw Error('Public article batch exceeds processing byte capacity');
   const revision=digest({item,original,kind}),prior=current.get(item.id),selected=!prior||prefer(item,prior.item,kind,prior.kind),first=prior?[collectedAt,prior.row.first_collected_at].sort()[0]!:collectedAt,published=selected?item.publishedAt?timestamp(item.publishedAt):null:prior!.row.published_at;
   const row:Article={reference_id:referenceId,item_id:item.id,canonical_url:prior?.row.canonical_url??item.link,current_revision:selected?revision:prior!.row.current_revision,first_collected_at:first,last_collected_at:prior?[prior.row.last_collected_at,collectedAt].sort().at(-1)!:collectedAt,published_at:published,sort_at:published??first};
   if(!prior)added++;else if(selected&&prior.row.current_revision!==revision)updated++;
   if(selected&&(!prior||prior.row.current_revision!==revision))indexes.set(item.id,item);
   current.set(item.id,{row,item:selected?item:prior!.item,kind:selected?kind:prior!.kind});changes.set(item.id,row);
   versions.push({reference_id:referenceId,item_id:item.id,revision,content_version:sourceItemContentVersion({...item,sourceId:referenceId}),snapshot,original_snapshot:original,collection_kind:kind,collected_at:collectedAt});
  }return {added,updated};
 }
 if(captured.action==='upsert'&&priorPublisher)apply(priorPublisher.items,'feed',priorPublisher.refreshedAt??captured.capturedAt);
 const result=apply(captured.items,captured.kind,captured.observedAt),terms:{term:string;reference_id:string;item_id:string;weight:number}[]=[];
 for(const item of indexes.values()){const values=new Map<string,number>();for(const [text,weight] of [[item.title,6],[item.summary,2],[item.content,1]] as const)for(const term of archiveSearchTerms(text))values.set(term,(values.get(term)??0)+weight);for(const [term,weight] of values)terms.push({term,reference_id:referenceId,item_id:item.id,weight});}
 let publisher:Record<string,unknown>|null=null;
 if(captured.action==='upsert'){const {archivedItemCount:_count,...snapshot}=captured.reference;snapshot.items=[...snapshot.items].sort((a,b)=>(b.publishedAt??'').localeCompare(a.publishedAt??'')||a.id.localeCompare(b.id)).slice(0,10);const rss=sqlitePaymentScalarText(snapshot.rssUrl);if(rss.includes('\0'))throw Error('Native public publisher scalar NUL unsupported');publisher={id:referenceId,active:Number(snapshot.active),rss_url:rss,snapshot:JSON.stringify(snapshot)};}
 const packet={selector:observed.frame.selector,snapshotSha256:observed.sha256,publisher,articles:[...changes.values()],versions,indexItemIds:[...indexes.keys()],terms,result};return {packet,wire:bound(JSON.stringify(packet),REFERENCE_ARCHIVE_NATIVE_LIMITS.packetBytes),result};
}
export function captureReferenceArchiveQuery(raw:PublicReferenceQuery){const input=copy(raw),plan=prepareArchiveQuery(input);return {input,plan,packet:{referenceId:input.referenceId??null,terms:archiveSearchTerms(input.query??'').sort(),hasQuery:Boolean((input.query??'').trim()),match:input.match??'all',sort:input.sort??'recent',limit:plan.limit,cursor:input.cursor?JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8')):null}};}
export function finishReferenceArchivePage(captured:ReturnType<typeof captureReferenceArchiveQuery>,raw:unknown){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Native public archive page unavailable');const value=raw as Record<string,unknown>;if(Object.keys(value).sort().join(',')!=='publishers,rows,total'||!Number.isSafeInteger(value.total)||Number(value.total)<0||!Array.isArray(value.rows)||value.rows.length>captured.plan.limit+1||!Array.isArray(value.publishers)||value.publishers.length>captured.plan.limit)throw Error('Native public archive page unavailable');
 const publishers=new Map(value.publishers.map(row=>{const publisher=decodeReference(row as Record<string,unknown>);if(!publisher.active)throw Error('Public archived publisher provenance differs');return [publisher.id,publisher] as const;}));for(const row of value.rows.slice(0,captured.plan.limit))if(!publishers.has(String((row as Record<string,unknown>).reference_id)))throw Error('Public archived publisher provenance differs');return finishArchiveQuery(captured.plan,Number(value.total),value.rows as Record<string,unknown>[]);
}
export function decodeNativeReference(row:unknown){if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Native public publisher row unavailable');const raw=row as Record<string,unknown>,reference=decodeReference(raw);if(!Number.isSafeInteger(raw.archived_item_count)||Number(raw.archived_item_count)<0)throw Error('Native public publisher count unavailable');return {...reference,items:reference.items.slice(0,10),archivedItemCount:Number(raw.archived_item_count)};}

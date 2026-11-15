import type { PublicReference } from '../../public-references/catalog-contract';
import type { PublicReferenceArchiveStats,PublicReferenceCollectionKind,PublicReferenceItem,PublicReferencePage,PublicReferenceQuery } from '../../public-references/archive';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { sqlitePaymentScalarText } from './payment-events-packet';
import { captureReferenceUpsert,captureReferenceArchive,referenceArchiveSelector,completeReferenceArchiveSelector,decodeReferenceArchiveFrame,prepareReferenceArchiveMutation,captureReferenceArchiveQuery,finishReferenceArchivePage,decodeNativeReference,REFERENCE_ARCHIVE_NATIVE_LIMITS,type ReferenceArchiveCapture } from './reference-archive-packet';

export interface PostgresReferenceArchivePort {
 listPublicReferences():Promise<PublicReference[]>;
 getPublicReference(id:string):Promise<PublicReference|null>;
 upsertPublicReference(reference:PublicReference):Promise<{added:number;updated:number}>;
 archivePublicReferenceItems(referenceId:string,items:PublicReferenceItem[],kind:PublicReferenceCollectionKind,observedAt?:string):Promise<{added:number;updated:number}>;
 queryPublicReferenceItems(query:PublicReferenceQuery):Promise<PublicReferencePage>;
 publicReferenceArchiveStats():Promise<PublicReferenceArchiveStats>;
}
/** Fixed public-only protocols. Capture/frame/apply is one bounded operation;
 * a lost acknowledgement is never retried. No installed facade is supplied. */
export function composePostgresReferenceArchive(channel:PostgresDomainChannel,readOnly:boolean):PostgresReferenceArchivePort {
 const unavailable=()=>new PostgresStorageUnavailable(),live=()=>{if(channel.closed)throw unavailable();},writer=()=>{live();if(readOnly)throw unavailable();};if(typeof readOnly!=='boolean')throw unavailable();
 const call=(op:'referenceArchiveFrame'|'referenceArchiveApply'|'referenceArchiveRead',args:readonly(string|null)[])=>channel.call(op as Parameters<PostgresDomainChannel['call']>[0],args);
 const read=async(action:string,packet:unknown)=>{live();const value=await call('referenceArchiveRead',[action,JSON.stringify(packet)]);live();return value;};
 const mutate=async(captured:ReferenceArchiveCapture)=>{writer();const deadline=performance.now()+15000;let selector=referenceArchiveSelector(captured),observed=decodeReferenceArchiveFrame(await call('referenceArchiveFrame',[JSON.stringify(selector)]),selector);writer();const complete=completeReferenceArchiveSelector(captured,observed.frame);if(complete.itemIds.some(id=>!selector.itemIds.includes(id))){selector=complete;observed=decodeReferenceArchiveFrame(await call('referenceArchiveFrame',[JSON.stringify(selector)]),selector);writer();}const prepared=prepareReferenceArchiveMutation(captured,observed);if(performance.now()>=deadline)throw Error('Native public archive operation deadline');
  const wire=JSON.stringify({...prepared.packet,deadlineAt:Date.now()+Math.max(0,Math.floor(deadline-performance.now()))});if(Buffer.byteLength(wire)>REFERENCE_ARCHIVE_NATIVE_LIMITS.packetBytes)throw unavailable();const result=await call('referenceArchiveApply',[wire]);if(channel.closed||performance.now()>=deadline||!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='added,updated'||(result as Record<string,unknown>).added!==prepared.result.added||(result as Record<string,unknown>).updated!==prepared.result.updated)throw new PostgresDomainWriteOutcomeUnknown();return {...prepared.result};};
 return Object.freeze({
  async listPublicReferences(){const rows=await read('list',{});if(!Array.isArray(rows)||rows.length>REFERENCE_ARCHIVE_NATIVE_LIMITS.rows)throw unavailable();const result=rows.map(decodeNativeReference);if(result.some((row,n)=>!row.active||n>0&&result[n-1].id>=row.id))throw unavailable();return result;},
  async getPublicReference(raw){live();if(typeof raw!=='string')throw unavailable();const id=sqlitePaymentScalarText(raw),idWire=JSON.stringify(raw);if(Buffer.byteLength(idWire)>32768)throw unavailable();const row=await read('get',{idWire});if(row===null)return null;const reference=decodeNativeReference(row);if(reference.id!==id)throw unavailable();return reference;},
  async upsertPublicReference(raw){writer();return mutate(captureReferenceUpsert(raw));},
  async archivePublicReferenceItems(id,items,kind,observedAt){writer();return mutate(captureReferenceArchive(id,items,kind,observedAt));},
  async queryPublicReferenceItems(input){live();const captured=captureReferenceArchiveQuery(input);return finishReferenceArchivePage(captured,await read('query',captured.packet));},
  async publicReferenceArchiveStats(){const value=await read('stats',{});if(!value||typeof value!=='object'||Array.isArray(value))throw unavailable();const result=value as Record<string,unknown>;if(Object.keys(result).some(key=>!['articles','publishers','oldestPublishedAt','newestPublishedAt'].includes(key))||!Number.isSafeInteger(result.articles)||Number(result.articles)<0||!Number.isSafeInteger(result.publishers)||Number(result.publishers)<0||['oldestPublishedAt','newestPublishedAt'].some(key=>Object.hasOwn(result,key)&&typeof result[key]!=='string'))throw unavailable();return result as unknown as PublicReferenceArchiveStats;},
 } satisfies PostgresReferenceArchivePort);
}

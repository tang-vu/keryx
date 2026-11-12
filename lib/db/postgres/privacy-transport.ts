import { z } from 'zod';
import { PrivacyError,privacyId,privacyWallet,privacySession,privacyMutation,visibilitySchema,pendingPollSchema,publicQuestionIdsSchema,validatePrivacyRun,type PrivacyActor,type RunPrivacyStore } from '../../run-privacy/contracts';
import { runClaimBindingSchema } from '../../run-claims/contracts';
import { projectRecordedEvidenceProvenanceList } from '../../research/evidence-provenance';
import { decodeSqlitePublicQuestionRows } from '../public-question-projection';
import { decodeSqlitePublicSourceHistoryRows,publicSourceHistoryRowsFromRuns } from '../public-source-history-projection';
import { decodeSqlitePublicLearningRows } from '../public-source-learning-projection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import type { PublicArchiveRow } from '../../run-privacy/archive-page';
import type { ArchiveEntry } from '../../answers-archive';
const state=z.object({visibility:visibilitySchema,revision:z.number().int().min(0),erased:z.boolean()}).strict();
const original=z.object({id:privacyId,originalHex:z.string().max(8000000),state}).strict();
const query=z.object({take:z.number().int().min(1).max(2500),before:z.object({id:privacyId,createdAt:z.string().max(256)}).strict().optional(),parentId:privacyId.optional(),ids:z.array(privacyId).max(10000).optional()}).strict();
const memory=z.object({id:privacyId,createdAt:z.string(),sourceScores:z.record(z.string(),z.object({name:z.string(),weight:z.number(),reward:z.number()})),topics:z.array(z.string()),sourcesRead:z.array(z.string()).optional()}).strict();
const offer=z.object({id:z.string(),gapId:z.string(),sourceId:z.string(),sourceItemLink:z.string(),ownerWallet:z.string(),status:z.enum(['pending','running','filled','missed','unpaid','stale','failed']),attempts:z.number().int(),itemId:z.string().optional(),contentVersion:z.string().optional(),articleOfferId:z.string().optional(),retryRunId:z.string().optional(),coverage:z.number().optional(),rewardUsdc:z.number().optional(),createdAt:z.string(),updatedAt:z.string()}).strict();
function utf8Hex(value:string,maximum:number){if(value.length>maximum*2||value.length%2||/[^a-f0-9]/.test(value))throw new PrivacyError('privacy_unavailable');return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(value,'hex'));}
/** Native protocol composition only; the private zero-argument factory owns admission. */
export function composePostgresPrivacy(channel:PostgresDomainChannel,network:string,readOnly:boolean,claimsEnabled:boolean):RunPrivacyStore{
 const unavailable=()=>new PrivacyError('privacy_unavailable'),live=()=>{if(channel.closed)throw unavailable();},writer=()=>{live();if(readOnly)throw unavailable();};
 if(network!=='eip155:5042'||typeof readOnly!=='boolean'||typeof claimsEnabled!=='boolean')throw unavailable();
 const actor=(input:PrivacyActor|undefined,write=false)=>{if(!input)return null;const wallet=privacyWallet.parse(input.wallet),binding=runClaimBindingSchema.parse(input.binding);if(binding.network!==network)throw unavailable();return JSON.stringify({wallet,binding,sessionHash:write?privacySession.parse(input.sessionHash):null});};
 const read=async(operation:Parameters<PostgresDomainChannel['call']>[0],args:(string|null)[])=>{try{live();const value=await channel.call(operation,args);live();return value;}catch{throw unavailable();}};
 const body=(raw:unknown,id?:string)=>{const p=original.parse(raw);if(id!==undefined&&p.id!==id)throw unavailable();return {run:validatePrivacyRun(JSON.parse(utf8Hex(p.originalHex,4000000)),p.id),state:p.state};};
 const failure=z.object({error:z.enum(['privacy_unavailable','not_found','conflict','unauthenticated','retention_hold'])}).strict();
 const mutation=async(operation:'privacyDefault'|'privacyVisibility'|'privacyErase'|'privacyExport',id:string|null,who:string|null,input:string)=>{
  const result=await channel.call(operation,[id,who,input,String(claimsEnabled)]);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();const known=failure.safeParse(result);if(known.success)throw new PrivacyError(known.data.error);return result;
 };
 const slim=async(operation:'privacyQuestions'|'privacySourceHistory'|'privacyLearningPage'|'privacyArchivePage',input:unknown)=>{
  const p=z.object({rows:z.array(z.unknown()).max(50),flags:z.array(z.string().max(2048)).max(10000)}).strict().parse(await read(operation,[JSON.stringify(input)]));return p;
 };
 const fields=(raw:unknown)=>{const p=z.object({fieldsHex:z.string().max(16000000)}).passthrough().parse(raw);const {fieldsHex,...rest}=p;return {...rest,fields:utf8Hex(fieldsHex,8000000)};};
 return Object.freeze({
  async creationReady(){writer();z.object({domain:z.literal('run-publication-v1')}).strict().parse(await read('publicationReady',[]));},
  async read(rawId,input){try{live();const id=privacyId.parse(rawId),who=actor(input),p=z.object({exists:z.boolean(),item:original.nullable()}).strict().parse(await read('privacyRead',[id,who,String(claimsEnabled)]));const item=p.item?body(p.item,id):null;if(item&&(!p.exists||item.state.erased||item.state.visibility==='private'&&!input))throw unavailable();return {exists:p.exists,item};}catch{throw unavailable();}},
  async owner(rawId,input){try{live();const id=privacyId.parse(rawId),who=actor(input);const p=z.object({item:original.nullable()}).strict().parse(await read('privacyOwner',[id,who,String(claimsEnabled)]));return p.item?body(p.item,id):null;}catch{throw unavailable();}},
  async list(input){try{live();const parsed=query.parse(input),p=z.object({items:z.array(z.object({id:privacyId,run:z.unknown(),state}).strict()).max(parsed.take)}).strict().parse(await read('privacyList',[JSON.stringify(parsed)]));if(new Set(p.items.map(x=>x.id)).size!==p.items.length)throw unavailable();return p.items.map(x=>{if(x.state.erased||x.state.visibility!=='public'||parsed.ids&&!parsed.ids.includes(x.id))throw unavailable();return validatePrivacyRun(x.run,x.id);});}catch{throw unavailable();}},
  async settlement(rawId){try{live();const id=privacyId.parse(rawId),p=z.object({item:z.unknown()}).strict().parse(await read('privacySettlement',[id]));return p.item===null?null:validatePrivacyRun(p.item,id);}catch{throw unavailable();}},
  async pending(rawId){try{live();const id=privacyId.parse(rawId),p=z.object({item:pendingPollSchema.extend({queryId:z.literal(id)}).nullable()}).strict().parse(await read('privacyPending',[id]));return p.item;}catch{throw unavailable();}},
  async defaults(input){try{live();const who=actor(input);return z.object({visibility:visibilitySchema}).strict().parse(await read('privacyDefaults',[who])).visibility;}catch{throw unavailable();}},
  async memories(take){try{live();z.number().int().min(1).max(2500).parse(take);return z.object({items:z.array(memory).max(take)}).strict().parse(await read('privacyMemories',[String(take)])).items;}catch{throw unavailable();}},
  async offers(take){try{live();z.number().int().min(1).max(200).parse(take);return z.object({items:z.array(offer).max(take)}).strict().parse(await read('privacyOffers',[String(take)])).items;}catch{throw unavailable();}},
  async questions(rawIds){try{live();const ids=publicQuestionIdsSchema.parse(rawIds),p=await slim('privacyQuestions',{take:Math.max(1,ids.length),ids});return decodeSqlitePublicQuestionRows(p.rows.map(fields),ids);}catch{throw unavailable();}},
  async sourceHistory(){try{live();const p=await slim('privacySourceHistory',{take:50}),runs=decodeSqlitePublicSourceHistoryRows(p.rows.map(fields));const projected=await projectRecordedEvidenceProvenanceList(async()=>new Set(p.flags),runs);live();return publicSourceHistoryRowsFromRuns(projected);}catch{throw unavailable();}},
  async learningPage(input){try{live();const p=query.pick({take:true,before:true}).extend({take:z.number().int().min(1).max(32)}).parse(input),result=await slim('privacyLearningPage',p);return decodeSqlitePublicLearningRows(result.rows.map(fields));}catch{throw unavailable();}},
  async archivePage(input){try{live();const p=query.extend({take:z.number().int().min(1).max(32)}).parse(input),result=await slim('privacyArchivePage',p);return result.rows.map(raw=>{const row=z.object({id:privacyId,createdAt:z.string(),entryHex:z.string().max(4194304)}).strict().parse(raw);const entry=JSON.parse(utf8Hex(row.entryHex,2097152)) as ArchiveEntry|null;if(entry!==null&&(!entry||typeof entry!=='object'||entry.id!==row.id||entry.createdAt!==row.createdAt))throw unavailable();return {id:row.id,createdAt:row.createdAt,entry} satisfies PublicArchiveRow;});}catch{throw unavailable();}},
  async setDefault(input,rawVisibility,requestId){writer();const visibility=visibilitySchema.parse(rawVisibility),who=actor(input,true);z.string().uuid().parse(requestId);const value=await mutation('privacyDefault',null,who,JSON.stringify({visibility,requestId}));try{const p=z.object({visibility:z.literal(visibility)}).strict().parse(value);return p.visibility;}catch{throw new PostgresDomainWriteOutcomeUnknown();}},
  async change(rawId,input,raw){writer();const id=privacyId.parse(rawId),who=actor(input,true),p=privacyMutation.parse(raw),value=await mutation('privacyVisibility',id,who,JSON.stringify(p));try{const s=z.object({state}).strict().parse(value).state;if(s.erased||s.visibility!==p.visibility||s.revision!==p.revision+1)throw new Error();return s;}catch{throw new PostgresDomainWriteOutcomeUnknown();}},
  async erase(rawId,input,raw){writer();const id=privacyId.parse(rawId),who=actor(input,true),p=privacyMutation.parse(raw),value=await mutation('privacyErase',id,who,JSON.stringify(p));try{const s=z.object({state}).strict().parse(value).state;if(!s.erased||s.visibility!=='private')throw new Error();return s;}catch{throw new PostgresDomainWriteOutcomeUnknown();}},
  async export(rawId,input,requestId){writer();const id=privacyId.parse(rawId),who=actor(input);z.string().uuid().parse(requestId);const value=await mutation('privacyExport',id,who,JSON.stringify({requestId}));try{return body(z.object({item:original}).strict().parse(value).item,id);}catch{throw new PostgresDomainWriteOutcomeUnknown();}},
 } satisfies RunPrivacyStore);
}

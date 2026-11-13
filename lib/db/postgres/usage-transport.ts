import { z } from 'zod';
import type { QueryRun } from '../../types';
import { privacyId,validatePrivacyRun } from '../../run-privacy/contracts';
import { parseRunUsage } from '../../research/usage-provenance';
import { publicHistoryIncludes } from '../../research-audit/usage-cohort';
import { projectUsageCorpus,usageWindowSchema,UsageUnavailable,type PublicUsageStore,type UsageWindow } from '../../usage/contracts';
import type { PostgresDomainChannel } from './domain-channel';
const cohortSchema=z.enum(['default','outside','team','scripted','unknown']);
const runMetadata=z.object({id:z.string().min(1).max(256),createdAt:z.string().max(32),originalSha256:z.string().regex(/^[a-f0-9]{64}$/),usageHex:z.string().max(4096).nullable(),provenanceHex:z.string().max(2048).nullable(),actorId:z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable()}).strict();
const candidateSchema=z.object({id:privacyId,createdAt:z.string().max(32),originalSha256:z.string().regex(/^[a-f0-9]{64}$/),usage:z.unknown()}).strict();
type PublishedHistory={windowRuns:number;runs:QueryRun[]};
type Selection={candidates:z.infer<typeof candidateSchema>[];published:boolean;limit:number};
export interface NativeUsageSelection {readonly kind:'native-usage-selection';}
function metadata(value:string|null){if(value===null)return null;if(value.length%2||/[^a-f0-9]/.test(value))throw new UsageUnavailable();const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(value,'hex'))) as unknown;if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new UsageUnavailable();return raw;}
const normalized=(value:unknown)=>parseRunUsage(value)??null;
export interface PostgresUsageTransport {
 readonly publicUsage:PublicUsageStore;
 prepareUsageHistory(window:UsageWindow,cohort:Parameters<PublicUsageStore['history']>[1],limit:number,published:boolean):Promise<NativeUsageSelection>;
 finishUsageHistory(plan:NativeUsageSelection):Promise<QueryRun[]>;
 finishPublishedUsageHistory(plan:NativeUsageSelection):Promise<PublishedHistory>;
}
/** Opaque per-call selections carry data expectations only. Every finish reads
 * current native metadata, visibility and real bodies; no admission is cached. */
export function composePostgresUsage(channel:PostgresDomainChannel,privacyActive:boolean):PostgresUsageTransport{
 if(typeof privacyActive!=='boolean')throw new UsageUnavailable();
 const selections=new WeakMap<object,Selection>(),live=()=>{if(channel.closed)throw new UsageUnavailable();};
 const call=async(operation:'usageWindow'|'usageSelect'|'usageFinish',args:string[])=>{try{live();const value=await channel.call(operation,args);live();return value;}catch{throw new UsageUnavailable();}};
 const view=async(window:UsageWindow)=>{
  const p=z.object({format:z.literal('keryx-native-usage-window-v1'),window:z.unknown(),runs:z.array(runMetadata).max(10000),payments:z.array(z.unknown()).max(50000)}).strict().parse(await call('usageWindow',[JSON.stringify(window)]));
  return {...projectUsageCorpus({complete:true,window:p.window,runs:p.runs.map(row=>({id:row.id,createdAt:row.createdAt,usage:metadata(row.usageHex),provenance:metadata(row.provenanceHex),actorId:row.actorId})),payments:p.payments},window),originals:new Map(p.runs.map(row=>[row.id,row.originalSha256]))};
 };
 async function prepareUsageHistory(rawWindow:UsageWindow,rawCohort:unknown,rawLimit:number,published:boolean):Promise<NativeUsageSelection>{
  try{
   live();const window=usageWindowSchema.parse(rawWindow),cohort=cohortSchema.parse(rawCohort),limit=z.number().int().min(1).max(100).parse(rawLimit);if(typeof published!=='boolean'||published&&!privacyActive)throw new UsageUnavailable();
   const classified=await view(window);live();
   let selected=classified.runs.filter(row=>cohort==='default'?publicHistoryIncludes(row.classification.cohort):row.classification.cohort===cohort).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
   if(!privacyActive)selected=selected.slice(0,limit);
   const wanted=selected.map(row=>({id:privacyId.parse(row.id),createdAt:row.createdAt,originalSha256:classified.originals.get(row.id)!,usage:classified.classifications.get(row.id)??null})),expected=new Map(wanted.map(row=>[row.id,row]));
   const p=z.object({format:z.literal('keryx-native-usage-selection-v1'),candidates:z.array(candidateSchema).max(published?10000:limit)}).strict().parse(await call('usageSelect',[JSON.stringify(wanted),String(limit),String(published),String(privacyActive)]));
   const seen=new Set<string>();for(const row of p.candidates){const before=expected.get(row.id);if(seen.has(row.id)||!before||row.createdAt!==before.createdAt||!privacyActive&&row.originalSha256!==before.originalSha256||!Object.hasOwn(row,'usage')||JSON.stringify(normalized(row.usage))!==JSON.stringify(before.usage))throw new UsageUnavailable();seen.add(row.id);}
   const plan=Object.freeze({kind:'native-usage-selection' as const});selections.set(plan,{candidates:p.candidates,published,limit});live();return plan;
  }catch{throw new UsageUnavailable();}
 }
 async function finish(plan:NativeUsageSelection,published:boolean):Promise<QueryRun[]|PublishedHistory>{
  try{
   live();const selected=selections.get(plan);if(!selected||selected.published!==published)throw new UsageUnavailable();
   const packet=z.object({format:z.literal('keryx-native-usage-final-v1'),allowed:z.array(privacyId).max(selected.candidates.length),runs:z.array(z.unknown()).max(selected.limit)}).strict().parse(await call('usageFinish',[JSON.stringify(selected.candidates),String(selected.limit),String(published),String(privacyActive)]));
   const positions=new Map(selected.candidates.map((row,index)=>[row.id,index]));let after=-1;const allowed=new Set<string>();
   for(const id of packet.allowed){const position=positions.get(id);if(position===undefined||position<=after||allowed.has(id))throw new UsageUnavailable();after=position;allowed.add(id);}
   if(!privacyActive&&allowed.size!==selected.candidates.length||packet.runs.length!==Math.min(selected.limit,allowed.size))throw new UsageUnavailable();
   const runs=packet.runs.map((raw,index)=>{
    const id=packet.allowed[index],before=selected.candidates[positions.get(id)!];if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new UsageUnavailable();
    const run=privacyActive?validatePrivacyRun(raw,id):raw as QueryRun;
    if(run.id!==id||run.createdAt!==before.createdAt||privacyActive&&JSON.stringify(normalized(run.usage))!==JSON.stringify(normalized(before.usage)))throw new UsageUnavailable();return run;
   });
   live();return published?{windowRuns:allowed.size,runs}:runs;
  }catch{throw new UsageUnavailable();}
 }
 const publicUsage:PublicUsageStore=Object.freeze({
  async summary(raw){try{live();const window=usageWindowSchema.parse(raw),result=(await view(window)).summary;live();return result;}catch{throw new UsageUnavailable();}},
  async history(window,cohort,limit){return await finish(await prepareUsageHistory(window,cohort,limit,false),false) as QueryRun[];},
  async publishedHistory(window,cohort,limit){return await finish(await prepareUsageHistory(window,cohort,limit,true),true) as PublishedHistory;},
 } satisfies PublicUsageStore);
 return Object.freeze({publicUsage,prepareUsageHistory,async finishUsageHistory(plan){return await finish(plan,false) as QueryRun[];},async finishPublishedUsageHistory(plan){return await finish(plan,true) as PublishedHistory;}} satisfies PostgresUsageTransport);
}

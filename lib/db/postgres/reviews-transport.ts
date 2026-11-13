import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { captureDecisionSchema,decisionReviewSchema,decisionTermsSchema,reviewIdSchema,reviewOwner,reviewVerdictSchema,DecisionReviewError,reviewActionSchema,reviewRuleSchema,reviewPeriodSchema,reviewCohortSchema,decisionReviewMetricsSchema,type DecisionReviewMetrics,type DecisionReviewsStore } from '../../research/decision-review-types';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { captureReviewPacket } from './review-packet';
const unavailable=()=>new DecisionReviewError('review_unavailable');
const rawRow=z.object({id:z.string(),inputHex:z.string().max(16384),createdAt:z.string(),expiresAt:z.string().nullable(),state:z.string(),action:z.string(),rule:z.string(),verdictHex:z.string().max(16384).nullable()}).strict();
function fromHex(raw:string){if(raw.length%2||/[^0-9a-f]/.test(raw))throw unavailable();return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(raw,'hex')));}
export function decodeNativeReviewRow(raw:unknown){const r=rawRow.parse(raw),input=captureDecisionSchema.parse(fromHex(r.inputHex));return decisionReviewSchema.parse({...input,initialCodeAction:input.codeAction,initialCodeRule:input.codeRule,id:r.id,createdAt:r.createdAt,expiresAt:r.expiresAt,state:r.state,codeAction:r.action,codeRule:r.rule,verdict:r.verdictHex===null?null:fromHex(r.verdictHex)});}
const record=decodeNativeReviewRow;
const readOps=['reviewReady','reviewRead','reviewList','reviewMetrics'] as const;
type Read=typeof readOps[number];
type Write='reviewCapture'|'reviewBegin'|'reviewVerdict'|'reviewConsume'|'reviewCancel'|'reviewExpire'|'reviewObserve';
const iso=(now?:number)=>new Date(now??Date.now()).toISOString();
export function composePostgresDecisionReviews(channel:PostgresDomainChannel,readOnly:boolean):DecisionReviewsStore{
 if(typeof readOnly!=='boolean')throw unavailable();
 const live=()=>{if(channel.closed)throw unavailable();},writer=()=>{live();if(readOnly)throw unavailable();};
 async function call(operation:Read|Write,wallet:string|null,packet:unknown){
  live();const wire=canonicalJson(packet);if(Buffer.byteLength(wire)>32768)throw unavailable();
  const value=await channel.call(operation,[wallet,wire]);if(channel.closed){if((readOps as readonly string[]).includes(operation))throw unavailable();throw new PostgresDomainWriteOutcomeUnknown();}
  const refusal=z.object({error:z.enum(['review_unavailable','review_conflict','review_not_found','review_expired'])}).strict().safeParse(value);
  if(refusal.success)throw new DecisionReviewError(refusal.data.error);return value;
 }
 async function read<T>(operation:Read,wallet:string|null,packet:unknown,parse:(v:unknown)=>T):Promise<T>{try{return parse(await call(operation,wallet,packet));}catch(error){if(error instanceof DecisionReviewError)throw error;throw unavailable();}}
 async function write<T>(operation:Write,wallet:string,packet:unknown,parse:(v:unknown)=>T):Promise<T>{const value=await call(operation,wallet,packet);try{return parse(value);}catch{throw new PostgresDomainWriteOutcomeUnknown();}}
 const one=(v:unknown)=>{const {row}=z.object({row:z.unknown()}).strict().parse(v);return record(row);};
 const done=(v:unknown)=>{z.object({done:z.literal(true)}).strict().parse(v);};
 return Object.freeze({
  async ready(){await read('reviewReady',null,{},v=>{z.object({ready:z.literal(true)}).strict().parse(v);});},
  async capture(owner,raw,now){writer();const wallet=reviewOwner(owner),packet=captureReviewPacket(raw);return write('reviewCapture',wallet,{id:randomUUID(),...packet,at:iso(now)},one);},
  async begin(owner,rawId,now){writer();return write('reviewBegin',reviewOwner(owner),{id:reviewIdSchema.parse(rawId),at:iso(now)},one);},
  async list(owner,rawRun){live();return read('reviewList',reviewOwner(owner),{runId:reviewIdSchema.parse(rawRun)},v=>z.object({rows:z.array(z.unknown()).max(300)}).strict().parse(v).rows.map(record));},
  async read(owner,rawId){live();return read('reviewRead',reviewOwner(owner),{id:reviewIdSchema.parse(rawId)},v=>{const {row}=z.object({row:z.unknown().nullable()}).strict().parse(v);return row===null?null:record(row);});},
  async verdict(owner,raw,now){writer();return write('reviewVerdict',reviewOwner(owner),{inputWire:canonicalJson(reviewVerdictSchema.parse(raw)),at:iso(now)},one);},
  async consume(owner,rawId,rawTerms,now){writer();return write('reviewConsume',reviewOwner(owner),{id:reviewIdSchema.parse(rawId),terms:decisionTermsSchema.parse(rawTerms),at:iso(now)},one);},
  async cancel(owner,rawRun){writer();await write('reviewCancel',reviewOwner(owner),{runId:reviewIdSchema.parse(rawRun)},done);},
  async expire(owner,rawId,now){writer();await write('reviewExpire',reviewOwner(owner),{id:reviewIdSchema.parse(rawId),at:iso(now)},done);},
  async observe(owner,rawId,action,rule){writer();await write('reviewObserve',reviewOwner(owner),{id:reviewIdSchema.parse(rawId),action:reviewActionSchema.parse(action),rule:reviewRuleSchema.parse(rule)},done);},
  async metrics(network,since,until){
   live();const period=reviewPeriodSchema.parse({network,since,until});return read('reviewMetrics',null,period,v=>{
    const groups=z.object({groups:z.array(z.object({cohort:reviewCohortSchema,model:reviewActionSchema.nullable(),action:reviewActionSchema,rule:reviewRuleSchema,verdict:z.enum(['agree','disagree']).nullable(),n:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict()).max(2880)}).strict().parse(v).groups;
    const cohorts:DecisionReviewMetrics['cohorts']=reviewCohortSchema.options.map(cohort=>({cohort,decisions:0,agrees:0,disagrees:0,agreementRate:null,modelCodeDifferences:0,codeRefusals:0,refusalReasons:{}}));
    for(const row of groups){const c=cohorts.find(c=>c.cohort===row.cohort)!;c.decisions+=row.n;if(row.verdict==='agree')c.agrees+=row.n;else if(row.verdict==='disagree')c.disagrees+=row.n;if(row.model!==null&&row.model!==row.action)c.modelCodeDifferences+=row.n;if(row.action==='SKIP'&&row.rule!=='model-skip'){c.codeRefusals+=row.n;c.refusalReasons[row.rule]=(c.refusalReasons[row.rule]??0)+row.n;}}
    for(const c of cohorts)c.agreementRate=c.agrees+c.disagrees?c.agrees/(c.agrees+c.disagrees):null;
    return decisionReviewMetricsSchema.parse({...period,rule:'captured-owner-decisions-v1',cohorts});
   });
  },
 } satisfies DecisionReviewsStore);
}

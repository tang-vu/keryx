/** One captured new-write packet. Pure Node only: no SQLite, SDK, env or key IO. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { erasedRun,validatePrivacyRun,visibilitySchema,PrivacyError } from '../../run-privacy/contracts';
import { parseRunProvenance,recordedRunProvenance } from '../../research/run-provenance';
import { ownershipHistoryOriginal,summarizeOwnershipOriginal } from '../../run-claims/history';
import { historyDateSchema,historyIdSchema } from '../../history/personal-history';
import { runEvidenceMetrics } from '../dashboard-metrics';
import { economicsRunSample } from '../../economics/testnet-economics';
import { archiveEntryFromRun } from '../../answers-archive';
import type { QueryRun } from '../../types';
import { slimPrivacyHistoryFields } from './privacy-metadata';
import { publicationUsageMetadata,usageBodyMetadata } from './usage-metadata';
import { ledgerOriginalMetadata } from './ledger-metadata';
import { publicProfileOriginalMetadata } from './public-profile-metadata';
type ValueKind='null'|'array'|'object'|'text'|'integer'|'real'|'true'|'false';
function kind(value:unknown):ValueKind{
 if(value===null)return 'null';if(Array.isArray(value))return 'array';if(typeof value==='object')return 'object';if(typeof value==='string')return 'text';if(typeof value==='boolean')return value?'true':'false';
 if(typeof value!=='number'||!Number.isFinite(value))throw new PrivacyError('privacy_unavailable');
 return Number.isInteger(value)&&BigInt(value)>=BigInt('-9223372036854775808')&&BigInt(value)<=BigInt('9223372036854775807')?'integer':'real';
}
const requiredText=['id','createdAt','question','engine'],numbers=['budget','totalSpent','totalToCreators'],arrays=['subClaims','decisions','citations','trace'];
const questionKeys=new Set([...requiredText,...numbers,'answer',...arrays]);
const historyKeys=new Set([...questionKeys,'evidence','claimCoverage']);
const learningKeys=new Set([...questionKeys,'usage','sourceLearning','paymentMode','originalFulfillment','asker','provenance']);
function fieldWire(run:Record<string,unknown>,mode:'question'|'history'|'learning'){
 const selected=mode==='question'?questionKeys:mode==='history'?historyKeys:learningKeys;
 return JSON.stringify(Object.entries(run).filter(([key])=>selected.has(key)).map(([key,value])=>{
  const type=kind(value);let projected:unknown=null;
  if(mode==='question'){
   if(requiredText.includes(key)&&type==='text'||numbers.includes(key)&&['integer','real'].includes(type))projected=value;
  }else if(mode==='history'){
   if(['id','createdAt','budget','totalSpent','totalToCreators','answer','decisions','citations','evidence','claimCoverage'].includes(key))projected=type==='array'||type==='object'?JSON.stringify(value):type==='true'?1:type==='false'?0:value;
  }else if(key==='originalFulfillment')projected=value?1:0;
  else if(['id','createdAt','budget','totalSpent','totalToCreators','decisions','usage','sourceLearning','paymentMode','asker','provenance'].includes(key))projected=type==='true'?1:type==='false'?0:value;
  return [key,type,projected];
 }));
}
type UsageProjection={sha256:string}&ReturnType<typeof publicationUsageMetadata>&ReturnType<typeof usageBodyMetadata>;
type LedgerProjection={sha256:string}&ReturnType<typeof ledgerOriginalMetadata>;
interface PublicationDerivatives {
 history:{sha256:string;recordedOwner:string|null;ownerInvalid:boolean;funded:boolean;provenance:ReturnType<typeof parseRunProvenance>|null;anonymousClaimEligible:boolean};
 ownership:{sha256:string;questionHex:string;historyEligible:boolean;recordedValid:boolean;claimedValid:boolean;summary:ReturnType<typeof summarizeOwnershipOriginal>|null};
 privacy:{sha256:string;dataBytes:number;valid:boolean;eraseWire:string;originalFulfillment:boolean;questionFields:string;historyFields:string|null;historyReferences:ReturnType<typeof slimPrivacyHistoryFields>['references'];learningFields:string;archiveWire:string|null;eraseProjection:PublicationDerivatives|null;usage:UsageProjection;ledger:LedgerProjection;publicProfile:ReturnType<typeof publicProfileOriginalMetadata>};
}
function derive(run:QueryRun,wire:string,recordedOwner:string|null,includeErasure:boolean):PublicationDerivatives{
 const raw=run as unknown as Record<string,unknown>,sha256=createHash('sha256').update(wire).digest('hex'),dataBytes=Buffer.byteLength(wire);
 const validOwner=typeof run.asker==='string'&&/^0x[0-9a-f]{40}$/.test(run.asker.toLowerCase()),eligible=!Object.hasOwn(run,'asker')&&!Object.hasOwn(run,'originalFulfillment')&&run.askerFunded!==true&&run.fundingOwner!=='browser';
 const history={sha256,recordedOwner:validOwner?run.asker!.toLowerCase():null,ownerInvalid:run.asker!==undefined&&run.asker!==null&&!validOwner,funded:run.askerFunded===true,provenance:parseRunProvenance(run.provenance)??null,anonymousClaimEligible:eligible};
 const owned=(method:'recorded'|'claimed')=>{try{if(method==='recorded'&&(recordedOwner===null||!/^0x[0-9a-f]{40}$/.test(recordedOwner)))return false;ownershipHistoryOriginal(run,recordedOwner??'0x'+'00'.repeat(20),run.id,run.createdAt,method==='recorded'?{method,claimedAt:null}:{method,claimedAt:'2026-01-01T00:00:00.000Z'});return true;}catch{return false;}};
 let summary:ReturnType<typeof summarizeOwnershipOriginal>|null=null;try{summary=summarizeOwnershipOriginal(run);}catch{}
 const ownership={sha256,questionHex:Buffer.from(run.question).toString('hex'),historyEligible:eligible,recordedValid:owned('recorded'),claimedValid:owned('claimed'),summary};
 const slim=slimPrivacyHistoryFields(fieldWire(raw,'history'));let archiveWire:string|null=null;try{archiveWire=JSON.stringify(archiveEntryFromRun(run));}catch{}
 const eraseWire=JSON.stringify(erasedRun(run)),eraseProjection=includeErasure?derive(JSON.parse(eraseWire) as QueryRun,eraseWire,recordedOwner,false):null;
 const usage={sha256,...publicationUsageMetadata(raw),...usageBodyMetadata(run,run.id,run.createdAt)};
 const ledger={sha256,...ledgerOriginalMetadata(run,run.id,run.createdAt)};
 const privacy={sha256,dataBytes,valid:true,eraseWire,originalFulfillment:!!run.originalFulfillment,questionFields:fieldWire(raw,'question'),historyFields:slim.fields,historyReferences:slim.references,learningFields:fieldWire(raw,'learning'),archiveWire,eraseProjection,usage,ledger,publicProfile:publicProfileOriginalMetadata(run,run.id,run.createdAt)};
 return {history,ownership,privacy};
}
function text(value:unknown,nullable=false):string|null{
 if(nullable&&(value===null||value===undefined))return null;
 if(typeof value!=='string'||value.includes('\0')||new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(value))!==value)throw new PrivacyError('privacy_unavailable');return value;
}
export function capturePostgresPublication(input:QueryRun,publication?:{visibility:z.infer<typeof visibilitySchema>}){
 const initial=JSON.stringify(input);if(Buffer.byteLength(initial)>4000000)throw new PrivacyError('privacy_unavailable');
 const captured=JSON.parse(initial) as QueryRun;validatePrivacyRun(captured);const run=recordedRunProvenance(captured);validatePrivacyRun(run);historyIdSchema.parse(run.id);historyDateSchema.parse(run.createdAt);
 if(run.id.startsWith('prv_')||run.parentId?.startsWith('prv_'))throw new PrivacyError('privacy_unavailable');
 const selected=publication===undefined?undefined:z.object({visibility:visibilitySchema}).strict().parse(publication);
 const wire=JSON.stringify(run);if(Buffer.byteLength(wire)>4000000)throw new PrivacyError('privacy_unavailable');
 const asker=run.asker===undefined||run.asker===null?null:text(run.asker)!.toLowerCase(),evidence=runEvidenceMetrics(run),economics=economicsRunSample(run),projection=derive(run,wire,asker,true);
 const row={id:run.id,created_at:run.createdAt,question:text(run.question),budget:run.budget,engine:text(run.engine),total_spent:run.totalSpent,total_to_creators:run.totalToCreators,answer:text(run.answer),
  parent_id:text(run.parentId,true),asker,origin:text(run.origin??'engine'),mcp_client:text(run.mcpClient,true),duration_ms:run.durationMs??null,payment_mode:text(run.paymentMode,true),payment_attempts:run.paymentAttempts??null,settled_payments:run.settledPayments??null,
  confidence_level:text(run.confidence?.level,true),evidence_claim_count:evidence.evidenceClaimCount,grounded_claim_count:evidence.groundedClaimCount,rewarded_citation_count:evidence.rewardedCitationCount,economics_data:economics??null};
 const packet={row,originalHex:Buffer.from(wire).toString('hex'),...projection,...(selected?{publication:selected}:{})};const encoded=JSON.stringify(packet);
 if(Buffer.byteLength(encoded)>33554432)throw new PrivacyError('privacy_unavailable');return Object.freeze({id:run.id,wire:encoded});
}

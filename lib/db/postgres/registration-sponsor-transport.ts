import { createHash } from 'node:crypto';
import { canonicalJson } from '../../canonical-json';
import type { KeryxDB } from '../keryx-db';
import { RegistrationSponsorError,type RegistrationSponsorLookup,type RegistrationSponsorTransition,type RegistrationSponsorExecution,type RegistrationSponsorFundingInspection } from '../registration-sponsor';
import type { ActiveRegistrationSponsorPolicy,RegistrationSponsorFundingObservation,SponsoredRegistration } from '../../sources/registration-sponsor-protocol';
import { captureRegistrationSponsorObservation,validateRegistrationSponsorObservation,type RegistrationSponsorObservationCapture } from '../../sources/registration-sponsor-runtime';
import { captureRegistrationSponsorAdmit,captureRegistrationSponsorLookup,captureRegistrationSponsorExecution,captureRegistrationSponsorFunding,captureRegistrationSponsorTransition,registrationSponsorSelector,registrationSponsorPinnedPolicy,registrationSponsorNeedsFunding,registrationSponsorCommitWire,reduceRegistrationSponsor,type RegistrationSponsorSelection,type RegistrationSponsorPlan } from './registration-sponsor-packet';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';

const sha=(wire:string)=>createHash('sha256').update(wire).digest('hex');
const fundingUnavailable=():never=>{throw new RegistrationSponsorError('Fresh sponsor funds could not be verified',503,'registration_sponsor_rpc_unavailable');};
function observationInQuery(query:RegistrationSponsorSelection):RegistrationSponsorFundingObservation|undefined{
 if(query.operation==='admit')return query.input.observationWire===null?undefined:JSON.parse(query.input.observationWire);if(query.operation==='funding')return JSON.parse(query.input.observationWire);if(query.operation==='transition')return JSON.parse(query.input.changeWire).fundingObservation;return undefined;
}
/** The facade object is composed privately after factory registration. A callback,
 * policy row or DTO cannot substitute for runtime-owned observation provenance. */
export function composePostgresRegistrationSponsor(channel:PostgresDomainChannel,facade:KeryxDB,readOnly:boolean){
 if(typeof readOnly!=='boolean'||!facade||typeof facade!=='object')throw new PostgresStorageUnavailable();
 const live=(write=false)=>{if(channel.closed||write&&readOnly)throw new PostgresStorageUnavailable();};
 const capture=(observation:RegistrationSponsorFundingObservation|undefined,purpose:'read'|'new-exposure',policy?:ActiveRegistrationSponsorPolicy)=>{if(observation===undefined)return undefined;try{return captureRegistrationSponsorObservation(observation,facade,purpose,policy);}catch{return fundingUnavailable();}};
 const validate=async(token:RegistrationSponsorObservationCapture|undefined,policy:ActiveRegistrationSponsorPolicy|null,purpose:'read'|'new-exposure',query:RegistrationSponsorSelection,required:boolean)=>{
  if(!token){if(required)fundingUnavailable();return null;}if(!policy)fundingUnavailable();
  try{const qualified=await validateRegistrationSponsorObservation(token,facade,policy,purpose),observed=observationInQuery(query);if(!observed||sha(canonicalJson(observed))!==qualified.dtoDigest)fundingUnavailable();live();return qualified;}catch{return fundingUnavailable();}
 };
 const execute=async(query:RegistrationSponsorSelection,write:boolean,token?:RegistrationSponsorObservationCapture)=>{
  live(write);const selector=registrationSponsorSelector(query),snapshot=await channel.call('registrationSponsorSnapshot' as Parameters<typeof channel.call>[0],[selector]);live(write);
  const plan=reduceRegistrationSponsor(snapshot,query),policy=registrationSponsorPinnedPolicy(plan,query),purpose=write?'new-exposure':'read',required=registrationSponsorNeedsFunding(plan,query);
  let evidence=await validate(token,policy,purpose,query,required);live(write);
  const result=await channel.call((write?'registrationSponsorCommit':'registrationSponsorRead') as Parameters<typeof channel.call>[0],[registrationSponsorCommitWire(plan,evidence)]);
  // A write may already be durable. A late authority/observation failure is an
  // unknown outcome and never permits another nonce, signature or automatic retry.
  try{live(write);evidence=await validate(token,policy,purpose,query,required);live(write);void evidence;if(!result||typeof result!=='object'||Object.keys(result).length!==1||!('resultWire'in result)||typeof result.resultWire!=='string'||result.resultWire!==plan.resultWire)throw new PostgresStorageUnavailable();return JSON.parse(result.resultWire);}catch(error){if(write)throw new PostgresDomainWriteOutcomeUnknown();throw error;}
 };
 return Object.freeze({
  async admitRegistrationSponsor(policy:ActiveRegistrationSponsorPolicy,row:SponsoredRegistration,now?:number,observation?:RegistrationSponsorFundingObservation){live(true);const token=capture(observation,'new-exposure',policy),query=captureRegistrationSponsorAdmit(policy,row,now,observation);return await execute(query,true,token) as SponsoredRegistration;},
  async getRegistrationSponsor(input:RegistrationSponsorLookup){live();const query=captureRegistrationSponsorLookup(input);return await execute(query,false) as SponsoredRegistration|null;},
  async getRegistrationSponsorExecution(input:{wallet:string;id:string}){live();const query=captureRegistrationSponsorExecution(input);return await execute(query,false) as RegistrationSponsorExecution|null;},
  async inspectRegistrationSponsorFunding(policy:ActiveRegistrationSponsorPolicy,observation:RegistrationSponsorFundingObservation,now?:number){live();const token=capture(observation,'read',policy),query=captureRegistrationSponsorFunding(policy,observation,now);return await execute(query,false,token) as RegistrationSponsorFundingInspection;},
  async transitionRegistrationSponsor(input:RegistrationSponsorTransition){live(true);const token=capture(input.fundingObservation,'new-exposure'),query=captureRegistrationSponsorTransition(input);return await execute(query,true,token) as SponsoredRegistration;},
 });
}
export type PostgresRegistrationSponsorPort=ReturnType<typeof composePostgresRegistrationSponsor>;
export type RegistrationSponsorCapturedPlan=RegistrationSponsorPlan;

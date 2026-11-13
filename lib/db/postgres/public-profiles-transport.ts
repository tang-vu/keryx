import { z } from 'zod';
import { PublicProfileError,publicHandle,publicProfileActor,publicProfileInput,publicProfileSettings,publicProfileSnapshot,publicProfileLedger,type PublicProfilesStore } from '../../profiles/public-profile';
import { identityUrl,providerIdentitySchema } from '../../profiles/verified-identities';
import { publicRun,recordedMicros,type PublicRunSource } from '../../profiles/public-profile-projection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const failure=z.object({ok:z.literal(false),error:z.enum(['public_profile_unavailable','profile_required','conflict','unauthenticated','not_owned'])}).strict();
const success=z.object({ok:z.literal(true),value:z.unknown()}).strict();
const unavailable=()=>new PublicProfileError('public_profile_unavailable');
const group=z.object({network:publicProfileLedger.shape.network,reader:z.boolean(),creator:z.boolean(),sponsored:z.boolean(),amount:z.string().max(256).nullable(),count:z.string().regex(/^[1-9]\d{0,18}$/)}).strict();
const profile=publicProfileSnapshot.omit({runs:true,verifiedLinks:true,ledgers:true}).extend({
 verified:z.array(z.object({provider:z.enum(['orcid','github']),externalId:z.string().max(32),label:z.string().max(160),verifiedAt:z.string().datetime()}).strict().superRefine((value,ctx)=>{
  const {verifiedAt:_,...identity}=value;if(!providerIdentitySchema.safeParse(identity).success)ctx.addIssue({code:'custom',message:'Invalid verified identity'});
 })).max(2).optional(),
});
const packet=z.object({profile,runs:z.array(z.object({wireHex:z.string().max(524288).regex(/^(?:[a-f0-9]{2})*$/),claimed:z.boolean(),networks:z.array(z.string().max(256)).max(3)}).strict()).max(50),ledger:z.array(group).max(65536)}).strict();
/** Synchronous projection after the final fresh native snapshot. */
export function projectPostgresPublicProfile(value:unknown){
 if(value===null)return null;const p=packet.parse(value),seen=new Set<string>();let bytes=0;
 const runs=p.runs.map(row=>{
  const raw=Buffer.from(row.wireHex,'hex');bytes+=raw.length;if(bytes>8388608)throw unavailable();
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);if(Buffer.from(text).toString('hex')!==row.wireHex)throw unavailable();
  const source=JSON.parse(text) as PublicRunSource;
  const run=publicRun(source,row.claimed,row.networks);if(seen.has(run.id))throw unavailable();seen.add(run.id);return run;
 });
 const ledgers=p.profile.ledgerBasis?(['eip155:5042','eip155:5042002'] as const).map(network=>{
  const totals:{reader:bigint|null;creator:bigint|null;sponsored:bigint|null}={reader:BigInt(0),creator:BigInt(0),sponsored:BigInt(0)};
  for(const row of p.ledger)if(row.network===network){const amount=row.amount===null?null:recordedMicros(Number(row.amount));
   for(const role of ['reader','creator','sponsored'] as const)if(row[role])totals[role]=totals[role]===null||amount===null?null:totals[role]+BigInt(amount)*BigInt(row.count);
  }
  return {network,readerPaidMicros:totals.reader?.toString()??null,creatorEarnedMicros:totals.creator?.toString()??null,sponsoredCreatorPaymentsMicros:totals.sponsored?.toString()??null};
 }):undefined;
 if(!ledgers&&p.ledger.length)throw unavailable();
 const {verified,...fields}=p.profile;
 if(verified&&new Set(verified.map(x=>x.provider)).size!==verified.length)throw unavailable();
 return publicProfileSnapshot.parse({...fields,runs,...(verified?{verifiedLinks:verified.map(i=>({provider:i.provider,label:i.label,url:identityUrl(i),verifiedAt:i.verifiedAt}))}:{}),...(ledgers?{ledgers}:{})});
}
export function composePostgresPublicProfiles(channel:PostgresDomainChannel,readOnly:boolean):PublicProfilesStore{
 if(typeof readOnly!=='boolean')throw unavailable();
 const live=()=>{if(channel.closed)throw unavailable();},writer=()=>{live();if(readOnly)throw unavailable();};
 const capture=<T>(work:()=>T)=>{try{return work();}catch{throw unavailable();}};
 const parse=(value:unknown)=>{const refused=failure.safeParse(value);if(refused.success)throw new PublicProfileError(refused.data.error);return success.parse(value).value;};
 const read=async<T>(name:'publicProfileRead'|'publicProfileSettings'|'publicProfileSitemap',input:unknown,project:(value:unknown)=>T)=>{
  live();try{const value=await channel.call(name,[JSON.stringify(input)]);live();return project(parse(value));}catch(error){if(error instanceof PublicProfileError)throw error;throw unavailable();}
 };
 const write=async<T>(name:'publicProfileUpdate'|'publicProfileUnpublish',args:readonly string[],project:(value:unknown)=>T)=>{
  writer();const value=await channel.call(name,args);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
  const refused=failure.safeParse(value);if(refused.success)throw new PublicProfileError(refused.data.error);
  try{return project(success.parse(value).value);}catch{throw new PostgresDomainWriteOutcomeUnknown();}
 };
 return Object.freeze({
  async read(raw){live();const handle=capture(()=>publicHandle.parse(raw));return read('publicProfileRead',{handle,claims:true},value=>{const result=projectPostgresPublicProfile(value);if(result&&result.handle!==handle)throw unavailable();return result;});},
  async settings(raw){live();const actor=capture(()=>publicProfileActor.parse(raw));return read('publicProfileSettings',actor,value=>publicProfileSettings.parse(value));},
  async sitemap(raw){live();const take=capture(()=>z.number().int().min(1).max(1000).parse(raw));return read('publicProfileSitemap',{take},value=>{const rows=z.array(z.object({handle:publicHandle,updatedAt:z.string().datetime()}).strict()).max(take).parse(value);let previous='';for(const row of rows){if(previous&&row.handle<=previous)throw unavailable();previous=row.handle;}return rows;});},
  async update(rawActor,rawInput){writer();const args=capture(()=>[JSON.stringify(publicProfileActor.parse(rawActor)),JSON.stringify(publicProfileInput.parse(rawInput))] as const);return write('publicProfileUpdate',args,value=>publicProfileSettings.parse(value));},
  async unpublish(raw){writer();const actor=capture(()=>publicProfileActor.parse(raw));return write('publicProfileUnpublish',[JSON.stringify(actor)],value=>{z.null().parse(value);});},
 } satisfies PublicProfilesStore);
}

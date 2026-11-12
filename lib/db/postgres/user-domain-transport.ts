import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { PrivateProfileError,privateProfileInputSchema,privateProfileRecordSchema,privateProfileSnapshotSchema,profileWallet,type PrivateProfilesStore } from '../../profiles/private-profile';
import { validateStorageIdentity,type StorageIdentity } from '../storage-identity';
import type { PostgresConnectionOptions } from './connection';
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { composePostgresApplicationDomainTransport,type PostgresApplicationDomainTransport } from './application-domain-transport';
export interface PostgresUserDomainTransport extends PostgresApplicationDomainTransport {
 readonly privateProfiles:PrivateProfilesStore;
}
/** Same native pool/identity; a protocol composition confers no installed
 * factory provenance, authenticated web session or another owner's authority. */
export function createPostgresUserDomainTransport(options:PostgresConnectionOptions,identity:StorageIdentity,digest:string):PostgresUserDomainTransport {
 const expected=validateStorageIdentity(identity);
 return composePostgresUserDomainTransport(createPostgresDomainChannel(options,expected,digest),expected,options.role!=='keryx_app');
}
export function composePostgresUserDomainTransport(channel:PostgresDomainChannel,identity:StorageIdentity,readOnly:boolean):PostgresUserDomainTransport {
 const expected=validateStorageIdentity(identity),unavailable=()=>new PrivateProfileError('profile_unavailable');
 if(typeof readOnly!=='boolean')throw unavailable();
 const live=()=>{if(channel.closed)throw unavailable();};
 const writer=()=>{live();if(readOnly)throw unavailable();};
 const privateProfiles:PrivateProfilesStore=Object.freeze({
  async get(owner,network){
   live();const wallet=profileWallet(owner);if(network!==expected.network)throw unavailable();
   let result:unknown;
   try{result=await channel.call('privateProfileGet',[wallet,network]);live();const parsed=privateProfileSnapshotSchema.parse(result);
    if(parsed.profile&&parsed.profile.wallet!==wallet||parsed.activity.network!==network)throw unavailable();return parsed;
   }catch{throw unavailable();}
  },
  async update(owner,raw){
   writer();const wallet=profileWallet(owner),input=privateProfileInputSchema.parse(raw),wire=canonicalJson(input);
   if(Buffer.byteLength(wire)>8192)throw unavailable();
   const value=await channel.call('privateProfileUpdate',[wallet,wire]);
   if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
   try{
    const conflict=z.object({status:z.literal('handle_conflict')}).strict().safeParse(value);if(conflict.success)throw new PrivateProfileError('handle_conflict');
    const result=z.object({status:z.literal('updated'),profile:privateProfileRecordSchema}).strict().parse(value).profile;
    const saved={displayName:result.displayName,handle:result.handle,bio:result.bio,purpose:result.purpose,links:result.links};
    if(result.wallet!==wallet||canonicalJson(saved)!==wire)throw new Error();return result;
   }catch(error){if(error instanceof PrivateProfileError&&error.code==='handle_conflict')throw error;throw new PostgresDomainWriteOutcomeUnknown();}
  },
  async delete(owner){
   writer();const wallet=profileWallet(owner),value=await channel.call('privateProfileDelete',[wallet]);
   if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
   try{z.object({deleted:z.literal(true)}).strict().parse(value);}catch{throw new PostgresDomainWriteOutcomeUnknown();}
  },
 } satisfies PrivateProfilesStore);
 return Object.freeze({...composePostgresApplicationDomainTransport(channel,expected),privateProfiles});
}

import {z} from 'zod';
import {canonicalJson} from '../../canonical-json';
import {PrivateProfileError,privateProfileInputSchema,privateProfileRecordSchema,privateProfileSnapshotSchema,profileWallet,type PrivateProfilesStore} from '../../profiles/private-profile';
import {validateStorageIdentity,type StorageIdentity} from '../storage-identity';
import {PostgresStorageBusy} from './connection';
import {PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel} from './domain-channel';

/** Same closed channel as sibling ports. Source's enrolled profile transaction
 * retires its selected connection on unclassified failures, including strict
 * activity/record decoding. Input/network/readonly refusals happen before that
 * transaction; recognized contention and handle conflicts leave it usable.
 * This composition grants no installed-facade or factory provenance. */
export function composePostgresPrivateProfiles(channel:PostgresDomainChannel,identity:StorageIdentity,readOnly:boolean):PrivateProfilesStore {
 const expected=validateStorageIdentity(identity),unavailable=()=>new PrivateProfileError('profile_unavailable');
 if(typeof readOnly!=='boolean')throw unavailable();
 let retired=false;
 const live=()=>{if(retired||channel.closed)throw unavailable();};
 const writer=()=>{live();if(readOnly)throw unavailable();};
 const retire=async()=>{
  retired=true;
  // The genuine channel closes admission synchronously, then drains requests.
  // The profile call has already settled before this runs, so it cannot wait
  // for itself. Cleanup failure never revives the selected capability.
  try{await channel.close();}catch{}
 };
 return Object.freeze({
  async get(owner,network){
   live();const wallet=profileWallet(owner);if(network!==expected.network)throw unavailable();
   try{
    const value=await channel.call('privateProfileGet',[wallet,network]);live();const parsed=privateProfileSnapshotSchema.parse(value);
    if(parsed.profile&&parsed.profile.wallet!==wallet||parsed.activity.network!==network)throw unavailable();return parsed;
   }catch(error){if(!(error instanceof PostgresStorageBusy))await retire();throw unavailable();}
  },
  async update(owner,raw){
   writer();const wallet=profileWallet(owner),input=privateProfileInputSchema.parse(raw),wire=canonicalJson(input);
   if(Buffer.byteLength(wire)>8192)throw unavailable();
   let value:unknown;
   try{value=await channel.call('privateProfileUpdate',[wallet,wire]);}
   catch(error){if(error instanceof PostgresStorageBusy)throw unavailable();await retire();throw error instanceof PostgresDomainWriteOutcomeUnknown?error:new PostgresDomainWriteOutcomeUnknown();}
   if(retired||channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
   try{
    const conflict=z.object({status:z.literal('handle_conflict')}).strict().safeParse(value);if(conflict.success)throw new PrivateProfileError('handle_conflict');
    const result=z.object({status:z.literal('updated'),profile:privateProfileRecordSchema}).strict().parse(value).profile;
    const saved={displayName:result.displayName,handle:result.handle,bio:result.bio,purpose:result.purpose,links:result.links};
    if(result.wallet!==wallet||canonicalJson(saved)!==wire)throw unavailable();return result;
   }catch(error){if(error instanceof PrivateProfileError&&error.code==='handle_conflict')throw error;await retire();throw new PostgresDomainWriteOutcomeUnknown();}
  },
  async delete(owner){
   writer();const wallet=profileWallet(owner);let value:unknown;
   try{value=await channel.call('privateProfileDelete',[wallet]);}
   catch(error){if(error instanceof PostgresStorageBusy)throw unavailable();await retire();throw error instanceof PostgresDomainWriteOutcomeUnknown?error:new PostgresDomainWriteOutcomeUnknown();}
   if(retired||channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
   try{z.object({deleted:z.literal(true)}).strict().parse(value);}catch{await retire();throw new PostgresDomainWriteOutcomeUnknown();}
  },
 } satisfies PrivateProfilesStore);
}

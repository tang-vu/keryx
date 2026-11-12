import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { profileWallet } from '../../profiles/private-profile';
import { ProfileIdentityError,identityChallengeSchema,identityProviderSchema,identityRecordSchema,identitySnapshotSchema,providerIdentitySchema,type IdentityChallenge,type ProfileIdentitiesStore } from '../../profiles/verified-identities';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
/** Typed fixed commands on the existing native channel; no SDK/factory proof. */
export function composePostgresProfileIdentities(channel:PostgresDomainChannel,readOnly:boolean):ProfileIdentitiesStore {
 const unavailable=()=>new ProfileIdentityError('identity_unavailable');
 if(typeof readOnly!=='boolean')throw unavailable();
 const live=()=>{if(channel.closed)throw unavailable();},writer=()=>{live();if(readOnly)throw unavailable();};
 const args=(c:IdentityChallenge)=>[c.wallet,c.provider,c.stateHash,c.sessionHash,c.expiresAt];
 const knownFailure=z.object({error:z.enum(['identity_conflict','identity_expired','profile_required'])}).strict();
 const writeResult=(value:unknown)=>{
  if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
  const failure=knownFailure.safeParse(value);if(failure.success)throw new ProfileIdentityError(failure.data.error);
  return value;
 };
 const ack=(value:unknown,key:'begun'|'consumed'|'unlinked')=>{
  const checked=writeResult(value);
  if(!checked||typeof checked!=='object'||Object.keys(checked).length!==1||Reflect.get(checked,key)!==true)throw new PostgresDomainWriteOutcomeUnknown();
 };
 return Object.freeze({
  async list(owner){
   live();const wallet=profileWallet(owner);
   try{const value=await channel.call('profileIdentityList',[wallet]);live();const result=identitySnapshotSchema.parse(value);if(result.wallet!==wallet)throw unavailable();return result;}
   catch{throw unavailable();}
  },
  async begin(raw){writer();const challenge=identityChallengeSchema.parse(raw);ack(await channel.call('profileIdentityBegin',args(challenge)),'begun');},
  async consume(raw){writer();const challenge=identityChallengeSchema.parse(raw);ack(await channel.call('profileIdentityConsume',args(challenge)),'consumed');},
  async complete(raw,rawIdentity){
   writer();const challenge=identityChallengeSchema.parse(raw),identity=providerIdentitySchema.parse(rawIdentity);
   if(challenge.provider!==identity.provider)throw new ProfileIdentityError('identity_expired');
   const value=writeResult(await channel.call('profileIdentityComplete',[...args(challenge),canonicalJson(identity)]));
   try{const result=z.object({completed:identityRecordSchema}).strict().parse(value).completed;
    if(result.wallet!==challenge.wallet||result.provider!==identity.provider||result.externalId!==identity.externalId||result.label!==identity.label)throw new Error();return result;
   }catch{throw new PostgresDomainWriteOutcomeUnknown();}
  },
  async unlink(owner,rawProvider){writer();const wallet=profileWallet(owner),provider=identityProviderSchema.parse(rawProvider);ack(await channel.call('profileIdentityUnlink',[wallet,provider]),'unlinked');},
 } satisfies ProfileIdentitiesStore);
}

import type {EvidenceProvenanceLookup} from '../../research/evidence-provenance';
import {PostgresStorageUnavailable} from './connection';
import {PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel} from './domain-channel';
import {captureEvidenceProvenanceBatch,decodeEvidenceProvenanceBatch,captureSourceVerification,type SourceVerificationInput} from './source-observation-packet';
export interface PostgresSourceObservationPort {
 readEvidenceProvenanceBatch(lookup:EvidenceProvenanceLookup):Promise<readonly string[]>;
 verifySourceIfUnchanged(input:SourceVerificationInput):Promise<boolean>;
}
/** A fixed protocol composition, never installed-facade provenance or a writer
 * admission. Runtime/Core owner supplies genuine entry and identity guards. */
export function composePostgresSourceObservations(channel:PostgresDomainChannel,readOnly:boolean):PostgresSourceObservationPort{
 if(typeof readOnly!=='boolean')throw new PostgresStorageUnavailable();
 const live=()=>{if(channel.closed)throw new PostgresStorageUnavailable();};
 return Object.freeze({
  async readEvidenceProvenanceBatch(lookup){
   live();const captured=captureEvidenceProvenanceBatch(lookup);
   if(!captured.sourceIdsHex.length&&!captured.itemIdsHex.length)return Object.freeze([]);
   const raw=await channel.call('sourceEvidenceProvenanceRead' as Parameters<PostgresDomainChannel['call']>[0],[captured.wire]);live();
   try{return decodeEvidenceProvenanceBatch(raw,captured);}catch{throw new PostgresStorageUnavailable();}
  },
  async verifySourceIfUnchanged(input){
   live();if(readOnly)throw new PostgresStorageUnavailable();const wire=captureSourceVerification(input);
   const result=await channel.call('sourceVerifyIfUnchanged' as Parameters<PostgresDomainChannel['call']>[0],[wire]);
   if(channel.closed||typeof result!=='boolean')throw new PostgresDomainWriteOutcomeUnknown();return result;
  },
 } satisfies PostgresSourceObservationPort);
}

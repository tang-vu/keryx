import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { QueryRun } from '../../types';
import { PrivacyError,type RunVisibility } from '../../run-privacy/contracts';
import { capturePostgresPublication } from './publication-packet';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
/** Captures before the first await; one fixed atomic operation, no retry. */
export function composePostgresPublication(channel:PostgresDomainChannel,readOnly:boolean){
 return async(input:QueryRun,publication?:{visibility:RunVisibility}):Promise<void>=>{
  if(readOnly||channel.closed)throw new PrivacyError('privacy_unavailable');
  const packet=capturePostgresPublication(input,publication),original=JSON.parse(packet.wire) as {originalHex:string},sha256=createHash('sha256').update(Buffer.from(original.originalHex,'hex')).digest('hex');
  const result=await channel.call('publicationSave',[packet.wire]);
  if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
  if(z.object({error:z.literal('privacy_unavailable')}).strict().safeParse(result).success)throw new PrivacyError('privacy_unavailable');
  try{z.object({id:z.literal(packet.id),originalSha256:z.literal(sha256)}).strict().parse(result);}catch{throw new PostgresDomainWriteOutcomeUnknown();}
 };
}

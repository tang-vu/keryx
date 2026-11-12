import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { RunClaimError,runClaimIssueSchema,runClaimAttemptSchema,runClaimIssuanceSchema,runClaimReceiptSchema,type RunClaimsStore } from '../../run-claims/contracts';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
/** Fixed native protocol; no token generation, SDK or installed-facade proof. */
export function composePostgresRunClaims(channel:PostgresDomainChannel,network:string,readOnly:boolean):RunClaimsStore {
 const unavailable=()=>new RunClaimError('claims_unavailable');
 if(typeof readOnly!=='boolean'||network!=='eip155:5042')throw unavailable();
 const live=()=>{if(channel.closed)throw unavailable();},writer=()=>{live();if(readOnly)throw unavailable();};
 const failure=z.object({error:z.enum(['claim_unavailable','claim_unauthenticated'])}).strict();
 const result=(value:unknown)=>{if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();const known=failure.safeParse(value);if(known.success)throw new RunClaimError(known.data.error);return value;};
 return Object.freeze({
  async assertAvailable(){live();try{z.object({domain:z.literal('anonymous-run-claims-v1')}).strict().parse(await channel.call('runClaimsReady',[]));live();}catch{throw unavailable();}},
  async issue(raw){
   writer();const parsed=runClaimIssueSchema.safeParse(raw);if(!parsed.success||parsed.data.binding.network!==network)throw new RunClaimError('claim_unavailable');
   const input=parsed.data,wire=canonicalJson(input.binding),value=result(await channel.call('runClaimIssue',[input.runId,input.tokenHash,input.completedAt,input.binding.network,input.binding.origin]));
   try{const issued=z.object({issued:runClaimIssuanceSchema}).strict().parse(value).issued;
    if(issued.runId!==input.runId||canonicalJson(issued.binding)!==wire||Date.parse(issued.issuedAt)<Date.parse(input.completedAt))throw new Error();return issued;
   }catch{throw new PostgresDomainWriteOutcomeUnknown();}
  },
  async claim(raw){
   writer();const parsed=runClaimAttemptSchema.safeParse(raw);if(!parsed.success||parsed.data.binding.network!==network)throw new RunClaimError('claim_unavailable');
   const input=parsed.data,wire=canonicalJson(input.binding),value=result(await channel.call('runClaimConsume',[input.tokenHash,input.wallet,input.sessionHash,input.binding.network,input.binding.origin]));
   try{const claimed=z.object({claimed:runClaimReceiptSchema}).strict().parse(value).claimed;
    if(claimed.wallet!==input.wallet||canonicalJson(claimed.binding)!==wire)throw new Error();return claimed;
   }catch{throw new PostgresDomainWriteOutcomeUnknown();}
  },
 } satisfies RunClaimsStore);
}

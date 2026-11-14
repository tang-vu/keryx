import { canonicalJson } from '../../canonical-json';
import type { IssueSourceClaimChallenge,VerifySourceClaim,BindSourceClaim,UpdateSourceClaimPolicy,SourceClaim,SourceClaimChallenge } from '../../sources/public-source-claim';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { captureSourceClaimIssue,captureSourceClaimReserve,captureSourceClaimVerify,captureSourceClaimBind,captureSourceClaimPolicy,sourceProducerSelector,reduceSourceProducer,type SourceProducerSelection } from './source-claims-write-packet';

/** The capture callback is private, synchronous and never escapes a public port. */
export function composeSourceProducerExecutor(channel:PostgresDomainChannel,readOnly:boolean){
 if(typeof readOnly!=='boolean')throw new PostgresStorageUnavailable();
 return async(capture:()=>SourceProducerSelection)=>{
  if(channel.closed||readOnly)throw new PostgresStorageUnavailable();const query=capture(),selector=sourceProducerSelector(query),snapshot=await channel.call('sourceProducerSnapshot' as Parameters<typeof channel.call>[0],[selector]);
  if(channel.closed)throw new PostgresStorageUnavailable();const plan=reduceSourceProducer(snapshot,query),ack=await channel.call('sourceProducerWrite' as Parameters<typeof channel.call>[0],[canonicalJson(plan)]);
  if(channel.closed||canonicalJson(ack)!==canonicalJson(plan.result))throw new PostgresDomainWriteOutcomeUnknown();return plan.result;
 };
}
export function composePostgresSourceClaimWrites(channel:PostgresDomainChannel,readOnly:boolean){
 const execute=composeSourceProducerExecutor(channel,readOnly);
 return Object.freeze({
  async issueSourceClaimChallenge(input:IssueSourceClaimChallenge){return await execute(()=>captureSourceClaimIssue(input)) as SourceClaimChallenge;},
  async reserveSourceClaimVerification(id:string,wallet:string,now?:number){return await execute(()=>captureSourceClaimReserve(id,wallet,now)) as SourceClaimChallenge;},
  async verifySourceClaim(input:VerifySourceClaim){return await execute(()=>captureSourceClaimVerify(input)) as SourceClaim;},
  async bindSourceClaim(input:BindSourceClaim){return await execute(()=>captureSourceClaimBind(input)) as SourceClaim;},
  async updateSourceClaimPolicy(input:UpdateSourceClaimPolicy){return await execute(()=>captureSourceClaimPolicy(input)) as SourceClaim;},
 });
}

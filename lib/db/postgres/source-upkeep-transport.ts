import type { SourceUpkeepClaim,SourceUpkeepSummary } from '../source-upkeep';
import type { PostgresDomainChannel } from './domain-channel';
import { composeSourceProducerExecutor } from './source-claims-write-transport';
import { captureSourceUpkeepClaim,captureSourceUpkeepFinish } from './source-claims-write-packet';

export function composePostgresSourceUpkeep(channel:PostgresDomainChannel,readOnly:boolean){
 const execute=composeSourceProducerExecutor(channel,readOnly);
 return Object.freeze({
  async claimSourceUpkeep(now:number){return await execute(()=>captureSourceUpkeepClaim(now)) as SourceUpkeepClaim|null;},
  async finishSourceUpkeep(claim:SourceUpkeepClaim,summary:SourceUpkeepSummary,now:number){await execute(()=>captureSourceUpkeepFinish(claim,summary,now));},
 });
}

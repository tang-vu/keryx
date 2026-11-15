import type { KeryxDB } from '../keryx-db';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { captureOnrampReserve,captureOnrampRelease,decodeOnrampFrame,prepareOnrampEffect,onrampPacketWire,ONRAMP_PROTOCOL_LIMITS,type OnrampCapture } from './onramp-packet';

export type PostgresOnrampPort=Pick<KeryxDB,'reserveOnramp'|'releaseOnramp'>;
/** Reservation metadata only: no provider, funder, wallet, signing or transfer
 * is constructed. Root supplies the channel's genuine per-await entry guards. */
export function composePostgresOnramp(channel:PostgresDomainChannel,readOnly:boolean):PostgresOnrampPort{
 const refuse=():never=>{throw new PostgresStorageUnavailable();},live=()=>{if(channel.closed||readOnly)refuse();};
 if(typeof readOnly!=='boolean')refuse();
 const call=(op:'onrampFrame'|'onrampApply',value:unknown)=>channel.call(op as Parameters<PostgresDomainChannel['call']>[0],[onrampPacketWire(value)]);
 const run=async(capture:OnrampCapture)=>{
  const deadline=performance.now()+ONRAMP_PROTOCOL_LIMITS.deadlineMs;
  for(let attempt=0;attempt<ONRAMP_PROTOCOL_LIMITS.attempts;attempt++){
   live();if(performance.now()>=deadline)refuse();
   const observed=decodeOnrampFrame(await call('onrampFrame',{capture}),capture);live();
   const prepared=prepareOnrampEffect(capture,observed);if(prepared.effect===null)return prepared.result;
   if(performance.now()>=deadline)refuse();
   // Only an ACKed, fixed `changed` result proves no business mutation occurred.
   // A thrown/lost write acknowledgement is never caught or retried here.
   const outcome=await call('onrampApply',{capture,frameSha256:observed.sha256,effect:prepared.effect});
   if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
   if(!outcome||typeof outcome!=='object'||Array.isArray(outcome)||Object.keys(outcome).sort().join(',')!=='status')throw new PostgresDomainWriteOutcomeUnknown();
   const status=(outcome as {status:unknown}).status;
   if(status==='changed'){live();continue;}
   if(status!=='applied'||performance.now()>=deadline)throw new PostgresDomainWriteOutcomeUnknown();
   return prepared.result;
  }
  return refuse();
 };
 return Object.freeze({
  async reserveOnramp(addressKey,dayKey,amount,dailyCap,now){live();const result=await run(captureOnrampReserve(addressKey,dayKey,amount,dailyCap,now));if(result!=='reserved'&&result!=='already-funded'&&result!=='daily-cap')throw new PostgresDomainWriteOutcomeUnknown();return result;},
  async releaseOnramp(addressKey,dayKey,amount){live();await run(captureOnrampRelease(addressKey,dayKey,amount));},
 } satisfies PostgresOnrampPort);
}

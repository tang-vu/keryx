import { z } from 'zod';
import { parseTopicWatchState } from '../../research/topic-watches';
import { TopicWatchStorageError,type TopicWatchesPort,type PrivateTopicWatchStore } from '../topic-watches-sqlite';
import { captureTopicWatch } from './watch-packet';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const sessionSchema=z.object({hash:z.string().regex(/^[a-f0-9]{64}$/),wallet:z.string().regex(/^0x[a-f0-9]{40}$/),issuedAt:z.number().int().nonnegative(),expiresAt:z.number().int().positive()}).strict();
const watchId=z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),revision=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const rowSchema=z.object({id:watchId,revision,originalHex:z.string().max(524288)}).strict();
const failure=z.object({error:z.enum(['watch_unavailable','watch_session_changed','watch_limit'])}).strict();
export function composePostgresWatches(channel:PostgresDomainChannel,readOnly:boolean):TopicWatchesPort{
 const unavailable=()=>new TopicWatchStorageError(),live=()=>{if(channel.closed)throw unavailable();};if(typeof readOnly!=='boolean')throw unavailable();
 const known=(value:unknown)=>{const p=failure.safeParse(value);if(p.success)throw new TopicWatchStorageError(p.data.error);return value;};
 return Object.freeze({bindSession(raw){
  live();const session=Object.freeze(sessionSchema.parse(raw)),wire=JSON.stringify(session);
  const key=(input:unknown)=>{const parsed=z.object({ownerWallet:sessionSchema.shape.wallet,watchId}).strict().parse(input);if(parsed.ownerWallet!==session.wallet)throw new TopicWatchStorageError('watch_session_changed');return parsed;};
  const decode=(raw:unknown)=>{const row=rowSchema.parse(raw),hex=row.originalHex;if(hex.length%2||/[^a-f0-9]/.test(hex))throw unavailable();const value=parseTopicWatchState(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(hex,'hex'))));if(value.key.ownerWallet!==session.wallet||value.key.watchId!==row.id||value.revision!==row.revision)throw unavailable();return value;};
  const read=async(op:'watchList'|'watchRead',args:string[])=>{try{live();const value=known(await channel.call(op,args));live();return value;}catch(error){if(error instanceof TopicWatchStorageError)throw error;throw unavailable();}};
  return Object.freeze({
   async list(){try{live();const p=z.object({items:z.array(rowSchema).max(32)}).strict().parse(await read('watchList',[wire]));const ids=p.items.map(x=>x.id);if(new Set(ids).size!==ids.length)throw unavailable();return p.items.map(decode);}catch(error){if(error instanceof TopicWatchStorageError)throw error;throw unavailable();}},
   async read(input){try{live();const selected=key(input),p=z.object({item:rowSchema.nullable()}).strict().parse(await read('watchRead',[wire,selected.watchId]));if(p.item&&p.item.id!==selected.watchId)throw unavailable();return p.item?decode(p.item):null;}catch(error){if(error instanceof TopicWatchStorageError)throw error;throw unavailable();}},
   async compareAndSwap(input,expectedRevision,rawNext,notAfterMs){
    live();if(readOnly)throw unavailable();const selected=key(input);if(expectedRevision!==null)revision.parse(expectedRevision);z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(notAfterMs);
    const next=captureTopicWatch(rawNext);if(next.projection.owner!==session.wallet||next.projection.id!==selected.watchId||next.projection.revision!==(expectedRevision??0)+1)throw unavailable();
    const packet=JSON.stringify({id:selected.watchId,expectedRevision,notAfterMs,...next}),value=await channel.call('watchCompareSwap',[wire,packet]);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();const result=known(value);
    try{return z.object({changed:z.boolean()}).strict().parse(result).changed;}catch{throw new PostgresDomainWriteOutcomeUnknown();}
   },
  } satisfies PrivateTopicWatchStore);
 } } satisfies TopicWatchesPort);
}

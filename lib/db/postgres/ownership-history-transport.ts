import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { HistoryError,historyWallet,historyIdSchema,historyDateSchema } from '../../history/personal-history';
import { runClaimBindingSchema } from '../../run-claims/contracts';
import { ownershipHistoryOriginal,runOwnershipSchema,runOwnershipHistoryQuerySchema,validateRunOwnershipHistoryRows,type RunOwnershipHistoryStore } from '../../run-claims/history';
import type { PostgresDomainChannel } from './domain-channel';
/** Owner-private protocols only. No installed runtime or public sharing authority. */
export function composePostgresOwnershipHistory(channel:PostgresDomainChannel,network:string):RunOwnershipHistoryStore{
 const unavailable=()=>new HistoryError('history_unavailable'),live=()=>{if(channel.closed)throw unavailable();};
 if(network!=='eip155:5042')throw unavailable();
 return Object.freeze({
  async list(owner,raw){
   try{
    live();const wallet=historyWallet(owner),query=runOwnershipHistoryQuerySchema.parse(raw),binding=canonicalJson(query.binding);if(query.binding.network!==network)throw unavailable();
    const result=await channel.call('ownershipHistoryList',[wallet,query.binding.network,query.binding.origin,canonicalJson(query.filters),String(query.take),query.upper?canonicalJson(query.upper):null,query.before?canonicalJson(query.before):null]);live();
    const packet=z.object({wallet:z.literal(wallet),binding:runClaimBindingSchema,rows:z.unknown()}).strict().parse(result);if(canonicalJson(packet.binding)!==binding)throw unavailable();
    return validateRunOwnershipHistoryRows(packet.rows,query);
   }catch{throw unavailable();}
  },
  async read(owner,rawBinding,rawId){
   try{
    live();const wallet=historyWallet(owner),binding=runClaimBindingSchema.parse(rawBinding),id=historyIdSchema.parse(rawId),wire=canonicalJson(binding);if(binding.network!==network)throw unavailable();
    const result=await channel.call('ownershipHistoryRead',[wallet,binding.network,binding.origin,id]);live();
    const packet=z.object({wallet:z.literal(wallet),binding:runClaimBindingSchema,item:z.object({id:z.literal(id),createdAt:historyDateSchema,originalHex:z.string().max(8000000),ownership:runOwnershipSchema}).strict().nullable()}).strict().parse(result);
    if(canonicalJson(packet.binding)!==wire)throw unavailable();if(packet.item===null)return null;
    const item=packet.item;if(item.originalHex.length%2||/[^a-f0-9]/.test(item.originalHex))throw unavailable();
    const original=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(item.originalHex,'hex'));
    const run=ownershipHistoryOriginal(JSON.parse(original),wallet,id,item.createdAt,item.ownership);live();return {run,ownership:item.ownership};
   }catch{throw unavailable();}
  },
 } satisfies RunOwnershipHistoryStore);
}

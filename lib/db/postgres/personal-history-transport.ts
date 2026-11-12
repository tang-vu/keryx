import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { HistoryError,historyFiltersSchema,historyPositionSchema,historyRowSchema,historyWallet,historyIdSchema,type PersonalHistoryStore } from '../../history/personal-history';
import { historyReceiptSchema } from '../../history/owned-history';
import type { PostgresDomainChannel } from './domain-channel';
/** Bounded internal projections; receipt callers still require privacy.owner. */
export function composePostgresPersonalHistory(channel:PostgresDomainChannel):PersonalHistoryStore {
 const unavailable=()=>new HistoryError('history_unavailable'),live=()=>{if(channel.closed)throw unavailable();};
 return Object.freeze({
  async list(owner,query){
   live();const wallet=historyWallet(owner),filters=historyFiltersSchema.parse(query.filters),take=query.take;
   if(!Number.isInteger(take)||take<1||take>51)throw unavailable();
   const upper=query.upper?canonicalJson(historyPositionSchema.parse(query.upper)):null,before=query.before?canonicalJson(historyPositionSchema.parse(query.before)):null;
   try{const value=await channel.call('personalHistoryList',[wallet,canonicalJson(filters),String(take),upper,before]);live();return z.object({wallet:z.literal(wallet),rows:z.array(historyRowSchema).max(take)}).strict().parse(value).rows;}
   catch{throw unavailable();}
  },
  async receipts(rawId,take){
   live();const id=historyIdSchema.parse(rawId);if(!Number.isInteger(take)||take<1||take>201)throw unavailable();
   try{const value=await channel.call('personalHistoryReceipts',[id,String(take)]);live();const rows=z.array(historyReceiptSchema).max(take).parse(value);if(rows.some(r=>r.queryId!==id))throw unavailable();return rows;}
   catch{throw unavailable();}
  },
 } satisfies PersonalHistoryStore);
}

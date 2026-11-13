import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AccountError,snapshotSchema,type AccountMembershipStore } from '../../accounts/contracts';
import { ACCOUNT_HISTORY_DEADLINE_MS,MAX_ACCOUNT_HISTORY_ORIGINAL_BYTES,MAX_ACCOUNT_HISTORY_TOTAL_BYTES,boundedAccountHistoryObservations,validateAccountHistoryEvidenceRows,validateAccountHistoryOriginals } from '../../accounts/history-evidence';
import type { PostgresDomainChannel } from './domain-channel';
const unavailable=()=>new AccountError('account_unavailable');
const refusal=z.object({ok:z.literal(false),error:z.enum(['account_unavailable','account_unauthenticated','account_changed'])}).strict();
const packet=z.object({ok:z.literal(true),value:z.object({format:z.literal('keryx-native-account-history-v1'),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),rows:z.array(z.record(z.string(),z.unknown())).max(1000)}).strict()}).strict();
/** Captured request evidence only. Each one-use finish performs a new native
 * current-account/original/privacy/claim read; no cached admission or sync facade. */
export function composePostgresAccountHistory(channel:PostgresDomainChannel):Pick<AccountMembershipStore,'prepareAsyncHistoryFence'>{
 const live=(deadline:number)=>{if(channel.closed||!Number.isSafeInteger(deadline)||deadline<=Date.now()||deadline>Date.now()+ACCOUNT_HISTORY_DEADLINE_MS)throw unavailable();};
 const call=async(snapshot:string,ids:string,originals:boolean,deadline:number)=>{
  live(deadline);try{const value=await channel.call('accountHistory',[snapshot,ids,String(originals),String(deadline)]);live(deadline);const failed=refusal.safeParse(value);if(failed.success)throw new AccountError(failed.data.error);return packet.parse(value).value;}catch(error){if(error instanceof AccountError)throw error;throw unavailable();}
 };
 return Object.freeze({async prepareAsyncHistoryFence(raw,observed,deadline){
  live(deadline);const snapshot=snapshotSchema.parse(raw),snapshotWire=JSON.stringify(snapshot);
  // Enforce existing bounds before cloning, and keep caller mutations outside
  // the plan. Full semantic JSON is checked, including unknown original fields.
  const items=boundedAccountHistoryObservations(JSON.parse(JSON.stringify(boundedAccountHistoryObservations(observed))));
  const wallets=new Set(snapshot.membership.members.map(m=>m.wallet));if(items.some(item=>!wallets.has(item.ownerWallet)))throw unavailable();
  const ids=items.map(item=>item.id),idsWire=JSON.stringify(ids),before=await call(snapshotWire,idsWire,true,deadline);let total=0;
  const rows=before.rows.map(row=>{
   if(typeof row.original_hex!=='string'||row.original_hex.length>MAX_ACCOUNT_HISTORY_ORIGINAL_BYTES*2||row.original_hex.length%2||/[^a-f0-9]/.test(row.original_hex))throw unavailable();
   const bytes=Buffer.from(row.original_hex,'hex');total+=bytes.length;if(total>MAX_ACCOUNT_HISTORY_TOTAL_BYTES||createHash('sha256').update(bytes).digest('hex')!==row.original_hash)throw unavailable();
   const {original_hex:_,...metadata}=row;return {...metadata,original:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)};
  });
  validateAccountHistoryEvidenceRows(snapshot.binding,ids,rows);validateAccountHistoryOriginals(items,rows);live(deadline);
  const fingerprint=before.fingerprint;before.rows.length=0;rows.length=0;items.length=0;let unused=true;
  return async()=>{if(!unused)throw unavailable();unused=false;const after=await call(snapshotWire,idsWire,false,deadline);if(after.rows.length||after.fingerprint!==fingerprint)throw unavailable();live(deadline);};
 }} satisfies Pick<AccountMembershipStore,'prepareAsyncHistoryFence'>);
}

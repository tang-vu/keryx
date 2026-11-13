import { z } from 'zod';
import { LEDGER_PAYMENT_LIMIT,LEDGER_RUN_LIMIT,ledgerFundingSchema } from '../../operator-ledger/contracts';
import { iso,type LedgerRunSnapshot } from '../../operator-ledger/capture';
import type { PublicLedgerRunReader } from '../../operator-ledger/native-runs';
import type { PostgresDomainChannel } from './domain-channel';
const unavailable=()=>new Error('Public ledger native metadata unavailable');
const identifier=z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/),stamp=z.string().refine(iso);
const snapshotSchema=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),createdAt:stamp,funding:ledgerFundingSchema,offline:z.boolean(),expected:z.number().int().min(0).max(LEDGER_PAYMENT_LIMIT).nullable(),
 references:z.array(z.object({kind:z.enum(['fetch','citation']),sourceId:identifier,itemId:identifier.nullable(),contentVersion:z.string().max(256).nullable(),synthetic:z.boolean()}).strict()).max(LEDGER_PAYMENT_LIMIT*2),
 fee:z.object({beneficiary:z.string().regex(/^0x[a-f0-9]{40}$/),amount:z.string().regex(/^[1-9]\d{0,77}$/),paymentId:identifier}).strict().nullable()}).strict();
const rowSchema=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),createdAt:stamp,snapshotHex:z.string().max(4194304),syntheticPositions:z.array(z.number().int().min(0).max(LEDGER_PAYMENT_LIMIT*2-1)).max(LEDGER_PAYMENT_LIMIT*2)}).strict();
export const capturePublicLedgerLimit=(raw:number)=>z.number().int().min(1).max(LEDGER_RUN_LIMIT+1).parse(raw);
export interface NativePublicLedgerReader extends PublicLedgerRunReader{read(limit:number):Promise<Array<LedgerRunSnapshot|null>>;}
export interface PostgresPublicLedgerTransport{readonly publicLedgerRuns:NativePublicLedgerReader;}
/** Fixed metadata-only read; whole originals and publication decisions are never
 * retained in Node. Fresh source/item flags refer to this same native snapshot. */
export function composePostgresPublicLedger(channel:PostgresDomainChannel,privacyActive:boolean):PostgresPublicLedgerTransport{
 if(typeof privacyActive!=='boolean')throw unavailable();
 return Object.freeze({publicLedgerRuns:Object.freeze({async read(raw){
  try{
   if(channel.closed||!privacyActive)throw unavailable();const take=capturePublicLedgerLimit(raw);
   const packet=z.object({format:z.literal('keryx-native-public-ledger-v1'),rows:z.array(rowSchema.nullable()).max(take)}).strict().parse(await channel.call('publicLedgerRead',[String(take)]));
   let bytes=0;const seen=new Set<string>();const rows=packet.rows.map(row=>{
    if(row===null)return null;if(seen.has(row.id)||row.snapshotHex.length%2||/[^a-f0-9]/.test(row.snapshotHex))throw unavailable();seen.add(row.id);
    const raw=Buffer.from(row.snapshotHex,'hex');bytes+=raw.byteLength;if(bytes>16777216)throw unavailable();
    const snapshot=snapshotSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw)));
    if(snapshot.id!==row.id||snapshot.createdAt!==row.createdAt)throw unavailable();let prior=-1;
    for(const position of row.syntheticPositions){if(position<=prior||position>=snapshot.references.length)throw unavailable();prior=position;snapshot.references[position].synthetic=true;}
    return snapshot satisfies LedgerRunSnapshot;
   });if(channel.closed)throw unavailable();return rows;
  }catch{throw unavailable();}
 } } satisfies PublicLedgerRunReader)});
}

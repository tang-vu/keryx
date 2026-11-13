import { createHash } from 'node:crypto';
import { originalBinding } from '../../deliverable-acceptance/original';
/** Exact SQLite SELECT * JSON property order and TEXT JSON cells are retained.
 * A PostgreSQL row/JSONB reserialization cannot allocate another old fingerprint.
 * Structural eligibility here never proves current settlement or caller authority. */
export function acceptanceOriginalMetadata(row:Readonly<Record<string,unknown>>,storeId:string){
 const orderWire=JSON.stringify(row),deliveryToken=JSON.stringify(row.response_data??null);
 if(Buffer.byteLength(orderWire)>4000000||Buffer.byteLength(deliveryToken)>4000000)throw Error('Acceptance SOURCE original bound');
 if(typeof row.id!=='string'||!/^a2a_[a-f0-9]{64}$/.test(row.id)||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId))throw Error('Acceptance SOURCE identity refused');
 const owner=typeof row.payer==='string'?row.payer.toLowerCase():null;
 let binding:ReturnType<typeof originalBinding>|null=null,network:'eip155:5042'|'eip155:5042002'|null=null;
 for(const candidate of ['eip155:5042','eip155:5042002'] as const){
  const text=`{"order":${orderWire},"deliveryText":${deliveryToken},"settled":true,"network":"${candidate}"}`;
  try{binding=originalBinding(storeId,text,owner??'',candidate,row.id);network=candidate;break;}catch{}
 }
 return Object.freeze({orderId:row.id,storeId,orderWire,orderSha256:createHash('sha256').update(orderWire).digest('hex'),deliveryToken,owner:owner&&/^0x[a-f0-9]{40}$/.test(owner)?owner:null,network,binding});
}

import { z } from 'zod';
import { AcceptanceError,acceptanceAuthoritySchema,acceptanceInputSchema,acceptanceWallet,deliverableIdSchema,networkSchema,publicAcceptanceSchema,type DeliverableAcceptanceStore } from '../../deliverable-acceptance/contracts';
import { originalBinding,ownerSnapshot,acceptanceMetrics } from '../../deliverable-acceptance/original';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const bundleSchema=z.object({storeId:z.string().uuid(),originalText:z.string().max(4194304),latest:z.unknown(),pendingPaymentLegs:z.boolean()}).strict();
const unavailable=()=>new AcceptanceError('acceptance_unavailable');
/** One fixed current-original CAS, no ordinary RPC/REST, retry or execution. */
export function composePostgresAcceptance(channel:PostgresDomainChannel,readOnly:boolean):DeliverableAcceptanceStore{
 if(typeof readOnly!=='boolean')throw unavailable();const live=()=>{if(channel.closed)throw unavailable();};
 const lookup=(owner:string,network:string,id:string)=>[acceptanceWallet(owner),networkSchema.parse(network),deliverableIdSchema.parse(id)] as const;
 const parse=(raw:unknown,args:ReturnType<typeof lookup>)=>{const bundle=bundleSchema.parse(raw),binding=originalBinding(bundle.storeId,bundle.originalText,...args);return {bundle,binding,snapshot:ownerSnapshot(binding,...args,bundle.latest,bundle.pendingPaymentLegs)};};
 const read=async(args:ReturnType<typeof lookup>)=>{live();const raw=await channel.call('acceptanceRead',args);live();return parse(raw,args);};
 return Object.freeze({
  async read(owner,network,id){try{live();return(await read(lookup(owner,network,id))).snapshot;}catch(error){if(error instanceof AcceptanceError)throw error;throw unavailable();}},
  async submit(owner,network,id,raw,rawAuthority){
   live();if(readOnly)throw unavailable();let args:ReturnType<typeof lookup>,input:z.infer<typeof acceptanceInputSchema>,authority:z.infer<typeof acceptanceAuthoritySchema>;
   try{args=lookup(owner,network,id);input=acceptanceInputSchema.parse(raw);authority=acceptanceAuthoritySchema.parse(rawAuthority);}catch{throw unavailable();}
   let before:Awaited<ReturnType<typeof read>>;try{before=await read(args);}catch(error){if(error instanceof AcceptanceError)throw error;throw unavailable();}
   if(before.binding.originalFingerprint!==input.originalFingerprint||before.binding.deliveredDigest!==input.deliveredDigest)throw new AcceptanceError('acceptance_conflict');
   const result=await channel.call('acceptanceSubmit',[...args,JSON.stringify(input),JSON.stringify(authority),before.binding.originalTextSha256]);
   if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
   const refused=z.object({error:z.enum(['acceptance_conflict','acceptance_unauthenticated','acceptance_unavailable'])}).strict().safeParse(result);if(refused.success)throw new AcceptanceError(refused.data.error);
   try{const after=parse(result,args);if(after.binding.originalFingerprint!==input.originalFingerprint||after.binding.deliveredDigest!==input.deliveredDigest||after.snapshot.revision<input.expectedRevision+1)throw Error();return after.snapshot;}catch{throw new PostgresDomainWriteOutcomeUnknown();}
  },
  async publicState(network,id){try{live();const args=[networkSchema.parse(network),deliverableIdSchema.parse(id)],raw=await channel.call('acceptancePublic',args);live();return publicAcceptanceSchema.parse(raw);}catch{throw unavailable();}},
  async metrics(network){try{live();const selected=networkSchema.parse(network),raw=await channel.call('acceptanceMetrics',[selected]);live();return acceptanceMetrics(z.array(publicAcceptanceSchema).max(1000).parse(raw));}catch{throw unavailable();}},
 } satisfies DeliverableAcceptanceStore);
}

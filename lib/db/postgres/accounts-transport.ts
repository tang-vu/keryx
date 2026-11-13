import { z } from 'zod';
import { AccountError,accountConsentSchema,bindingSchema,challengeSchema,digestSchema,interactiveSessionSchema,membershipSchema,preconditionSchema,snapshotSchema,walletInputSchema,type AccountMembershipStore } from '../../accounts/contracts';
import { accountDigest,randomAccountValue,membershipNonceHash,sessionCommitment } from '../../accounts/protocol';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const failed=z.object({ok:z.literal(false),error:z.enum(['account_unavailable','account_unauthenticated','account_changed','invalid_membership_proof','wallet_unavailable','account_full','last_credential','invalid_account_request'])}).strict();
const succeeded=z.object({ok:z.literal(true),value:z.unknown()}).strict();
const takenSchema=z.object({challenge:challengeSchema,nonce:digestSchema,lease:digestSchema}).strict();
const unavailable=()=>new AccountError('account_unavailable');
/** Fixed private journal protocol. No caller clocks, raw SQL, retries or history
 * seal. The complete writer remains closed until every required domain qualifies. */
export function composePostgresAccounts(channel:PostgresDomainChannel,readOnly:boolean):AccountMembershipStore{
 if(typeof readOnly!=='boolean')throw unavailable();const live=()=>{if(channel.closed)throw unavailable();},writer=()=>{live();if(readOnly)throw unavailable();};
 const capture=<T>(work:()=>T)=>{try{return work();}catch{throw unavailable();}};
 const unwrap=(result:unknown)=>{const refused=failed.safeParse(result);if(refused.success)throw new AccountError(refused.data.error);return succeeded.parse(result).value;};
 const read=async<T>(operation:'accountOffer'|'accountResolve'|'accountCurrent',args:object,parse:(value:unknown)=>T)=>{
  live();const wire=JSON.stringify(args);try{const result=await channel.call(operation,[wire]);live();return parse(unwrap(result));}catch(error){if(error instanceof AccountError)throw error;throw unavailable();}
 };
 const write=async<T>(operation:'accountResume'|'accountIssue'|'accountTake'|'accountComplete'|'accountUnlink'|'accountRevoke',args:object,parse:(value:unknown)=>T)=>{
  writer();const wire=JSON.stringify(args),result=await channel.call(operation,[wire]);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
  const refused=failed.safeParse(result);if(refused.success)throw new AccountError(refused.data.error);
  try{return parse(succeeded.parse(result).value);}catch{throw new PostgresDomainWriteOutcomeUnknown();}
 };
 const absent=(value:unknown)=>{z.null().parse(value);};
 const snapshot=(value:unknown,session:z.infer<typeof interactiveSessionSchema>,binding:z.infer<typeof bindingSchema>)=>{const result=snapshotSchema.parse(value);if(JSON.stringify(result.session)!==JSON.stringify(session)||JSON.stringify(result.binding)!==JSON.stringify(binding))throw unavailable();return result;};
 return Object.freeze({
  async offer(raw,b){live();const args=capture(()=>({session:interactiveSessionSchema.parse(raw),binding:bindingSchema.parse(b)}));return read('accountOffer',args,value=>preconditionSchema.nullable().parse(value));},
  async resolve(raw,b){live();const args=capture(()=>({session:interactiveSessionSchema.parse(raw),binding:bindingSchema.parse(b)}));return read('accountResolve',args,value=>value===null?null:snapshot(value,args.session,args.binding));},
  async assertCurrent(raw){live();const args=capture(()=>({snapshot:snapshotSchema.parse(raw)}));return read('accountCurrent',args,absent);},
  async resume(raw,b,expected,consent){writer();const args=capture(()=>({session:interactiveSessionSchema.parse(raw),binding:bindingSchema.parse(b),expected:preconditionSchema.parse(expected),consent:accountConsentSchema.parse(consent)}));return write('accountResume',args,value=>{const result=snapshot(value,args.session,args.binding);if(result.membership.accountId!==args.expected.accountId||result.membership.revision!==args.expected.revision)throw unavailable();return result;});},
  async issue(raw,challenge,nonceHash){writer();const args=capture(()=>({session:interactiveSessionSchema.parse(raw),challengeWire:JSON.stringify(challengeSchema.parse(challenge)),nonceHash:digestSchema.parse(nonceHash)}));return write('accountIssue',args,absent);},
  async take(raw,b,nonce,purpose,lease){writer();const args=capture(()=>({session:interactiveSessionSchema.parse(raw),binding:bindingSchema.parse(b),nonce:digestSchema.parse(nonce),purpose:typeof purpose==='string'&&purpose.length<=128?purpose:null,lease:digestSchema.parse(lease)}));return write('accountTake',args,value=>{const result=takenSchema.parse(value);if(result.nonce!==args.nonce||result.lease!==args.lease||result.challenge.purpose!==args.purpose||JSON.stringify(result.challenge.binding)!==JSON.stringify(args.binding)||result.challenge.sessionCommitment!==sessionCommitment(args.session,membershipNonceHash(args.nonce)))throw unavailable();return result;});},
  async complete(raw,taken,proofHash){writer();const args=capture(()=>{const selected=takenSchema.parse(taken);return {session:interactiveSessionSchema.parse(raw),challengeWire:JSON.stringify(selected.challenge),nonce:selected.nonce,lease:selected.lease,proofHash:digestSchema.parse(proofHash),generated:{credentialGeneration:randomAccountValue(),eventId:randomAccountValue()}};});const challenge=challengeSchema.parse(JSON.parse(args.challengeWire));return write('accountComplete',args,value=>{const result=snapshot(value,args.session,challenge.binding);if(result.membership.accountId!==challenge.accountId||result.membership.revision!==challenge.revision+1||!result.membership.members.some(m=>m.wallet===challenge.wallet&&m.generation===challenge.generation))throw unavailable();return result;});},
  async unlink(raw,wallet,generation){writer();const args=capture(()=>({snapshot:snapshotSchema.parse(raw),wallet:walletInputSchema.parse(wallet),generation:digestSchema.parse(generation),generated:{cancelHash:accountDigest('keryx-membership-unlink-cancel-v1:'+randomAccountValue()),eventId:randomAccountValue()}}));return write('accountUnlink',args,value=>{if(args.wallet===args.snapshot.session.wallet){z.null().parse(value);return null;}const result=membershipSchema.parse(value),expected={...args.snapshot.membership,revision:args.snapshot.membership.revision+1,members:args.snapshot.membership.members.filter(m=>m.wallet!==args.wallet)};if(JSON.stringify(result)!==JSON.stringify(expected))throw unavailable();return result;});},
  async revokeSession(raw){writer();const args=capture(()=>({snapshot:snapshotSchema.parse(raw)}));return write('accountRevoke',args,absent);},
 } satisfies AccountMembershipStore);
}

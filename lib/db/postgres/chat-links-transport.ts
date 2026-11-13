import { z } from 'zod';
import { bindingSchema,digestSchema,snapshotSchema,type AccountBinding } from '../../accounts/contracts';
import { ChatAccountError,linkSchema,pendingSchema,recipientSchema,type ChatAccountLinksStore,type ChatLink,type ChatRecipient } from '../../chat-accounts/contracts';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const failure=z.object({ok:z.literal(false),error:z.enum(['chat_unavailable','chat_token_invalid','chat_takeover_refused','chat_account_changed'])}).strict();
const success=z.object({ok:z.literal(true),value:z.unknown()}).strict();
const unavailable=()=>new ChatAccountError('chat_unavailable');
/** Private protocol composition, not provider-envelope, consent or installed
 * facade authority. Every call captures inputs and performs fixed fresh SQL. */
export function composePostgresChatLinks(channel:PostgresDomainChannel,readOnly:boolean):ChatAccountLinksStore{
 if(typeof readOnly!=='boolean')throw unavailable();const live=()=>{if(channel.closed)throw unavailable();},writer=()=>{live();if(readOnly)throw unavailable();};
 const capture=<T>(work:()=>T)=>{try{return work();}catch{throw unavailable();}};
 const read=async<T>(operation:'chatPreview'|'chatLookup'|'chatList',args:object,parse:(value:unknown)=>T)=>{
  live();try{const value=await channel.call(operation,[JSON.stringify(args)]);live();const refused=failure.safeParse(value);if(refused.success)throw new ChatAccountError(refused.data.error);return parse(success.parse(value).value);}catch(error){if(error instanceof ChatAccountError)throw error;throw unavailable();}
 };
 const write=async<T>(operation:'chatIssue'|'chatComplete'|'chatUnlink'|'chatUnlinkAccount',args:object,parse:(value:unknown)=>T)=>{
  writer();const value=await channel.call(operation,[JSON.stringify(args)]);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();const refused=failure.safeParse(value);if(refused.success)throw new ChatAccountError(refused.data.error);
  try{return parse(success.parse(value).value);}catch{throw new PostgresDomainWriteOutcomeUnknown();}
 };
 const binding=(link:ChatLink,b:AccountBinding)=>{if(JSON.stringify(link.binding)!==JSON.stringify(b))throw unavailable();return link;};
 const recipient=(link:ChatLink,r:ChatRecipient,b:AccountBinding)=>{binding(link,b);if(link.platform!==r.platform||link.scope!==r.scope||link.userId!==r.userId)throw unavailable();return link;};
 const absent=(value:unknown)=>{z.null().parse(value);};
 return Object.freeze({
  async issue(raw){writer();const args=capture(()=>({pending:pendingSchema.parse(raw)}));return write('chatIssue',args,absent);},
  async preview(raw,b){live();const args=capture(()=>({hash:digestSchema.parse(raw),binding:bindingSchema.parse(b)}));return read('chatPreview',args,value=>{const p=pendingSchema.parse(value);if(p.tokenHash!==args.hash||JSON.stringify(p.binding)!==JSON.stringify(args.binding))throw unavailable();return p;});},
  async complete(raw,s){writer();const args=capture(()=>({hash:digestSchema.parse(raw),snapshot:snapshotSchema.parse(s)}));return write('chatComplete',args,value=>{const link=binding(linkSchema.parse(value),args.snapshot.binding);if(link.accountId!==args.snapshot.membership.accountId||link.wallet!==args.snapshot.session.wallet||link.memberGeneration!==args.snapshot.memberGeneration)throw unavailable();return link;});},
  async lookup(raw,b){live();const args=capture(()=>({recipient:recipientSchema.parse(raw),binding:bindingSchema.parse(b)}));return read('chatLookup',args,value=>value===null?null:recipient(linkSchema.parse(value),args.recipient,args.binding));},
  async unlink(raw,b){writer();const args=capture(()=>({recipient:recipientSchema.parse(raw),binding:bindingSchema.parse(b)}));return write('chatUnlink',args,absent);},
  async list(raw){live();const args=capture(()=>({snapshot:snapshotSchema.parse(raw)}));return read('chatList',args,value=>{
   const links=z.array(linkSchema).max(32).parse(value),seen=new Set<string>();let previous='';
   for(const link of links){binding(link,args.snapshot.binding);const key=[link.platform,link.scope,link.userId].join('\0');if(link.accountId!==args.snapshot.membership.accountId||seen.has(key)||previous&&key<=previous)throw unavailable();seen.add(key);previous=key;}return links;
  });},
  async unlinkAccount(raw,s){writer();const args=capture(()=>({recipient:recipientSchema.parse(raw),snapshot:snapshotSchema.parse(s)}));return write('chatUnlinkAccount',args,absent);},
 } satisfies ChatAccountLinksStore);
}

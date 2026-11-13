import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { canonicalWalletSchema } from '../../accounts/contracts';
import { bindingSchema,sessionSchema,recipientSchema,recipientActionSchema,associationSchema,receiptSchema,AssignmentError,type AsyncOwnerRunAssignmentsPort,type RecipientAction,type Receipt } from '../../owner-run-assignments/contracts';
import { assignmentDigest,parseManifest } from '../../owner-run-assignments/protocol';
import { inboxSchema,projectAssignment } from '../../owner-run-assignments/projection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const failure=z.object({ok:z.literal(false),error:z.enum(['assignment_unavailable','assignment_unauthenticated','assignment_conflict','assignment_ineligible','assignment_consent_required','assignment_arbitration_unavailable','assignment_owner_required'])}).strict();
const success=z.object({ok:z.literal(true),value:z.unknown()}).strict();
const packet=z.object({recipient:recipientSchema,history:z.array(z.object({row:associationSchema,effective:z.boolean()}).strict()).max(25),receipt:receiptSchema.nullable()}).strict();
const unavailable=()=>new AssignmentError('assignment_unavailable');
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
const originSchema=bindingSchema.shape.origin;
export function captureOwnerAssignmentReply(session:unknown,wallet:unknown,origin:unknown,expected?:unknown,receipt?:unknown){
 return [sessionSchema.parse(session),canonicalWalletSchema.parse(wallet),originSchema.parse(origin),expected===undefined?undefined:recipientSchema.parse(expected),receipt===undefined?undefined:receiptSchema.parse(receipt)] as const;
}
function checkReceipt(receipt:Receipt,input:RecipientAction,actor:z.infer<typeof recipientSchema>){
 if(receipt.requestId!==input.requestId||receipt.action!==input.action||receipt.inputDigest!==assignmentDigest('operation',{input,actor}))throw unavailable();
 const expected=input.action==='consent'?[]:input.action==='withdraw-consent'?input.expected:[input.expected];
 if(receipt.results.length!==expected.length||receipt.results.some((result,i)=>result.assignmentId!==expected[i].assignmentId||result.revision!==expected[i].revision+1
  ||result.status!==(input.action==='confirm'?'claimed':input.action==='reject'?'rejected':'revoked')))throw unavailable();
 return receipt;
}
/** Fresh SQL owns current authorization and the final snapshot. The synchronous
 * projection below has no provider, owner, retry or financial capability. */
export function composePostgresOwnerAssignments(channel:PostgresDomainChannel,readOnly:boolean):AsyncOwnerRunAssignmentsPort{
 if(typeof readOnly!=='boolean')throw unavailable();
 const live=()=>{if(channel.closed)throw unavailable();},writer=()=>{live();if(readOnly)throw unavailable();};
 const capture=<T>(work:()=>T)=>{try{return work();}catch{throw unavailable();}};
 return Object.freeze({
  mode:'native-postgres-async-v1',
  async act(rawSession,rawExpected,rawInput,rawOrigin){
   writer();const [session,expected,input,origin]=capture(()=>{
    const parsed=recipientActionSchema.parse(rawInput);if(parsed.action==='consent')parseManifest(parsed.manifest);
    return [sessionSchema.parse(rawSession),recipientSchema.parse(rawExpected),parsed,originSchema.parse(rawOrigin)] as const;
   });
   try{
    const value=await channel.call('ownerAssignmentAct',[JSON.stringify(session),JSON.stringify(expected),JSON.stringify(input),origin]);
    if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();const refused=failure.safeParse(value);if(refused.success)throw new AssignmentError(refused.data.error);
    try{return checkReceipt(receiptSchema.parse(success.parse(value).value),input,expected);}catch{throw new PostgresDomainWriteOutcomeUnknown();}
   }catch(error){if(error instanceof AssignmentError)throw error;if(error instanceof PostgresDomainWriteOutcomeUnknown)throw new AssignmentError('assignment_outcome_unresolved');throw unavailable();}
  },
  async reply(rawSession,rawWallet,rawOrigin,rawExpected,rawReceipt){
   live();const [session,wallet,origin,expected,receipt]=capture(()=>captureOwnerAssignmentReply(rawSession,rawWallet,rawOrigin,rawExpected,rawReceipt));
   try{
    const result=await channel.call('ownerAssignmentReply',[JSON.stringify(session),wallet,origin,JSON.stringify(expected??null),JSON.stringify(receipt??null)]);live();
    const refused=failure.safeParse(result);if(refused.success)throw new AssignmentError(refused.data.error);
    const value=packet.parse(success.parse(result).value);
    if(value.recipient.wallet!==wallet||expected&&!same(value.recipient,expected)||!same(value.receipt,receipt??null))throw unavailable();
    let previous='';const history=value.history.map(({row,effective})=>{
     if(!same(row.manifest.recipient,value.recipient)||row.manifest.binding.origin!==origin||row.status!=='assigned-by-owner'&&row.status!=='claimed'
      ||!same(row.member,row.manifest.members[row.ordinal])||previous&&row.member.assignmentId<=previous)throw unavailable();
     previous=row.member.assignmentId;return projectAssignment(row,effective);
    });
    const body=inboxSchema.parse({version:1,kind:'owner-assignment-inbox',recipient:value.recipient,history,
     profile:{assignedByOwner:history.filter(r=>r.effective&&r.attribution==='assigned-by-owner').length,claimedFromOwnerAssignment:history.filter(r=>r.effective&&r.attribution==='claimed-from-owner-assignment').length},...(receipt?{receipt}:{})});
    return Response.json(body,{headers});
   }catch(error){if(error instanceof AssignmentError)throw error;throw unavailable();}
  },
 } satisfies AsyncOwnerRunAssignmentsPort);
}

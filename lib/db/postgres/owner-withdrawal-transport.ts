import { z } from "zod";
import { canonicalJson } from "../../canonical-json";
import { validateWithdrawalRequest,withdrawalIdSchema,withdrawalOwnerSchema,type WithdrawalRequestRecord } from "../../gateway/withdrawal-request";
import { verifyCreatorOwnerWithdrawalCompletion,type CreatorOwnerWithdrawalAccounting,type CreatorOwnerWithdrawalCompletion } from "../../gateway/creator-owner-withdrawal-protocol";
import { validateStorageIdentity,type StorageIdentity } from "../storage-identity";
import { PostgresStorageUnavailable,type PostgresConnectionOptions } from "./connection";
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from "./domain-channel";
import { composePostgresHostedLedgerTransport,type PostgresHostedLedgerTransport } from "./hosted-ledger-transport";

export interface PostgresOwnerWithdrawalTransport extends PostgresHostedLedgerTransport{
  creatorOwnerWithdrawalAccounting(owner:string):Promise<CreatorOwnerWithdrawalAccounting>;
  admitCreatorOwnerWithdrawal(record:WithdrawalRequestRecord,accounting:CreatorOwnerWithdrawalAccounting,availableMicroUsdc:string):Promise<WithdrawalRequestRecord>;
  getCreatorOwnerWithdrawalCompletion(id:string,owner:string):Promise<CreatorOwnerWithdrawalCompletion|null>;
  completeCreatorOwnerWithdrawal(value:CreatorOwnerWithdrawalCompletion):Promise<CreatorOwnerWithdrawalCompletion>;
}
const micro=z.string().regex(/^(0|[1-9][0-9]{0,15})$/).refine(v=>BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER));
const totals=z.object({heldPaymentMicroUsdc:micro,heldWithdrawalMicroUsdc:micro,confirmedPaymentMicroUsdc:micro,confirmedWithdrawalMicroUsdc:micro}).strict();
function unavailable():never{throw new PostgresStorageUnavailable();}
function wire(v:unknown,bound:number){const s=canonicalJson(v);if(Buffer.byteLength(s)>bound)unavailable();return s;}
export function createPostgresOwnerWithdrawalTransport(options:PostgresConnectionOptions,identity:StorageIdentity,digest:string):PostgresOwnerWithdrawalTransport{
  const expected=validateStorageIdentity(identity);return composePostgresOwnerWithdrawalTransport(createPostgresDomainChannel(options,expected,digest),expected);
}
export function composePostgresOwnerWithdrawalTransport(channel:PostgresDomainChannel,identity:StorageIdentity):PostgresOwnerWithdrawalTransport{
  const live=()=>{if(channel.closed)unavailable();};
  const write=async(operation:'ownerAdmit'|'ownerComplete',args:string[])=>{live();await channel.call(operation,args);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();};
  return Object.freeze({
    ...composePostgresHostedLedgerTransport(channel,identity),
    async creatorOwnerWithdrawalAccounting(owner:string){
      live();if(!/^0x[0-9a-f]{40}$/.test(owner))unavailable();const response=await channel.call('ownerAccounting',[owner]);live();
      try{return Object.freeze(totals.parse(response));}catch{return unavailable();}
    },
    async admitCreatorOwnerWithdrawal(value:WithdrawalRequestRecord,baseline:CreatorOwnerWithdrawalAccounting,availableMicroUsdc:string){
      live();const before=totals.parse(baseline),available=z.string().regex(/^(0|[1-9][0-9]{0,15})$/).parse(availableMicroUsdc);
      const r=await validateWithdrawalRequest(value);live();if(r.network!=='eip155:5042'||r.owner!==r.policy.recipient)unavailable();
      await write('ownerAdmit',[wire(r,8192),canonicalJson(before),available]);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();return r;
    },
    async getCreatorOwnerWithdrawalCompletion(id:string,owner:string){
      live();const key=withdrawalIdSchema.parse(id),wallet=withdrawalOwnerSchema.parse(owner),response=await channel.call('ownerCompletion',[key,wallet]);live();if(response===null)return null;
      try{const stored=z.object({record:z.unknown(),completion:z.unknown()}).strict().parse(response);
        const r=await validateWithdrawalRequest(stored.record);live();if(r.id!==key||r.owner!==wallet||r.network!=='eip155:5042')unavailable();
        if(stored.completion===null)return null;
        const c=await verifyCreatorOwnerWithdrawalCompletion(stored.completion);live();if(canonicalJson(c.record)!==canonicalJson(r))unavailable();return c;
      }catch{return unavailable();}
    },
    async completeCreatorOwnerWithdrawal(value:CreatorOwnerWithdrawalCompletion){
      live();const proposed=structuredClone(value),c=await verifyCreatorOwnerWithdrawalCompletion(proposed);live();
      await write('ownerComplete',[wire(c,16384)]);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();return c;
    },
  });
}

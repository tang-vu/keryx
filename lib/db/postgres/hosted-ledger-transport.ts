import { z } from "zod";
import { ARC_MAINNET_PROFILE } from "../../arc-network-profile";
import { canonicalJson } from "../../canonical-json";
import { hostedTreasuryPolicyDigest,validateHostedTreasuryPolicy,type HostedTreasuryPolicy } from "../../payments/hosted-treasury-policy";
import type { ServerX402Submission } from "../../payments/server-x402-client";
import type { HostedTreasuryAccounting } from "../hosted-treasury-journal";
import { validateStorageIdentity,type StorageIdentity } from "../storage-identity";
import { PostgresStorageUnavailable,type PostgresConnectionOptions } from "./connection";
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from "./domain-channel";
import { composePostgresCreatorWithdrawalTransport,type PostgresCreatorWithdrawalTransport } from "./creator-withdrawal-transport";

export interface PostgresHostedLedgerTransport extends PostgresCreatorWithdrawalTransport {
  admitHostedTreasuryPolicy(policy:HostedTreasuryPolicy,role:"public"|"private"):Promise<string>;
  hostedTreasuryAccounting(signer:string,role?:"public"|"private"):Promise<HostedTreasuryAccounting>;
  submitHostedAuthorization(signer:string,submission:Readonly<ServerX402Submission>,headerHash:string):Promise<void>;
  confirmHostedAuthorization(signer:string,nonce:string,transaction:string):Promise<void>;
}
const address=z.string().regex(/^0x[0-9a-f]{40}$/),nonce=z.string().regex(/^0x[0-9a-f]{64}$/);
const micro=z.string().regex(/^(0|[1-9][0-9]{0,15})$/).refine(v=>BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER));
function unavailable():never{throw new PostgresStorageUnavailable();}

/** Retained hosted ledger only. It does not expose authorization admission,
 * funding, signer custody, a provider request, policy renewal or app provenance. */
export function createPostgresHostedLedgerTransport(options:PostgresConnectionOptions,identity:StorageIdentity,digest:string):PostgresHostedLedgerTransport{
  const expected=validateStorageIdentity(identity);
  return composePostgresHostedLedgerTransport(createPostgresDomainChannel(options,expected,digest),expected);
}
export function composePostgresHostedLedgerTransport(channel:PostgresDomainChannel,identity:StorageIdentity):PostgresHostedLedgerTransport{
  const expected=validateStorageIdentity(identity),live=()=>{if(channel.closed)unavailable();};
  const write=async(op:"hostedPolicy"|"hostedSubmit"|"hostedConfirm",args:string[])=>{
    live();await channel.call(op,args);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
  };
  return Object.freeze({
    ...composePostgresCreatorWithdrawalTransport(channel),
    async admitHostedTreasuryPolicy(value:HostedTreasuryPolicy,role:"public"|"private"){
      live();const p=validateHostedTreasuryPolicy(value,expected);if(!["public","private"].includes(role)||p.expiresAtSeconds<=Math.floor(Date.now()/1000))unavailable();
      const wire=canonicalJson(p),digest=hostedTreasuryPolicyDigest(p);if(Buffer.byteLength(wire)>4096)unavailable();
      await write("hostedPolicy",[wire,digest,role]);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();return digest;
    },
    async hostedTreasuryAccounting(signer:string,role?:"public"|"private"){
      live();address.parse(signer);if(role!==undefined&&!["public","private"].includes(role))unavailable();
      const value=await channel.call("hostedAccounting",[signer,role??null]);live();
      try{const totals=z.object({retainedMicroUsdc:micro,confirmedMicroUsdc:micro}).strict().parse(value);
        if(BigInt(totals.confirmedMicroUsdc)>BigInt(totals.retainedMicroUsdc))unavailable();return Object.freeze(totals);
      }catch{return unavailable();}
    },
    async submitHostedAuthorization(signer:string,value:Readonly<ServerX402Submission>,headerHash:string){
      live();address.parse(signer);nonce.parse(headerHash);
      const submission=z.object({authorizationId:nonce,authorizationExpiresAt:z.string().datetime(),payer:z.literal(signer),payee:address,
        amountMicros:micro,network:z.literal(ARC_MAINNET_PROFILE.networkId),asset:z.literal(ARC_MAINNET_PROFILE.usdcAddress.toLowerCase())}).strict().parse(value);
      const wire=canonicalJson(submission);if(Buffer.byteLength(wire)>2048)unavailable();
      await write("hostedSubmit",[signer,wire,headerHash]);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
    },
    async confirmHostedAuthorization(signer:string,id:string,transaction:string){
      live();address.parse(signer);nonce.parse(id);if(typeof transaction!=="string"||transaction.length<1||transaction.length>256||Buffer.byteLength(transaction)>256)unavailable();
      await write("hostedConfirm",[signer,id,transaction]);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
    },
  });
}

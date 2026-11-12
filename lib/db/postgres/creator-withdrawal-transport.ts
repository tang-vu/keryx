import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../../canonical-json";
import { validateWithdrawalRequest, withdrawalIdSchema, withdrawalOwnerSchema, type WithdrawalRequestRecord } from "../../gateway/withdrawal-request";
import { matchWithdrawalAttestation, type WithdrawalAttestation } from "../../gateway/withdrawal-attestation";
import { withdrawalHistoryCursorSchema, type WithdrawalHistoryCursor, type WithdrawalHistoryPage } from "../creator-withdrawal-history";
import type { WithdrawalTransferClaim } from "../creator-withdrawal-requests";
import type { SavedWithdrawalAttestation } from "../creator-withdrawal-attestations";
import type { StorageIdentity } from "../storage-identity";
import { PostgresStorageUnavailable, type PostgresConnectionOptions } from "./connection";
import { createPostgresDomainChannel, PostgresDomainWriteOutcomeUnknown, type PostgresDomainChannel } from "./domain-channel";
import { composePostgresWithdrawalTransport, type PostgresWithdrawalTransport } from "./withdrawal-transport";

export interface PostgresCreatorWithdrawalTransport extends PostgresWithdrawalTransport {
  reserveCreatorWithdrawal(record: WithdrawalRequestRecord): Promise<WithdrawalRequestRecord>;
  getCreatorWithdrawal(id: string, owner: string): Promise<WithdrawalRequestRecord | null>;
  listCreatorWithdrawalHistory(owner: string, cursor?: WithdrawalHistoryCursor, limit?: number): Promise<WithdrawalHistoryPage>;
  claimCreatorWithdrawalTransfer(id: string, owner: string): Promise<WithdrawalTransferClaim | null>;
  getCreatorWithdrawalTransferClaim(id: string, owner: string): Promise<WithdrawalTransferClaim | null>;
  saveCreatorWithdrawalAttestation(id: string, owner: string, claimId: string, value: unknown): Promise<SavedWithdrawalAttestation>;
  getCreatorWithdrawalAttestation(id: string, owner: string): Promise<SavedWithdrawalAttestation | null>;
}
const time=z.string().max(40).datetime({offset:true});
const claimSchema=z.object({claimId:z.string().uuid(),startedAt:time}).strict();
const attestationRow=z.object({claim_id:z.string().uuid(),transfer_id:z.string().uuid(),data:z.unknown(),saved_at:time}).strict();
function unavailable():never{throw new PostgresStorageUnavailable();}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))unavailable();return v as Record<string,unknown>;}
function wire(v:unknown){const s=canonicalJson(v);if(Buffer.byteLength(s)>8192)unavailable();return s;}

/** Original/claim composition only. No selected application provenance, initial
 * provider transfer, new funding, attester authority or mint finality is granted. */
export function createPostgresCreatorWithdrawalTransport(options:PostgresConnectionOptions,identity:StorageIdentity,digest:string):PostgresCreatorWithdrawalTransport{
  return composePostgresCreatorWithdrawalTransport(createPostgresDomainChannel(options,identity,digest));
}
export function composePostgresCreatorWithdrawalTransport(channel:PostgresDomainChannel):PostgresCreatorWithdrawalTransport{
  const live=()=>{if(channel.closed)unavailable();};
  const key=(id:string,owner:string)=>{live();return{id:withdrawalIdSchema.parse(id),owner:withdrawalOwnerSchema.parse(owner)};};
  const record=async(value:unknown,id?:string,owner?:string)=>{
    const r=await validateWithdrawalRequest(value);live();
    if(r.network!=="eip155:5042"||r.format!=="creator-withdrawal-request-v2"||(id!==undefined&&r.id!==id)||(owner!==undefined&&r.owner!==owner))unavailable();return r;
  };
  const attestation=async(value:unknown,r:WithdrawalRequestRecord,claim:WithdrawalTransferClaim|null)=>{
    const row=attestationRow.parse(value);if(!claim||row.claim_id!==claim.claimId)unavailable();
    const matched=await matchWithdrawalAttestation(r,row.data);live();const raw=object(row.data);
    if(matched.transferId!==row.transfer_id||canonicalJson(raw)!==canonicalJson(matched))unavailable();return{...matched,savedAt:row.saved_at};
  };
  const read=async(id:string,owner:string)=>{
    const k=key(id,owner),response=await channel.call("creatorRead",[k.id,k.owner]);live();if(response===null)return null;
    try{
      const s=object(response);if(Object.keys(s).sort().join(",")!=="attestation,claim,createdAt,record")unavailable();time.parse(s.createdAt);
      const r=await record(s.record,k.id,k.owner);live();const claim=s.claim===null?null:claimSchema.parse(s.claim);
      const proof=s.attestation===null?null:await attestation(s.attestation,r,claim);live();return{record:r,claim,attestation:proof};
    }catch{return unavailable();}
  };
  const knownWrite=async(operation:"creatorReserve"|"creatorClaim"|"creatorAttestation",args:string[])=>{
    live();const result=await channel.call(operation,args);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();return result;
  };
  return Object.freeze({
    ...composePostgresWithdrawalTransport(channel),
    async reserveCreatorWithdrawal(value:WithdrawalRequestRecord){
      live();const r=await record(value);live();await knownWrite("creatorReserve",[wire(r)]);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();return r;
    },
    async getCreatorWithdrawal(id:string,owner:string){const r=await read(id,owner);live();return r?.record??null;},
    async getCreatorWithdrawalTransferClaim(id:string,owner:string){const r=await read(id,owner);live();return r?.claim??null;},
    async getCreatorWithdrawalAttestation(id:string,owner:string){const r=await read(id,owner);live();return r?.attestation??null;},
    async claimCreatorWithdrawalTransfer(id:string,owner:string){
      const r=await read(id,owner);live();if(!r)unavailable();const claimId=randomUUID();
      const result=await knownWrite("creatorClaim",[r.record.id,r.record.owner,wire(r.record),claimId]);
      try{if(channel.closed)unavailable();if(result===null)return null;const c=claimSchema.parse(result);if(c.claimId!==claimId)unavailable();return c;}
      catch{throw new PostgresDomainWriteOutcomeUnknown();}
    },
    async saveCreatorWithdrawalAttestation(id:string,owner:string,claimId:string,value:unknown){
      const proposed=structuredClone(value);z.string().uuid().parse(claimId);const r=await read(id,owner);live();if(!r||r.claim?.claimId!==claimId)unavailable();
      const matched:WithdrawalAttestation=await matchWithdrawalAttestation(r.record,proposed);live();
      const result=await knownWrite("creatorAttestation",[r.record.id,r.record.owner,wire(r.record),claimId,wire(matched)]);
      try{const saved=await attestation(result,r.record,r.claim);if(channel.closed||canonicalJson({...saved,savedAt:undefined})!==canonicalJson(matched))unavailable();return saved;}
      catch{throw new PostgresDomainWriteOutcomeUnknown();}
    },
    async listCreatorWithdrawalHistory(owner:string,cursor?:WithdrawalHistoryCursor,limit=25):Promise<WithdrawalHistoryPage>{
      live();const wallet=withdrawalOwnerSchema.parse(owner),before=cursor===undefined?undefined:withdrawalHistoryCursorSchema.parse(cursor);
      z.number().int().min(1).max(25).parse(limit);const result=await channel.call("creatorHistory",[wallet,before?.createdAt??null,before?.id??null,String(limit)]);live();
      if(!Array.isArray(result)||result.length>limit+1)unavailable();const entries:WithdrawalHistoryPage["requests"]=[],seen=new Set<string>();let previous:{createdAt:string;id:string}|undefined;
      try{for(const raw of result){const row=object(raw),createdAt=time.parse(row.created_at),id=withdrawalIdSchema.parse(row.id);
        if(Object.keys(row).sort().join(",")!=="created_at,data,id,owner"||row.owner!==wallet||seen.has(id)
          ||(previous&&(createdAt>previous.createdAt||(createdAt===previous.createdAt&&id>=previous.id)))
          ||(before&&(createdAt>before.createdAt||(createdAt===before.createdAt&&id>=before.id))))unavailable();
        const r=await record(typeof row.data==="string"?JSON.parse(row.data):row.data,id,wallet);live();seen.add(id);previous={createdAt,id};
        entries.push({id,owner:wallet,createdAt,amountMicros:r.request.burnIntent.spec.value,maxFeeMicros:r.request.burnIntent.maxFee,recipient:r.policy.recipient});
      }}catch{return unavailable();}
      const requests=entries.slice(0,limit),last=requests.at(-1);live();return{requests,nextCursor:entries.length>limit&&last?{createdAt:last.createdAt,id:last.id as WithdrawalHistoryCursor["id"]}:null};
    },
  });
}

import { canonicalJson } from "../../canonical-json";
import { validateStorageIdentity,type StorageIdentity } from "../storage-identity";
import { PostgresStorageUnavailable,type PostgresConnectionOptions } from "./connection";
import { createPostgresDomainChannel,type PostgresDomainChannel } from "./domain-channel";
import { APPLICATION_READ_OPERATIONS } from "./application-read-calls";
import { composePostgresOwnerWithdrawalTransport,type PostgresOwnerWithdrawalTransport } from "./owner-withdrawal-transport";

export type PostgresApplicationRead = keyof typeof APPLICATION_READ_OPERATIONS;
export interface PostgresApplicationReadTransport extends PostgresOwnerWithdrawalTransport {
  applicationRead(operation:PostgresApplicationRead,args:Readonly<Record<string,unknown>>):Promise<unknown>;
}
/** Closed read-domain composition, never installed application provenance. */
export function createPostgresApplicationReadTransport(options:PostgresConnectionOptions,identity:StorageIdentity,digest:string):PostgresApplicationReadTransport{
  const expected=validateStorageIdentity(identity);
  return composePostgresApplicationReadTransport(createPostgresDomainChannel(options,expected,digest),expected);
}
export function composePostgresApplicationReadTransport(channel:PostgresDomainChannel,identity:StorageIdentity):PostgresApplicationReadTransport{
  return Object.freeze({
    ...composePostgresOwnerWithdrawalTransport(channel,identity),
    async applicationRead(operation:PostgresApplicationRead,args:Readonly<Record<string,unknown>>){
      if(channel.closed||typeof operation!=="string"||!Object.hasOwn(APPLICATION_READ_OPERATIONS,operation)
        ||!args||typeof args!=="object"||Array.isArray(args))throw new PostgresStorageUnavailable();
      let wire:string;
      try{wire=canonicalJson(args);if(Buffer.byteLength(wire)>65536)throw new Error();}
      catch{throw new PostgresStorageUnavailable();}
      const result=await channel.call(APPLICATION_READ_OPERATIONS[operation],[wire]);
      if(channel.closed)throw new PostgresStorageUnavailable();
      return result;
    },
  });
}

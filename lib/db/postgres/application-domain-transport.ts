import { canonicalJson } from "../../canonical-json";
import { validateStorageIdentity,type StorageIdentity } from "../storage-identity";
import { PostgresStorageUnavailable,type PostgresConnectionOptions } from "./connection";
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from "./domain-channel";
import { AUTH_WRITE_OPERATIONS } from "./auth-write-calls";
import { composePostgresApplicationReadTransport,type PostgresApplicationReadTransport } from "./application-read-transport";

export type PostgresAuthWrite=keyof typeof AUTH_WRITE_OPERATIONS;
export interface PostgresApplicationDomainTransport extends PostgresApplicationReadTransport {
  applicationWrite(operation:PostgresAuthWrite,args:Readonly<Record<string,unknown>>):Promise<unknown>;
}
/** Qualified named ports only. It cannot select or enroll an application store. */
export function createPostgresApplicationDomainTransport(options:PostgresConnectionOptions,identity:StorageIdentity,digest:string):PostgresApplicationDomainTransport{
  const expected=validateStorageIdentity(identity);
  return composePostgresApplicationDomainTransport(createPostgresDomainChannel(options,expected,digest),expected);
}
export function composePostgresApplicationDomainTransport(channel:PostgresDomainChannel,identity:StorageIdentity):PostgresApplicationDomainTransport{
  return Object.freeze({
    ...composePostgresApplicationReadTransport(channel,identity),
    async applicationWrite(operation:PostgresAuthWrite,args:Readonly<Record<string,unknown>>){
      if(channel.closed||typeof operation!=="string"||!Object.hasOwn(AUTH_WRITE_OPERATIONS,operation)
        ||!args||typeof args!=="object"||Array.isArray(args))throw new PostgresStorageUnavailable();
      let wire:string;
      try{wire=canonicalJson(args);if(Buffer.byteLength(wire)>65536)throw new Error();}catch{throw new PostgresStorageUnavailable();}
      const value=await channel.call(AUTH_WRITE_OPERATIONS[operation],[wire]);
      if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
      return value;
    },
  });
}

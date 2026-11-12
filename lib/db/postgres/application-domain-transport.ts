import type { DashboardMetrics } from "../../types";
import { dashboardMetricsFromPostgresAggregate } from "./dashboard-aggregate";
import { canonicalJson } from "../../canonical-json";
import { validateStorageIdentity,type StorageIdentity } from "../storage-identity";
import { PostgresStorageUnavailable,type PostgresConnectionOptions } from "./connection";
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from "./domain-channel";
import { AUTH_WRITE_OPERATIONS } from "./auth-write-calls";
import { OPERATIONAL_WRITE_OPERATIONS } from "./operational-write-calls";
import { CONTENT_WRITE_OPERATIONS,CONTENT_WRITE_INPUT_BYTES } from './content-write-calls';
import { composePostgresApplicationReadTransport,type PostgresApplicationReadTransport } from "./application-read-transport";

export const BASE_APPLICATION_WRITE_OPERATIONS=Object.freeze({...AUTH_WRITE_OPERATIONS,...OPERATIONAL_WRITE_OPERATIONS});
export const APPLICATION_WRITE_OPERATIONS=Object.freeze({...BASE_APPLICATION_WRITE_OPERATIONS,...CONTENT_WRITE_OPERATIONS});

export type PostgresAuthWrite=keyof typeof AUTH_WRITE_OPERATIONS;
export type PostgresApplicationWrite=keyof typeof APPLICATION_WRITE_OPERATIONS;
export interface PostgresApplicationDomainTransport extends PostgresApplicationReadTransport {
  dashboardMetrics():Promise<DashboardMetrics>;
  applicationWrite(operation:PostgresApplicationWrite,args:Readonly<Record<string,unknown>>):Promise<unknown>;
}
/** Qualified named ports only. It cannot select or enroll an application store. */
export function createPostgresApplicationDomainTransport(options:PostgresConnectionOptions,identity:StorageIdentity,digest:string):PostgresApplicationDomainTransport{
  const expected=validateStorageIdentity(identity);
  return composePostgresApplicationDomainTransport(createPostgresDomainChannel(options,expected,digest),expected);
}
export function composePostgresApplicationDomainTransport(channel:PostgresDomainChannel,identity:StorageIdentity):PostgresApplicationDomainTransport{
  return Object.freeze({
    ...composePostgresApplicationReadTransport(channel,identity),
    async dashboardMetrics(){
      if(channel.closed)throw new PostgresStorageUnavailable();
      const value=await channel.call("dashboardMetrics",[]);
      if(channel.closed)throw new PostgresStorageUnavailable();
      return dashboardMetricsFromPostgresAggregate(value);
    },
    async applicationWrite(operation:PostgresApplicationWrite,args:Readonly<Record<string,unknown>>){
      if(channel.closed||typeof operation!=="string"||!Object.hasOwn(APPLICATION_WRITE_OPERATIONS,operation)
        ||!args||typeof args!=="object"||Array.isArray(args))throw new PostgresStorageUnavailable();
      let wire:string;
      const limit=Object.hasOwn(CONTENT_WRITE_INPUT_BYTES,operation)?CONTENT_WRITE_INPUT_BYTES[operation as keyof typeof CONTENT_WRITE_INPUT_BYTES]:65536;
      try{wire=canonicalJson(args);if(Buffer.byteLength(wire)>limit)throw new Error();}catch{throw new PostgresStorageUnavailable();}
      const value=await channel.call(APPLICATION_WRITE_OPERATIONS[operation],[wire]);
      if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
      return value;
    },
  });
}

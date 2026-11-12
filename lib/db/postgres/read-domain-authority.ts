import type { StorageDomainAuthority } from "../supabase-authority";
import { storageDomainClient } from "../supabase-authority";
import { APPLICATION_READ_OPERATIONS } from "./application-read-calls";
import type { PostgresApplicationRead,PostgresApplicationReadTransport } from "./application-read-transport";
import { PostgresStorageUnavailable } from "./connection";

/** Reuses existing domain decoders through a checked RPC-only port. No SDK,
 * ordinary fallback, target discovery, configuration or installed provenance. */
export function createPostgresReadDomainAuthority(transport:PostgresApplicationReadTransport):StorageDomainAuthority&{domainClient():ReturnType<typeof storageDomainClient>} {
  const authority:StorageDomainAuthority={
    async rpcResult(name:string,args:Record<string,unknown>={}){
      if(typeof name!=="string"||!Object.hasOwn(APPLICATION_READ_OPERATIONS,name))throw new PostgresStorageUnavailable();
      // Failures throw so a legacy decoder cannot turn a transport refusal into
      // a null/empty success by ignoring an error envelope.
      const data=await transport.applicationRead(name as PostgresApplicationRead,args);
      return {data,error:null};
    },
  };
  return Object.freeze({...authority,domainClient:()=>storageDomainClient(authority)});
}

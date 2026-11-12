import { storageDomainClient,type StorageDomainAuthority } from "../supabase-authority";
import { createPostgresReadDomainAuthority } from "./read-domain-authority";
import { AUTH_WRITE_OPERATIONS } from "./auth-write-calls";
import type { PostgresApplicationDomainTransport,PostgresAuthWrite } from "./application-domain-transport";

/** Named native RPC bridge, never a Supabase client/config or installed proof. */
export function createPostgresApplicationDomainAuthority(transport:PostgresApplicationDomainTransport):StorageDomainAuthority&{domainClient():ReturnType<typeof storageDomainClient>} {
  const read=createPostgresReadDomainAuthority(transport);
  const authority:StorageDomainAuthority={
    async rpcResult(name:string,args:Record<string,unknown>={}){
      if(Object.hasOwn(AUTH_WRITE_OPERATIONS,name))return {data:await transport.applicationWrite(name as PostgresAuthWrite,args),error:null};
      return await read.rpcResult(name,args);
    },
  };
  return Object.freeze({...authority,domainClient:()=>storageDomainClient(authority)});
}

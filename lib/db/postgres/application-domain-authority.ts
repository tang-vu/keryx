import { storageDomainClient,type StorageDomainAuthority } from "../supabase-authority";
import { createPostgresReadDomainAuthority } from "./read-domain-authority";
import { APPLICATION_WRITE_OPERATIONS } from "./application-domain-transport";
import type { PostgresApplicationDomainTransport,PostgresApplicationWrite } from "./application-domain-transport";

/** Named native RPC bridge, never a Supabase client/config or installed proof. */
export function createPostgresApplicationDomainAuthority(transport:PostgresApplicationDomainTransport):StorageDomainAuthority&{domainClient():ReturnType<typeof storageDomainClient>} {
  const read=createPostgresReadDomainAuthority(transport);
  const authority:StorageDomainAuthority={
    async rpcResult(name:string,args:Record<string,unknown>={}){
      if(Object.hasOwn(APPLICATION_WRITE_OPERATIONS,name))return {data:await transport.applicationWrite(name as PostgresApplicationWrite,args),error:null};
      return await read.rpcResult(name,args);
    },
  };
  return Object.freeze({...authority,domainClient:()=>storageDomainClient(authority)});
}

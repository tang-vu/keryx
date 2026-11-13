import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { validateStorageIdentity,type StorageIdentity } from '../storage-identity';
import { PostgresStorageUnavailable,type PostgresConnectionOptions } from './connection';
import { createPostgresDomainChannel,type PostgresDomainChannel } from './domain-channel';
import { composePostgresUserDomainTransport,type PostgresUserDomainTransport } from './user-domain-transport';
import { composePostgresHealth,type PostgresHealthTransport } from './health-transport';
import { composePostgresUsage,type PostgresUsageTransport } from './usage-transport';
import { composePostgresPublicLedger,type PostgresPublicLedgerTransport } from './ledger-transport';
import { composePostgresAcceptance } from './acceptance-transport';
import type { DeliverableAcceptanceStore } from '../../deliverable-acceptance/contracts';
import type { AccountMembershipStore } from '../../accounts/contracts';
import { composePostgresAccounts } from './accounts-transport';
const cacheRow=z.object({sourceId:z.string().min(1).max(256),text:z.string().max(2097152)}).strict();
export interface NativeColdCacheSnapshot {readonly cacheRows:readonly Readonly<{sourceId:string;text:string}>[];readonly cacheRowCount:number;readonly cacheWireBytes:number;}
export interface PostgresRuntimeTransport extends PostgresUserDomainTransport,PostgresHealthTransport,PostgresUsageTransport,PostgresPublicLedgerTransport {readonly deliverableAcceptance:DeliverableAcceptanceStore;readonly accountMembership:AccountMembershipStore;verifyRuntimeAuthority():Promise<void>;readColdCache():Promise<NativeColdCacheSnapshot>;}
/** Actual fixed reads on one native pool. This transport cannot enroll a facade. */
export function createPostgresRuntimeTransport(options:PostgresConnectionOptions,identity:StorageIdentity,digest:string,claimsEnabled=false,privacyActive=false):PostgresRuntimeTransport {
 const expected=validateStorageIdentity(identity);return composePostgresRuntimeTransport(createPostgresDomainChannel(options,expected,digest),expected,digest,options.role!=='keryx_app',claimsEnabled,privacyActive);
}
export function composePostgresRuntimeTransport(channel:PostgresDomainChannel,identity:StorageIdentity,digest:string,readOnly:boolean,claimsEnabled=false,privacyActive=false):PostgresRuntimeTransport {
 const expected=validateStorageIdentity(identity),wire=canonicalJson(expected),unavailable=()=>new PostgresStorageUnavailable(),live=()=>{if(channel.closed)throw unavailable();};
 if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||typeof readOnly!=='boolean')throw unavailable();
 const authority=z.object({identity:z.unknown(),sourceDigest:z.literal(digest)}).strict();
 const cold=authority.extend({format:z.literal('keryx-native-storage-cold-read-v1'),cacheRows:z.array(cacheRow).max(512),cacheRowCount:z.number().int().min(0).max(512),cacheWireBytes:z.number().int().min(0).max(8388608)}).strict();
 return Object.freeze({
  ...composePostgresUserDomainTransport(channel,expected,readOnly,claimsEnabled),
  ...composePostgresHealth(channel),
  ...composePostgresUsage(channel,privacyActive),
  ...composePostgresPublicLedger(channel,privacyActive),
  deliverableAcceptance:composePostgresAcceptance(channel,readOnly),
  accountMembership:composePostgresAccounts(channel,readOnly),
  async verifyRuntimeAuthority(){
   live();try{const value=authority.parse(await channel.call('nativeRuntimeAuthority',[]));live();if(canonicalJson(validateStorageIdentity(value.identity))!==wire)throw unavailable();}
   catch{throw unavailable();}
  },
  async readColdCache(){
   live();try{
    const value=cold.parse(await channel.call('nativeRuntimeColdRead',[]));live();if(canonicalJson(validateStorageIdentity(value.identity))!==wire)throw unavailable();
    let bytes=0;const names=new Set<string>();
    for(const row of value.cacheRows){bytes+=Buffer.byteLength(row.text);if(bytes>8388608||Buffer.byteLength(row.sourceId)>512||Buffer.byteLength(row.text)>2097152||names.has(row.sourceId))throw unavailable();names.add(row.sourceId);}
    if(value.cacheRowCount!==value.cacheRows.length||value.cacheWireBytes!==bytes)throw unavailable();
    return Object.freeze({cacheRows:Object.freeze(value.cacheRows.map(row=>Object.freeze(row))),cacheRowCount:value.cacheRowCount,cacheWireBytes:value.cacheWireBytes});
   }catch{throw unavailable();}
  },
 });
}

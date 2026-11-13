import { z } from 'zod';
import { summarizeA2aOperations,type A2aOperationsSnapshot,type A2aOperationsRow } from '../../a2a/operations';
import { publicHealthSyncKeys,type PublicHealthSnapshot } from '../public-health-snapshot';
import { dashboardMetricsFromPostgresAggregate } from './dashboard-aggregate';
import { PostgresStorageUnavailable } from './connection';
import type { PostgresDomainChannel } from './domain-channel';
const unavailable=()=>new PostgresStorageUnavailable();
const stateEntries=z.object({entries:z.array(z.object({keyHex:z.string().max(2048),valueHex:z.string().max(8388608).nullable()}).strict()).max(32)}).strict();
const jobRow=z.object({status:z.enum(['running','completed','failed']),createdAt:z.string().max(64),updatedAt:z.string().max(64),startedAt:z.string().max(64).nullable(),executionJournalVersion:z.unknown(),researchPackage:z.unknown(),serviceReceipt:z.unknown(),resolution:z.unknown()}).strict();
const jobRows=z.array(jobRow).max(1000);
function fromHex(value:string){if(value.length%2||/[^a-f0-9]/.test(value))throw unavailable();return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(value,'hex'));}
function captureKeys(raw:readonly string[]){
 if(!Array.isArray(raw)||raw.length>32||raw.some(key=>typeof key!=='string'||key.length<1||key.length>256||new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(key))!==key))throw unavailable();
 return [...new Set(raw)];
}
function states(raw:unknown,keys:readonly string[]):ReadonlyMap<string,string|null>{
 const rows=stateEntries.parse(raw).entries,expected=keys.map(key=>Buffer.from(key).toString('hex'));if(rows.length!==expected.length)throw unavailable();let bytes=0;
 const result=new Map<string,string|null>();for(let i=0;i<rows.length;i++){const row=rows[i];if(row.keyHex!==expected[i])throw unavailable();const value=row.valueHex===null?null:fromHex(row.valueHex);bytes+=value===null?0:Buffer.byteLength(value);if(bytes>4194304)throw unavailable();result.set(keys[i],value);}return result;
}
function since(now:number){if(!Number.isSafeInteger(now)||now< -8640000000000000+86400000||now>8640000000000000)throw unavailable();return new Date(now-86400000).toISOString();}
function jobs(raw:unknown,now:number):A2aOperationsSnapshot{
 const rows:A2aOperationsRow[]=jobRows.parse(raw).map(row=>{if(['executionJournalVersion','researchPackage','serviceReceipt','resolution'].some(key=>!Object.hasOwn(row,key)))throw unavailable();return {...row,researchPackage:row.researchPackage??undefined,serviceReceipt:row.serviceReceipt??undefined};});
 return summarizeA2aOperations(rows,now,true);
}
export interface PostgresHealthTransport {
 getSyncStates(keys:readonly string[]):Promise<ReadonlyMap<string,string|null>>;
 readPublicHealthSnapshot(nowMs:number,includeRegistry:boolean):Promise<PublicHealthSnapshot>;
 currentA2aOperationsSnapshot(nowMs:number):Promise<A2aOperationsSnapshot>;
}
/** One current protected observation; no construction or installed provenance. */
export function composePostgresHealth(channel:PostgresDomainChannel):PostgresHealthTransport{
 const live=()=>{if(channel.closed)throw unavailable();};
 return Object.freeze({
  async getSyncStates(raw){try{live();const keys=captureKeys(raw),wire=JSON.stringify(keys.map(key=>Buffer.from(key).toString('hex'))),result=await channel.call('syncStateBatch',[wire]);live();return states(result,keys);}catch{throw unavailable();}},
  async readPublicHealthSnapshot(nowMs,includeRegistry){
   try{live();const after=since(nowMs);if(typeof includeRegistry!=='boolean')throw unavailable();const keys=publicHealthSyncKeys(includeRegistry);
    const result=await channel.call('publicHealthSnapshot',[after,String(includeRegistry)]);live();const parsed=z.object({format:z.literal('keryx-native-public-health-v1'),metrics:z.unknown(),jobs:z.unknown(),sync:z.unknown()}).strict().parse(result);
    return {metrics:dashboardMetricsFromPostgresAggregate(parsed.metrics),jobs:jobs(parsed.jobs,nowMs),syncState:states(parsed.sync,keys)};
   }catch{throw unavailable();}
  },
  async currentA2aOperationsSnapshot(nowMs){try{live();const after=since(nowMs),result=await channel.call('currentJobSnapshot',[after]);live();return jobs(z.object({rows:z.unknown()}).strict().parse(result).rows,nowMs);}catch{throw unavailable();}},
 } satisfies PostgresHealthTransport);
}

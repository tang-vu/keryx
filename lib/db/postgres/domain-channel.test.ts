import {beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity} from '../storage-identity';
const state=vi.hoisted(()=>({query:vi.fn(),end:vi.fn(),release:vi.fn()}));
vi.mock('pg',()=>({Pool:class{
 query(...args:unknown[]){return state.query(...args);}
 async connect(){return {query:(...args:unknown[])=>state.query(...args),release:state.release};}
 end(){return state.end();}on(){}
},types:{getTypeParser:()=>(s:string)=>s}}));
import {createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown} from './domain-channel';
import {PostgresStorageBusy,PostgresStorageUnavailable} from './connection';
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const options={endpoint:{kind:'loopback' as const,port:5432},database:'synthetic',role:'keryx_app',password:'synthetic-not-a-live-secret'};
const reply={rows:[[null]],fields:[{name:'result',dataTypeID:3802}]};
const failure=(code:string)=>Object.assign(Error('private database details'),{code});
beforeEach(()=>{vi.clearAllMocks();state.query.mockReset();state.end.mockResolvedValue(undefined);state.query.mockResolvedValue(reply);});
it('keeps a recognized read lock failure nonterminal without retry or leaked details',async()=>{
 const c=createPostgresDomainChannel(options,identity,'22'.repeat(32));
 state.query.mockResolvedValueOnce(reply).mockRejectedValueOnce(failure('55P03'));
 await expect(c.call('privateProfileGet',['0x'+'a1'.repeat(20),identity.network])).rejects.toThrow(PostgresStorageBusy);
 expect(c.closed).toBe(false);expect(state.query).toHaveBeenCalledTimes(2);expect(state.release).toHaveBeenLastCalledWith(true);
 await expect(c.call('privateProfileGet',['0x'+'a1'.repeat(20),identity.network])).resolves.toBeNull();
 expect(state.query).toHaveBeenCalledTimes(5);expect(state.release).toHaveBeenLastCalledWith(false);await c.close();
});
it.each(['57014','XX000','P0001'])('redacts an unclassified read failure %s',async code=>{
 const c=createPostgresDomainChannel(options,identity,'22'.repeat(32));state.query.mockRejectedValueOnce(failure(code));
 await expect(c.call('privateProfileGet',['0x'+'a1'.repeat(20),identity.network])).rejects.toThrow(/^PostgreSQL storage unavailable$/);
 expect(state.query).toHaveBeenCalledTimes(1);await c.close();
});
it('retains unknown outcome for a submitted write even on lock SQLSTATE',async()=>{
 const c=createPostgresDomainChannel(options,identity,'22'.repeat(32));state.query.mockRejectedValueOnce(failure('55P03'));
 await expect(c.call('privateProfileDelete',['0x'+'a1'.repeat(20)])).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);
 expect(state.query).toHaveBeenCalledTimes(1);await c.close();
});
it('keeps a closed read terminal when its delayed failure resembles contention',async()=>{
 const c=createPostgresDomainChannel(options,identity,'22'.repeat(32));let reject!:(error:Error)=>void;
 state.query.mockReturnValueOnce(new Promise((_,fail)=>{reject=fail;}));
 const pending=c.call('privateProfileGet',['0x'+'a1'.repeat(20),identity.network]),refused=expect(pending).rejects.toThrow(PostgresStorageUnavailable);
 await Promise.resolve();expect(state.query).toHaveBeenCalledTimes(1);const closing=c.close();
 reject(failure('55P03'));await refused;await closing;expect(c.closed).toBe(true);expect(state.query).toHaveBeenCalledTimes(1);
});

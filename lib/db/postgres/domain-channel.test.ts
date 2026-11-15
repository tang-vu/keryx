import {beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity} from '../storage-identity';
import {canonicalJson} from '../../canonical-json';
import {composePostgresOnramp} from './onramp-transport';
import {onrampWireSha256} from './onramp-packet';
const state=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),end:vi.fn(),release:vi.fn()}));
vi.mock('pg',()=>({Pool:class{
 query(...args:unknown[]){return state.query(...args);}
 connect(){return state.connect();}
 end(){return state.end();}on(){}
},types:{getTypeParser:()=>(s:string)=>s}}));
import {createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown} from './domain-channel';
import {PostgresStorageBusy,PostgresStorageUnavailable} from './connection';
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const options={endpoint:{kind:'loopback' as const,port:5432},database:'synthetic',role:'keryx_app',password:'synthetic-not-a-live-secret'};
const reply={rows:[[null]],fields:[{name:'result',dataTypeID:3802}]};
const failure=(code:string)=>Object.assign(Error('private database details'),{code});
const client={query:(...args:unknown[])=>state.query(...args),release:state.release};
beforeEach(()=>{vi.clearAllMocks();state.query.mockReset();state.connect.mockReset();state.connect.mockResolvedValue(client);state.end.mockResolvedValue(undefined);state.query.mockResolvedValue(reply);});
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

it.each([false,true])('checks selection after queued acquisition before any SQL (write=%s)',async write=>{
 let selected=canonicalJson(identity),acquire!:(value:typeof client)=>void;
 const captured=selected,guard=vi.fn(()=>{if(selected!==captured)throw Error('private changed manifest');});
 state.connect.mockReturnValueOnce(new Promise(resolve=>{acquire=resolve;}));
 const c=createPostgresDomainChannel(options,identity,'22'.repeat(32),guard);
 const work=write?c.call('privateProfileDelete',['0x'+'a1'.repeat(20)]):c.call('privateProfileGet',['0x'+'a1'.repeat(20),identity.network]);
 const denied=expect(work).rejects.toThrow(/^PostgreSQL storage unavailable$/);
 selected=canonicalJson({...identity,storageId:randomUUID()});acquire(client);await denied;
 expect(state.query).not.toHaveBeenCalled();expect(state.release).toHaveBeenCalledWith(true);expect(guard).toHaveBeenCalledTimes(2);await c.close();
});
it('checks current context after BEGIN and refuses without executing the read or COMMIT',async()=>{
 let live=true,begin!:(value:typeof reply)=>void;
 const c=createPostgresDomainChannel(options,identity,'22'.repeat(32),()=>{if(!live)throw Error('secret credential changed');});
 state.query.mockReturnValueOnce(new Promise(resolve=>{begin=resolve;}));
 const pending=c.call('privateProfileGet',['0x'+'a1'.repeat(20),identity.network]),denied=expect(pending).rejects.toThrow(/^PostgreSQL storage unavailable$/);
 await Promise.resolve();expect(state.query).toHaveBeenCalledExactlyOnceWith('BEGIN READ ONLY');live=false;begin(reply);await denied;
 expect(state.query).toHaveBeenCalledTimes(1);expect(state.release).toHaveBeenCalledWith(true);await c.close();
});
it('rechecks a changed full manifest between a genuine typed frame and apply',async()=>{
 let selected=canonicalJson(identity);const captured=selected;
 const c=createPostgresDomainChannel(options,identity,'22'.repeat(32),()=>{if(selected!==captured)throw Error('selected manifest changed');});
 state.query.mockImplementation(async(statement:unknown)=>{
  if(typeof statement==='string')return reply;
  const sql=statement as {text:string;values:string[]};expect(sql.text).toContain("'onramp_frame'");
  const capture=JSON.parse(sql.values[2]).capture;
  const wire=JSON.stringify({format:'source-onramp-frame-v1',identityDigest:'33'.repeat(32),capture,addressHex:Buffer.from(JSON.parse(capture.addressKeyWire)).toString('hex'),dayHex:Buffer.from(JSON.parse(capture.dayKeyWire)).toString('hex'),claimed:false,address:null,day:null});
  return {rows:[[JSON.stringify({wire,sha256:onrampWireSha256(wire)})]],fields:reply.fields};
 });
 // This recording wrapper changes the selected Source only AFTER the complete
 // real channel frame. It is neither a native facade nor a proof issuer.
 const port=composePostgresOnramp({get closed(){return c.closed;},close:()=>c.close(),async call(operation,args){const value=await c.call(operation,args);if(operation==='onrampFrame')selected=canonicalJson({...identity,enrollmentId:randomUUID()});return value;}},false);
 await expect(port.reserveOnramp('synthetic-address','synthetic-day',1,2,0)).rejects.toThrow(PostgresStorageUnavailable);
 expect(state.query).toHaveBeenCalledTimes(3);expect(state.connect).toHaveBeenCalledTimes(1);await c.close();
});
it('classifies current-context loss after the submitted write as unknown, without retry',async()=>{
 let live=true;const c=createPostgresDomainChannel(options,identity,'22'.repeat(32),()=>{if(!live)throw Error('private role revoked');});
 state.query.mockImplementationOnce(async()=>{live=false;return reply;});
 await expect(c.call('privateProfileDelete',['0x'+'a1'.repeat(20)])).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);
 expect(state.connect).toHaveBeenCalledOnce();expect(state.query).toHaveBeenCalledOnce();await c.close();
});
it('checks context after COMMIT before returning a read',async()=>{
 let live=true;const c=createPostgresDomainChannel(options,identity,'22'.repeat(32),()=>{if(!live)throw Error('late key changed');});
 state.query.mockImplementation(async statement=>{if(statement==='COMMIT')live=false;return reply;});
 await expect(c.call('privateProfileGet',['0x'+'a1'.repeat(20),identity.network])).rejects.toThrow(PostgresStorageUnavailable);
 expect(state.query).toHaveBeenCalledTimes(3);expect(state.release).toHaveBeenCalledWith(true);await c.close();
});
it('makes close terminal immediately and drains an admitted client acquisition',async()=>{
 let acquire!:(value:typeof client)=>void;state.connect.mockReturnValueOnce(new Promise(resolve=>{acquire=resolve;}));
 const c=createPostgresDomainChannel(options,identity,'22'.repeat(32)),pending=c.call('privateProfileDelete',['0x'+'a1'.repeat(20)]);
 const denied=expect(pending).rejects.toThrow(PostgresStorageUnavailable),closing=c.close();expect(c.closed).toBe(true);expect(c.close()).toBe(closing);
 expect(state.end).not.toHaveBeenCalled();await expect(c.call('privateProfileDelete',['0x'+'a1'.repeat(20)])).rejects.toThrow(PostgresStorageUnavailable);
 acquire(client);await denied;await closing;expect(state.query).not.toHaveBeenCalled();expect(state.release).toHaveBeenCalledWith(true);expect(state.end).toHaveBeenCalledOnce();
});
it('keeps an acquired write closed as unknown after submission and drains it',async()=>{
 let finish!:(value:typeof reply)=>void;state.query.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
 const c=createPostgresDomainChannel(options,identity,'22'.repeat(32)),pending=c.call('privateProfileDelete',['0x'+'a1'.repeat(20)]),denied=expect(pending).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);
 await Promise.resolve();const closing=c.close();expect(state.end).not.toHaveBeenCalled();finish(reply);await denied;await closing;
 expect(state.query).toHaveBeenCalledOnce();expect(state.end).toHaveBeenCalledOnce();
});
it.each([()=>true,async()=>{}])('does not accept a callback result as admission',async guard=>{
 const c=createPostgresDomainChannel(options,identity,'22'.repeat(32),guard);
 await expect(c.call('privateProfileDelete',['0x'+'a1'.repeat(20)])).rejects.toThrow(PostgresStorageUnavailable);
 expect(state.connect).not.toHaveBeenCalled();expect(state.query).not.toHaveBeenCalled();await c.close();
});
it('does not classify a failed write acquisition as a submitted statement',async()=>{
 state.connect.mockRejectedValueOnce(failure('53300'));
 const c=createPostgresDomainChannel(options,identity,'22'.repeat(32));
 await expect(c.call('privateProfileDelete',['0x'+'a1'.repeat(20)])).rejects.toThrow(/^PostgreSQL storage unavailable$/);
 expect(state.query).not.toHaveBeenCalled();expect(state.release).not.toHaveBeenCalled();expect(state.connect).toHaveBeenCalledOnce();await c.close();
});

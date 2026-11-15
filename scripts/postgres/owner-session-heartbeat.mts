/** Liveness for exactly the two already-owned operator sessions. No connection,
 * transaction, target, runtime identity or authority is created here. */
import assert from 'node:assert/strict';
import type { Client } from 'pg';

export class OwnerSessionHeartbeatUnavailable extends Error {
 readonly cause:unknown;readonly code:string|undefined;
 constructor(readonly failures:readonly unknown[]){super('Owned session heartbeat unavailable');this.cause=failures[0];const code=this.cause&&typeof this.cause==='object'?Reflect.get(this.cause,'code'):undefined;this.code=typeof code==='string'?code:undefined;}
}
export function createOwnerSessionHeartbeat(clients:readonly Client[]){
 assert.equal(clients.length,2);assert.notEqual(clients[0],clients[1]);
 const sessions=clients.map(client=>{const query=client.query,on=client.on,removeListener=client.removeListener;for(const method of [query,on,removeListener])assert.equal(typeof method,'function');return {client,query,on,removeListener,paused:false,failed:false,attached:false,listener:undefined as ((error:unknown)=>void)|undefined,pending:undefined as Promise<void>|undefined};});
 const failures:unknown[]=[],seen=new Set<unknown>();let timer:ReturnType<typeof setInterval>|undefined,started=false,stopped=false;
 const record=(state:typeof sessions[number],error:unknown)=>{state.failed=true;if(!seen.has(error)){seen.add(error);failures.push(error);}};
 try{for(const state of sessions){state.listener=error=>record(state,error);Reflect.apply(state.on,state.client,['error',state.listener]);state.attached=true;}}
 catch(error){const errors=[error];for(const state of sessions)if(state.attached)try{Reflect.apply(state.removeListener,state.client,['error',state.listener]);state.attached=false;}catch(cleanup){errors.push(cleanup);}throw new OwnerSessionHeartbeatUnavailable(Object.freeze(errors));}
 const failure=()=>failures.length?new OwnerSessionHeartbeatUnavailable(Object.freeze([...failures])):undefined;
 const check=()=>{const error=failure();if(error)throw error;};
 const owned=(client:Client)=>{const state=sessions.find(s=>s.client===client);assert(state,'Session was not captured');return state;};
 const pulse=()=>{if(stopped)return;for(const state of sessions){if(state.paused||state.pending||state.failed)continue;
  state.pending=Promise.resolve().then(()=>Reflect.apply(state.query,state.client,['SELECT 1'])).then(()=>{},error=>{record(state,error);}).finally(()=>{state.pending=undefined;});
 }};
 return Object.freeze({
  get failure(){return failure();},
  start(){assert(!started&&!stopped);started=true;timer=setInterval(pulse,1000);},
  async pauseAndDrain(client:Client){assert(started&&!stopped);const state=owned(client);state.paused=true;await state.pending;check();},
  resume(client:Client){assert(started&&!stopped);check();owned(client).paused=false;},
  async stopAndDrain(){stopped=true;if(timer){clearInterval(timer);timer=undefined;}for(const state of sessions)state.paused=true;await Promise.allSettled(sessions.flatMap(s=>s.pending?[s.pending]:[]));for(const state of sessions)if(state.attached)try{Reflect.apply(state.removeListener,state.client,['error',state.listener]);state.attached=false;}catch(error){record(state,error);}check();},
 });
}

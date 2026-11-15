/** Real helper / mechanical driver controls only: no PG or runtime authority. */
import type { Client } from 'pg';
import { afterEach,expect,it,vi } from 'vitest';
import { createOwnerSessionHeartbeat,OwnerSessionHeartbeatUnavailable } from './owner-session-heartbeat.mts';
const session=(query:()=>Promise<unknown>)=>({query} as unknown as Client);
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(done=>{release=done;});return {promise,release};};
afterEach(()=>vi.useRealTimers());

it('keeps an idle sibling alive on real one-second cadence while a target probe is stalled',async()=>{
 const held=gate();let source=0,target=0;let first!:()=>void;const started=new Promise<void>(done=>{first=done;});
 const a=session(async()=>{source++;first();}),b=session(async()=>{target++;await held.promise;});const heartbeat=createOwnerSessionHeartbeat([a,b]);
 try{heartbeat.start();await started;await new Promise(done=>setTimeout(done,2200));expect(source).toBeGreaterThanOrEqual(3);expect(target).toBe(1);}
 finally{held.release();await heartbeat.stopAndDrain();}
});
it('does not overlap a client, and drains only the transitioning client while its sibling continues',async()=>{
 vi.useFakeTimers();const held=gate();let source=0,target=0;const a=session(async()=>{source++;}),b=session(async()=>{target++;await held.promise;});const h=createOwnerSessionHeartbeat([a,b]);h.start();
 try{
  await vi.advanceTimersByTimeAsync(1000);let drained=false;const pause=h.pauseAndDrain(b).then(()=>{drained=true;});await vi.advanceTimersByTimeAsync(3000);expect(drained).toBe(false);expect(target).toBe(1);expect(source).toBe(4);
  held.release();await pause;expect(drained).toBe(true);await vi.advanceTimersByTimeAsync(1000);expect(target).toBe(1);expect(source).toBe(5);h.resume(b);await vi.advanceTimersByTimeAsync(1000);expect(target).toBe(2);
 }finally{held.release();await h.stopAndDrain();}
});
it('captures clients and methods once and refuses an uncaptured client or reuse after disposal',async()=>{
 vi.useFakeTimers();let calls=0;const a=session(async()=>{calls++;}),b=session(async()=>{}),list=[a,b];const h=createOwnerSessionHeartbeat(list);list.splice(0,2);a.query=(()=>{throw Error('replacement must not run');}) as Client['query'];h.start();await vi.advanceTimersByTimeAsync(1000);expect(calls).toBe(1);await expect(h.pauseAndDrain(session(async()=>{}))).rejects.toThrow('not captured');await h.stopAndDrain();expect(()=>h.resume(a)).toThrow();expect(()=>h.start()).toThrow();await vi.advanceTimersByTimeAsync(3000);expect(calls).toBe(1);
});
it('retains every failed probe and the actual first PG code while draining all owned work',async()=>{
 vi.useFakeTimers();const one=Object.assign(new Error('private driver detail'),{code:'08006'}),two=Object.assign(new Error('second detail'),{code:'57P01'});const held=gate();const a=session(async()=>{await held.promise;throw one;}),b=session(async()=>{await held.promise;throw two;});const h=createOwnerSessionHeartbeat([a,b]);h.start();await vi.advanceTimersByTimeAsync(1000);let settled=false;const drain=h.stopAndDrain().catch(e=>{settled=true;return e;});await vi.advanceTimersByTimeAsync(2000);expect(settled).toBe(false);held.release();const error=await drain;expect(error).toBeInstanceOf(OwnerSessionHeartbeatUnavailable);expect(error.failures).toEqual([one,two]);expect(error.cause).toBe(one);expect(error.code).toBe('08006');expect(h.failure?.code).toBe('08006');
});
it('does not retry a failed client but keeps a healthy sibling alive until disposal',async()=>{
 vi.useFakeTimers();let bad=0,good=0;const a=session(async()=>{bad++;throw Object.assign(Error('refused'),{code:'08006'});}),b=session(async()=>{good++;});const h=createOwnerSessionHeartbeat([a,b]);h.start();await vi.advanceTimersByTimeAsync(3000);expect(bad).toBe(1);expect(good).toBe(3);await expect(h.stopAndDrain()).rejects.toMatchObject({code:'08006'});
});

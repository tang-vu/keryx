/** Real loopback sockets and synthetic PostgreSQL frames only. No PostgreSQL,
 * credentials, production target, provider or real transaction is involved. */
import { createServer,connect,Socket,type Server } from 'node:net';
import { once } from 'node:events';
import { expect,it,vi } from 'vitest';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';

function frame(type:string,payload:Buffer){const value=Buffer.alloc(payload.length+5);value[0]=type.charCodeAt(0);value.writeInt32BE(payload.length+4,1);payload.copy(value,5);return value;}
const complete=frame('C',Buffer.from('INSERT 0 1\0')),idle=frame('Z',Buffer.from([73]));
async function fixture(){
 const sockets=new Map<Socket,Promise<void>>();let committed=0;
 const server=createServer(socket=>{
  sockets.set(socket,new Promise<void>(resolve=>socket.once('close',()=>{sockets.delete(socket);resolve();})));socket.on('error',()=>{});
  socket.once('data',()=>{committed++;socket.write(Buffer.concat([complete,idle]));});
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Loopback fixture did not listen');
 return {port:address.port,committed:()=>committed,async close(){const stopped=stop(server);for(const socket of sockets.keys())socket.destroy();await stopped;await Promise.all([...sockets.values()]);expect(sockets.size).toBe(0);}};
}
const stop=(server:Server)=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
function client(port:number){const socket=connect({host:'127.0.0.1',port});socket.on('error',()=>{});socket.resume();const closed=new Promise<void>(resolve=>socket.once('close',()=>resolve()));return {socket,closed};}

it('drops idle ReadyForQuery after a synthetic committed write and never retries it',async()=>{
 const upstream=await fixture(),proxy=await startCommitAckLossProxy(upstream.port),peer=client(proxy.port),received:Buffer[]=[];
 peer.socket.on('data',chunk=>received.push(Buffer.from(chunk)));
 try{
  await once(peer.socket,'connect');proxy.arm();peer.socket.write('one synthetic write');await peer.closed;
  expect(upstream.committed()).toBe(1);expect(proxy.observation()).toEqual({dropped:true,commands:1});expect(Buffer.concat(received).includes(idle)).toBe(false);
  await proxy.close();await proxy.close();expect(()=>proxy.arm()).toThrow();
 }finally{peer.socket.destroy();await proxy.close();await upstream.close();}
});
it('awaits the real close event of an already-destroyed upstream socket',async()=>{
 const upstream=await fixture(),proxy=await startCommitAckLossProxy(upstream.port),peer=client(proxy.port);
 const destroy=Socket.prototype.destroy;let target:Socket|undefined,observed=false,nativeClosedAtBarrier=false,observedAtBarrier=false,barrier:Promise<void>|undefined;
 // Call the real destroy on a real owned loopback socket. Observe its native
 // closed flag before close dispatch, without stubbing closed or emitting it.
 const hook=vi.spyOn(Socket.prototype,'destroy').mockImplementation(function(this:Socket,error?:Error){
  if(!target&&this.remotePort===upstream.port){
   target=this;this.once('close',()=>{observed=true;});const result=destroy.call(this,error);
   nativeClosedAtBarrier=this.closed;observedAtBarrier=observed;barrier=proxy.close();return result;
  }
  return destroy.call(this,error);
 });
 try{
  await once(peer.socket,'connect');proxy.arm();peer.socket.write('one synthetic write');await peer.closed;
  expect(target).toBeDefined();expect(nativeClosedAtBarrier).toBe(true);expect(observedAtBarrier).toBe(false);expect(barrier).toBeDefined();
  await barrier;expect(observed).toBe(true);expect(upstream.committed()).toBe(1);expect(proxy.observation()).toEqual({dropped:true,commands:1});
 }finally{hook.mockRestore();peer.socket.destroy();await proxy.close();await upstream.close();}
});
it('fences a connection racing terminal close without opening another upstream',async()=>{
 const upstream=await fixture(),proxy=await startCommitAckLossProxy(upstream.port),peer=client(proxy.port);
 try{await proxy.close();await peer.closed;expect(upstream.committed()).toBe(0);await proxy.close();}
 finally{peer.socket.destroy();await proxy.close();await upstream.close();}
});

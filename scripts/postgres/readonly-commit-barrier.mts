/** Synthetic native fixture only. Hold one committed read acknowledgement while
 * its fixture owner revokes authority; never record data or discover a target. */
import { createServer,connect,type Socket } from 'node:net';
export async function startReadonlyCommitBarrier(upstreamPort:number,hold:()=>Promise<void>){
 if(!Number.isSafeInteger(upstreamPort)||upstreamPort<1||upstreamPort>65535||typeof hold!=='function')throw new Error('Invalid synthetic barrier');
 let armed=false,intercepted=false,completed=false,failed=false,remainingCommits=1;const sockets=new Set<Socket>();
 const own=(s:Socket)=>{sockets.add(s);s.once('close',()=>sockets.delete(s));return s;};
 const server=createServer(client=>{
  own(client);if(sockets.size>4){client.destroy();return;}
  const upstream=own(connect({host:'127.0.0.1',port:upstreamPort}));let buffer:Buffer=Buffer.alloc(0),busy=false,lastCommit=false;
  const stop=()=>{client.destroy();upstream.destroy();};client.on('error',stop);upstream.on('error',stop);client.once('close',()=>upstream.destroy());upstream.once('close',()=>client.destroy());client.pipe(upstream);
  const flush=async()=>{
   if(busy)return;busy=true;
   try{
    while(buffer.length>=5){
     const length=buffer.readInt32BE(1);if(length<4||length>1048576)throw new Error('Synthetic wire bound');const bytes=length+1;if(buffer.length<bytes)break;
     const packet=buffer.subarray(0,bytes);buffer=buffer.subarray(bytes);
     if(packet[0]===67)lastCommit=packet.subarray(5).equals(Buffer.from('COMMIT\0'));
     if(packet[0]===90){
      if(armed&&!intercepted&&lastCommit&&length===5&&packet[5]===73&&--remainingCommits===0){intercepted=true;upstream.pause();await hold();completed=true;client.write(packet);lastCommit=false;upstream.resume();continue;}
      lastCommit=false;
     }
     client.write(packet);
    }
   }catch{failed=true;stop();}finally{busy=false;}
  };
  upstream.on('data',chunk=>{if(!Buffer.isBuffer(chunk)){stop();return;}buffer=Buffer.concat([buffer,chunk]);if(buffer.length>1048576){stop();return;}void flush();});
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw new Error('Synthetic barrier did not listen');
 return Object.freeze({port:address.port,arm(ordinal=1){if(armed||intercepted||!Number.isSafeInteger(ordinal)||ordinal<1||ordinal>8)throw new Error('Synthetic barrier cannot arm');remainingCommits=ordinal;armed=true;},observation:()=>({intercepted,completed,failed}),async close(){const closing=[...sockets].map(s=>new Promise<void>(resolve=>{if(s.closed)resolve();else s.once('close',resolve);s.destroy();}));await Promise.all([...closing,new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))]);if(sockets.size)throw new Error('Synthetic barrier sockets remain');}});
}

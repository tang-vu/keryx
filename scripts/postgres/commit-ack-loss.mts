/** Synthetic fixture only: suppress exactly one ReadyForQuery(IDLE) after its
 * CommandComplete. Seeing that frame proves PostgreSQL finished the implicit
 * transaction before the client loses its acknowledgement. No TLS interception,
 * data logging, target discovery or production connection is supported. */
import { createServer, connect, type Socket,type Server } from "node:net";
const ownedServers=new WeakMap<Server,number>(),ownedPorts=new Map<number,{server:Server;target:number}>();
/** Read-only fixture provenance. Only the closed factory below can register. */
export function isCommitAckLossServerFor(server:unknown,targetPort:number):boolean{
 return arguments.length===2&&!!server&&typeof server==='object'&&Number.isSafeInteger(targetPort)&&ownedServers.get(server as Server)===targetPort;
}
export function isCommitAckLossProxyFor(port:number,targetPort:number):boolean{
 const record=ownedPorts.get(port);return arguments.length===2&&Number.isSafeInteger(port)&&!!record&&record.target===targetPort&&record.server.listening&&ownedServers.get(record.server)===targetPort;
}

export async function startCommitAckLossProxy(upstreamPort: number) {
  if (!Number.isSafeInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) throw new Error("Invalid owned fixture port");
  let armed = false, dropped = false, commands = 0, skipped = 0, closing = false;
  let closed: Promise<void> | undefined;
  const sockets = new Set<Socket>();
  const closures = new Map<Socket, Promise<void>>();
  const own = (socket: Socket) => {
    sockets.add(socket);
    closures.set(socket, new Promise<void>(resolve => socket.once("close", () => {
      sockets.delete(socket); closures.delete(socket); resolve();
    })));
    return socket;
  };
  const server = createServer(client => {
    own(client);
    if (closing || sockets.size > 4) { client.destroy(); return; }
    const upstream = own(connect({ host: "127.0.0.1", port: upstreamPort }));
    let buffer: Buffer = Buffer.alloc(0); let completed = false;
    const stop = () => { client.destroy(); upstream.destroy(); };
    client.on("error", stop); upstream.on("error", stop);
    client.once("close", () => upstream.destroy()); upstream.once("close", () => client.destroy());
    client.pipe(upstream);
    upstream.on("data", chunk => {
      if (!Buffer.isBuffer(chunk)) { stop(); return; }
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 1024 * 1024) { stop(); return; }
      while (buffer.length >= 5) {
        const length = buffer.readInt32BE(1);
        if (length < 4 || length > 1024 * 1024) { stop(); return; }
        const bytes = length + 1; if (buffer.length < bytes) break;
        const packet = buffer.subarray(0, bytes); buffer = buffer.subarray(bytes);
        const type = String.fromCharCode(packet[0]);
        if (type === "C") { completed = true; commands++; }
        if (type === "Z") {
          if (armed && completed && length === 5 && packet[5] === 73) {
            if (skipped > 0) skipped--;
            else { armed = false; dropped = true; stop(); return; }
          }
          completed = false;
        }
        client.write(packet);
      }
    });
  });
  let port:number|undefined;const unregister=()=>{ownedServers.delete(server);if(port!==undefined&&ownedPorts.get(port)?.server===server)ownedPorts.delete(port);};
  ownedServers.set(server,upstreamPort);server.once('close',unregister);server.once('error',unregister);
  try{
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string"||address.address!=='127.0.0.1') throw new Error("Owned fixture proxy did not listen");
    port=address.port;ownedPorts.set(port,{server,target:upstreamPort});
  }catch(error){unregister();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));throw error;}
  return Object.freeze({
    port: port!,
    arm(skipCompleted = 0) {
      if (closing || armed || dropped || !Number.isSafeInteger(skipCompleted) || skipCompleted < 0 || skipCompleted > 4) throw new Error("Owned acknowledgement loss already armed or invalid");
      skipped = skipCompleted; armed = true;
    },
    observation: () => ({ dropped, commands }),
    close() {
      closing = true;unregister();
      return closed ??= Promise.resolve().then(async () => {
        const stopped = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
        await stopped;
        // server.close fences late accepts, but does not own upstream sockets.
        // Every tracked socket must reach OUR close listener, even if native
        // socket.closed already became true before that event was dispatched.
        await Promise.all([...closures.values()]);
        if (sockets.size) throw new Error("Owned fixture proxy sockets remain");
      });
    },
  });
}

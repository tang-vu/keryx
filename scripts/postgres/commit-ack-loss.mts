/** Synthetic fixture only: suppress exactly one ReadyForQuery(IDLE) after its
 * CommandComplete. Seeing that frame proves PostgreSQL finished the implicit
 * transaction before the client loses its acknowledgement. No TLS interception,
 * data logging, target discovery or production connection is supported. */
import { createServer, connect, type Socket } from "node:net";

export async function startCommitAckLossProxy(upstreamPort: number) {
  if (!Number.isSafeInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) throw new Error("Invalid owned fixture port");
  let armed = false, dropped = false, commands = 0;
  const sockets = new Set<Socket>();
  const own = (socket: Socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); return socket; };
  const server = createServer(client => {
    own(client);
    if (sockets.size > 4) { client.destroy(); return; }
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
            armed = false; dropped = true; stop(); return;
          }
          completed = false;
        }
        client.write(packet);
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Owned fixture proxy did not listen");
  return Object.freeze({
    port: address.port,
    arm() { if (armed || dropped) throw new Error("Owned acknowledgement loss already armed"); armed = true; },
    observation: () => ({ dropped, commands }),
    async close() {
      const closing = [...sockets].map(socket => new Promise<void>(resolve => {
        if (socket.closed) resolve(); else socket.once("close", resolve);
        socket.destroy();
      }));
      await Promise.all([...closing, new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))]);
      if (sockets.size) throw new Error("Owned fixture proxy sockets remain");
    },
  });
}

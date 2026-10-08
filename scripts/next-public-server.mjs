import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PUBLIC_ORIGIN = 'https://keryx.cc';
export const NEXT_VERSION = '16.3.8';

function singleHeader(req, name) {
  const values = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === name) values.push(req.rawHeaders[i + 1]);
  }
  return values.length === 1 ? values[0] : null;
}

// This listener is private to the local ingress. Validate metadata without
// rewriting either the request target or any header seen by Next/application code.
export function hasPublicHttpsMetadata(req) {
  const peer = req.socket.remoteAddress;
  if (peer !== '127.0.0.1' && peer !== '::ffff:127.0.0.1') return false;
  if (singleHeader(req, 'host') !== 'keryx.cc' || singleHeader(req, 'x-forwarded-proto') !== 'https') return false;
  for (const [name, expected] of [['x-forwarded-host', 'keryx.cc'], ['x-forwarded-port', '443']]) {
    if (req.rawHeaders.some((value, index) => index % 2 === 0 && value.toLowerCase() === name)
      && singleHeader(req, name) !== expected) return false;
  }
  return typeof req.url === 'string' && req.url.startsWith('/') && !req.url.startsWith('//')
    && !/[\\\u0000-\u0020\u007f]/.test(req.url);
}

export async function startNextPublicServer({ dir = process.cwd(), port = 3939 } = {}) {
  if (!Number.isInteger(port) || (port !== 0 && port !== 3939 && port !== 3940)) throw new Error('INVALID_LISTEN_PORT');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 16)) throw new Error('NODE_24_16_REQUIRED');
  if (process.env.NODE_ENV !== 'production') throw new Error('PRODUCTION_REQUIRED');
  const appDir = resolve(dir);
  const requireApp = createRequire(resolve(appDir, 'package.json'));
  if (requireApp('next/package.json').version !== NEXT_VERSION) throw new Error('NEXT_VERSION_MISMATCH');
  const next = requireApp('next');
  let handle;
  let draining = false;
  const server = createServer({ shouldUpgradeCallback: () => false }, (req, res) => {
    if (!hasPublicHttpsMetadata(req)) {
      res.writeHead(421, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('Public HTTPS metadata required');
      return;
    }
    if (req.headers.upgrade !== undefined) {
      res.writeHead(426, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('HTTP upgrades unavailable');
      return;
    }
    if (draining) {
      res.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('Server draining');
      return;
    }
    Promise.resolve(handle(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      if (!res.writableEnded) res.end();
    });
  });
  server.keepAliveTimeout = 100000;
  server.keepAliveTimeoutBuffer = 5000;
  server.maxRequestsPerSocket = 0;
  // Public request metadata is independent of the private physical socket.
  const app = next({ dev: false, dir: appDir, hostname: 'keryx.cc', port: 443, httpServer: server });
  await app.prepare();
  handle = app.getRequestHandler();
  await new Promise((accept, reject) => {
    const fail = (error) => { server.off('listening', ready); reject(error); };
    const ready = () => { server.off('error', fail); accept(); };
    server.once('error', fail);
    server.once('listening', ready);
    server.listen(port, '127.0.0.1');
  });
  let closing;
  const close = () => {
    if (!closing) closing = (async () => {
      draining = true;
      // Never force-close active API/SSE requests. Next's close uses allSettled;
      // the owned HTTP listener must have positively drained before calling it.
      await new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept()));
      await app.close();
      await requireApp('next/dist/trace').flushAllTraces();
    })();
    return closing;
  };
  return { server, close, receipt: {
    format: 'keryx-next-public-server-ready-v1', pid: process.pid,
    physicalHost: '127.0.0.1', physicalPort: server.address().port,
    publicOrigin: PUBLIC_ORIGIN, publicMetadataPort: 443, nextVersion: NEXT_VERSION,
    ready: true,
  } };
}

export function installNextPublicShutdown(running) {
  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    running.close().then(() => {
      // Match pinned production Next's signal exit after HTTP/Next/trace drain.
      // App-owned background intervals need not end naturally. Flush the bounded
      // closed receipt before self-exit; there is no timeout or external kill.
      const exitCode = signal === 'SIGINT' ? 130 : 143;
      const receipt = { format: 'keryx-next-public-server-closed-v1', pid: process.pid, httpDrained: true, signal, exitCode };
      return new Promise((accept, reject) => process.stdout.write(JSON.stringify(receipt) + '\n', (error) => error ? reject(error) : accept(exitCode)));
    }).then((exitCode) => {
      process.exit(exitCode);
    }).catch(() => {
      console.error('NEXT_PUBLIC_SERVER_CLOSE_FAILED_HOLD');
      // A failed close must retain the process for diagnosis, never report exit.
      setInterval(() => {}, 60000);
    });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--port' || !['3939', '3940'].includes(args[1]))) {
    throw new Error('INVALID_ARGUMENTS');
  }
  const running = await startNextPublicServer({ port: args.length ? Number(args[1]) : 3939 });
  installNextPublicShutdown(running);
  console.log(JSON.stringify(running.receipt));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('NEXT_PUBLIC_SERVER_START_FAILED'); process.exitCode = 1; });
}

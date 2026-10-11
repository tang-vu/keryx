// Rehearsal-only audit around the unchanged, actual built public Next listener.
import { startNextPublicServer, installNextPublicShutdown } from '../next-public-server.mjs';

if (process.platform !== 'linux' || process.env.KERYX_FORCE_OFFLINE !== '1'
  || process.env.KERYX_NETWORK !== 'arcTestnet') throw Error('ISOLATED_LINUX_REQUIRED');
// Keep Next's build/manifests bound to their original app directory. SQLite uses
// the isolated cwd; relocating the app itself can lose absolute CSS manifest keys.
const running = await startNextPublicServer({ dir: process.argv[2], port: 0 });
running.server.prependListener('request', req => {
  // Never record cookies, signatures, bodies or query values.
  process.send?.({ kind: 'application-request', method: req.method, path: req.url.split('?', 1)[0] });
});
installNextPublicShutdown(running);
process.send?.({ kind: 'ready', ...running.receipt });

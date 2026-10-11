// Rehearsal-only audit around the unchanged, actual built public Next listener.
import { startNextPublicServer, installNextPublicShutdown } from '../next-public-server.mjs';

if (process.platform !== 'linux' || process.env.KERYX_FORCE_OFFLINE !== '1'
  || process.env.KERYX_NETWORK !== 'arcTestnet') throw Error('ISOLATED_LINUX_REQUIRED');
const running = await startNextPublicServer({ port: 0 });
running.server.prependListener('request', req => {
  // Never record cookies, signatures, bodies or query values.
  process.send?.({ kind: 'application-request', method: req.method, path: req.url.split('?', 1)[0] });
});
installNextPublicShutdown(running);
process.send?.({ kind: 'ready', ...running.receipt });

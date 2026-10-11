// Cohort-local launcher. Preserve the operational cwd/ENV/storage bindings while
// Next loads source and dependencies only from this exact immutable release.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { startNextPublicServer, installNextPublicShutdown } from './next-public-server.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length !== 4 || process.argv[2] !== '--port' || process.argv[3] !== '3939' ||
    !/^\/root\/\.local\/share\/keryx-releases\/[a-f0-9]{40}\/source$/.test(source) ||
    process.cwd() !== '/root/keryx' || process.env.KERYX_COMMIT !== source.split('/').at(-2)) {
  console.error('IMMUTABLE_PUBLIC_SERVER_BINDING_REFUSED'); process.exitCode = 1;
} else {
  startNextPublicServer({ dir: source, port: 3939, useBuildConfig: true }).then(running => {
    installNextPublicShutdown(running);
    console.log(JSON.stringify({ ...running.receipt, commit: process.env.KERYX_COMMIT,
      buildId: readFileSync(path.join(source, '.next', 'BUILD_ID'), 'utf8').trim() }));
  }).catch(() => { console.error('IMMUTABLE_PUBLIC_SERVER_START_FAILED'); process.exitCode = 1; });
}

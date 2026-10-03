import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { startNextPublicServer, NEXT_VERSION } from './next-public-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = resolve(process.env.KERYX_NEXT_FIXTURE_NODE_MODULES || join(root, 'node_modules'));

function get(port, { path = '/api/origin', headers = { Host: 'keryx.cc', 'X-Forwarded-Proto': 'https' } } = {}) {
  return new Promise((accept, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => accept({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('pinned production Next sees public HTTPS origin on a private ephemeral socket', { timeout: 180000 }, async () => {
  // Webpack on Windows cannot resolve Next's cross-drive absolute entry paths.
  const temporaryRoot = process.platform === 'win32' ? join(root, '.next-public-fixtures') : tmpdir();
  await mkdir(temporaryRoot, { recursive: true });
  const dir = await mkdtemp(join(temporaryRoot, 'keryx-next-public-origin-'));
  let running;
  const priorMode = process.env.NODE_ENV;
  const priorDist = process.env.NEXT_DIST_DIR;
  process.env.NODE_ENV = 'production';
  process.env.NEXT_DIST_DIR = '.next.tmp';
  try {
    await symlink(modules, join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'keryx-public-origin-fixture', private: true }));
    await mkdir(join(dir, 'app', 'api', 'origin'), { recursive: true });
    await writeFile(join(dir, 'next.config.mjs'), "export default {distDir:process.env.NEXT_DIST_DIR || '.next',experimental:{cpus:1}};\n");
    await writeFile(join(dir, 'app', 'layout.js'), "export default function Layout({children}){return <html><body>{children}</body></html>}\n");
    await writeFile(join(dir, 'app', 'api', 'origin', 'route.js'), `export const dynamic='force-dynamic';
export async function GET(request){
  if(new URL(request.url).searchParams.has('delay')) await new Promise(resolve=>setTimeout(resolve,300));
  return Response.json({origin:new URL(request.url).origin,url:request.url,host:request.headers.get('host'),proto:request.headers.get('x-forwarded-proto')});
}\n`);
    const requireFixture = createRequire(join(dir, 'package.json'));
    assert.equal(requireFixture('next/package.json').version, NEXT_VERSION);
    await new Promise((accept, reject) => {
      const child = spawn(process.execPath, [requireFixture.resolve('next/dist/bin/next'), 'build', '--webpack'], {
        cwd: dir, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-16000); });
      child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-16000); });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? accept() : reject(new Error(`Fixture build exit ${code}: ${output}`)));
    });
    running = await startNextPublicServer({ dir, port: 0 });
    const { physicalPort } = running.receipt;
    assert.equal(running.server.keepAliveTimeout, 100000);
    assert.equal(running.server.keepAliveTimeoutBuffer, 5000);
    assert.equal(running.server.maxRequestsPerSocket, 0);
    const positive = await get(physicalPort);
    assert.equal(positive.status, 200);
    assert.deepEqual(JSON.parse(positive.body), {
      origin: 'https://keryx.cc', url: 'https://keryx.cc/api/origin', host: 'keryx.cc', proto: 'https',
    });
    for (const options of [
      { headers: { Host: 'localhost', 'X-Forwarded-Proto': 'https' } },
      { headers: { Host: 'keryx.cc', 'X-Forwarded-Proto': 'http' } },
      { headers: { Host: 'keryx.cc', 'X-Forwarded-Proto': 'https,http' } },
      { headers: { Host: 'keryx.cc' } },
      { headers: ['Host', 'keryx.cc', 'Host', 'evil.example', 'X-Forwarded-Proto', 'https'] },
      { headers: ['Host', 'keryx.cc', 'X-Forwarded-Proto', 'https', 'X-Forwarded-Proto', 'http'] },
      { path: 'https://evil.example/api/origin' },
      { path: '//evil.example/api/origin' },
      { headers: { Host: 'keryx.cc', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'evil.example' } },
    ]) assert.equal((await get(physicalPort, options)).status, 421);
    assert.equal((await get(physicalPort, { headers: {
      Host: 'keryx.cc', 'X-Forwarded-Proto': 'https', Connection: 'Upgrade', Upgrade: 'websocket',
    } })).status, 426);
    const pending = get(physicalPort, { path: '/api/origin?delay=1' });
    await new Promise((accept) => setTimeout(accept, 80));
    let closed = false;
    const closing = running.close().then(() => { closed = true; });
    await new Promise((accept) => setTimeout(accept, 40));
    assert.equal(closed, false, 'HTTP close must wait for the active response');
    assert.equal((await pending).status, 200);
    await closing;
    assert.equal(running.server.listening, false);
    running = null;
    if (process.platform !== 'win32') {
      // POSIX SIGTERM exercises the actual supported shutdown in a separate process.
      // Use an ephemeral socket; a live QA instance may already own port 3940.
      // Windows child.kill is
      // forceful, so it must never stand in for this graceful-exit evidence.
      const entry = `import {startNextPublicServer,installNextPublicShutdown} from ${JSON.stringify(new URL('./next-public-server.mjs', import.meta.url).href)};
const running=await startNextPublicServer({port:0});
installNextPublicShutdown(running);
console.log(JSON.stringify(running.receipt));
setInterval(()=>{},60000);`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', entry], {
        cwd: dir, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const exited = new Promise((accept, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => accept({ code, signal }));
      });
      let stdout = '';
      let childPort;
      const ready = new Promise((accept, reject) => {
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
          for (const line of stdout.split('\n').slice(0, -1)) {
            if (line.startsWith('{') && line.includes('keryx-next-public-server-ready-v1')) {
              childPort = JSON.parse(line).physicalPort;
              accept();
            }
          }
        });
        child.once('exit', () => reject(new Error('CLI exited before ready')));
      });
      await ready;
      const active = get(childPort, { path: '/api/origin?delay=1' });
      await new Promise((accept) => setTimeout(accept, 80));
      child.kill('SIGTERM');
      assert.equal((await active).status, 200);
      assert.deepEqual(await exited, { code: 143, signal: null });
      assert.match(stdout, /"httpDrained":true/);
    }
  } finally {
    if (running) await running.close();
    if (priorMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorMode;
    if (priorDist === undefined) delete process.env.NEXT_DIST_DIR; else process.env.NEXT_DIST_DIR = priorDist;
    await rm(dir, { recursive: true, force: true });
  }
});

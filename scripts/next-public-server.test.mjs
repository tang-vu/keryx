import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, cp, copyFile, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { preparationEnvironment } from './prepare-immutable-release.mjs';
import { startNextPublicServer, NEXT_VERSION } from './next-public-server.mjs';
import { startPreparedPublicRole, readPreparedPublicHealth, drainPreparedPublicRole } from './rehearse-prepared-release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = resolve(process.env.KERYX_NEXT_FIXTURE_NODE_MODULES || join(root, 'node_modules'));

async function buildBytes(directory) {
  const files = [];
  const visit = async dir => {
    for (const name of (await readdir(dir)).sort()) {
      const file = join(dir, name), stat = await lstat(file);
      if (stat.isDirectory()) await visit(file);
      else if (stat.isFile()) files.push([file.slice(directory.length), createHash('sha256').update(await readFile(file)).digest('hex')]);
      else throw Error('Unexpected fixture build link');
    }
  };
  await visit(join(directory, '.next'));
  return files;
}

async function compileFixture(directory, nextCli, scratch) {
  const started = performance.now(), startedAt = new Date().toISOString();
  const child = spawn(process.execPath, [nextCli, 'build', '--webpack'], {
    cwd: directory, env: preparationEnvironment({ commit: 'a'.repeat(40), scratch }), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const stdout = [], stderr = [], errors = []; let bytes = 0, processError = null;
  for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) {
    stream.on('data', chunk => { bytes += chunk.length; if (bytes <= 4 * 1024 * 1024) chunks.push(chunk); });
    stream.once('error', error => errors.push(error.code ?? 'PIPE_ERROR'));
  }
  child.once('error', error => { processError = error.code ?? 'PROCESS_ERROR'; });
  const exit = await new Promise(accept => child.once('close', (code, signal) => accept({ code, signal })));
  const out = Buffer.concat(stdout), err = Buffer.concat(stderr);
  await writeFile(join(directory, 'fixture-build.stdout.log'), out, { flag: 'wx' });
  await writeFile(join(directory, 'fixture-build.stderr.log'), err, { flag: 'wx' });
  const receipt = { ...exit, processError, errors, stdoutEof: child.stdout.readableEnded, stderrEof: child.stderr.readableEnded,
    startedAt, elapsedMs: Math.round(performance.now() - started), observedBytes: bytes,
    stdoutSha256: createHash('sha256').update(out).digest('hex'), stderrSha256: createHash('sha256').update(err).digest('hex') };
  await writeFile(join(directory, 'fixture-build.json'), JSON.stringify(receipt) + '\n', { flag: 'wx' });
  assert.ok(exit.code === 0 && exit.signal === null && !processError && !errors.length && receipt.stdoutEof && receipt.stderrEof && bytes <= 4 * 1024 * 1024,
    `Compiled fixture refused: ${JSON.stringify(receipt)}; ${out.toString()}${err.toString()}`);
  return receipt;
}

function get(port, { path = '/api/origin', headers = { Host: 'keryx.cc', 'X-Forwarded-Proto': 'https' } } = {}) {
  return new Promise((accept, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => accept({ status: res.statusCode, body, headers: res.headers }));
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
  const candidate = dir + '-candidate';
  const evidence = { format: 'keryx-compiled-cohort-fixture-v1', productionAdmitted: false,
    platform: process.platform, node: process.versions.node, predecessorDirectory: dir,
    candidateDirectory: candidate, accepted: false, roles: [], builds: [] };
  let running;
  const priorMode = process.env.NODE_ENV;
  const priorDist = process.env.NEXT_DIST_DIR;
  process.env.NODE_ENV = 'production';
  process.env.NEXT_DIST_DIR = '.next';
  try {
    await symlink(modules, join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'keryx-public-origin-fixture', private: true }));
    await mkdir(join(dir, 'scripts'));
    await copyFile(join(root, 'scripts', 'next-public-server.mjs'), join(dir, 'scripts', 'next-public-server.mjs'));
    await copyFile(join(root, 'scripts', 'immutable-next-cache.cjs'), join(dir, 'scripts', 'immutable-next-cache.cjs'));
    await mkdir(join(dir, 'app', 'api', 'origin'), { recursive: true });
    await mkdir(join(dir, 'app', 'api', 'health'), { recursive: true });
    await mkdir(join(dir, 'app', 'api', 'extraction'), { recursive: true });
    await mkdir(join(dir, 'app', 'api', 'cached'), { recursive: true });
    await mkdir(join(dir, 'public'));
    await writeFile(join(dir, 'public', 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=', 'base64'));
    for (const file of ['lib/web-research/extraction-worker.ts', 'lib/web-research/html-reader.ts',
      'lib/web-research/html-reader-worker.mjs', 'lib/web-research/html-content-worker.mjs', 'lib/web-research/html-visibility.mjs',
      'lib/web-research/pdf-reader.ts', 'lib/web-research/pdf-reader-worker.mjs',
      'lib/web-research/parser-slots.ts', 'lib/web-research/html-text-layout.ts',
      'lib/research/arxiv-bibliography-page.ts', 'lib/research/arxiv-bibliography-worker.mjs',
      'lib/research/bibliographic-original-types.ts', 'lib/scholarly/doi.ts', 'lib/scholarly/arxiv-identity.ts']) {
      await mkdir(dirname(join(dir, file)), { recursive: true });
      await copyFile(join(root, file), join(dir, file));
    }
    await writeFile(join(dir, 'app', 'api', 'cached', 'route.js'), `export const revalidate=1;
export async function GET(){return Response.json({cached:'local-fixture'})}\n`);
    await writeFile(join(dir, 'app', 'api', 'extraction', 'route.ts'), `
import {extractHtml} from '../../../lib/web-research/html-reader';
import {extractPdfText} from '../../../lib/web-research/pdf-reader';
import {observeArxivBibliographicPage} from '../../../lib/research/arxiv-bibliography-page';
export const dynamic='force-dynamic';
export async function GET(){try {
 const html=await extractHtml('<html><head><title>Cohort original</title></head><body><article><h1>Cohort original</h1><p>'+('This local original retains its source cohort and bounded evidence. '.repeat(20))+'</p></article></body></html>','https://example.com/local');
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [4 0 R] >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>'];
 const stream='BT /F1 12 Tf 72 720 Td (Cohort PDF original) Tj ET';objects.push('<< /Length '+Buffer.byteLength(stream)+' >>\\nstream\\n'+stream+'\\nendstream');
 let body='%PDF-1.7\\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(body));body+=(i+1)+' 0 obj\\n'+object+'\\nendobj\\n'});
 const xref=Buffer.byteLength(body);body+='xref\\n0 '+offsets.length+'\\n0000000000 65535 f \\n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \\n').join('')+'trailer\\n<< /Size '+offsets.length+' /Root 1 0 R >>\\nstartxref\\n'+xref+'\\n%%EOF\\n';
 const pdf=await extractPdfText(new Uint8Array(Buffer.from(body)),{maxPages:1,maxChars:2000,timeoutMs:10000});
 const bibliography=await observeArxivBibliographicPage('<html><head><meta name="citation_title" content="Cohort metadata"></head><body></body></html>');
 return Response.json({html:html.title,pdf:pdf.text,bibliography:bibliography.metadata.citation_title?.[0]?.value});
}catch(error){return Response.json({fixtureError:String(error),cause:String(error.cause)},{status:500})}}\n`);
    await writeFile(join(dir, 'app', 'api', 'health', 'route.js'), `export const dynamic='force-dynamic';
export async function GET(){return Response.json({commit:process.env.KERYX_COMMIT,network:'arcTestnet',settles:'offline',db:'ok'})}\n`);
    await writeFile(join(dir, 'fixture-headers.cjs'), "exports.marker='prepared-config-header';\n");
    await writeFile(join(dir, 'next.config.ts'), `import {marker} from './fixture-headers.cjs';
export default {distDir:'.next',typescript:{ignoreBuildErrors:true},experimental:{cpus:1},serverExternalPackages:['jsdom','parse5','@mozilla/readability','pdfjs-dist'],outputFileTracingIncludes:{'/*':['./lib/web-research/*-worker.mjs','./lib/web-research/html-visibility.mjs','./lib/research/arxiv-bibliography-worker.mjs','./node_modules/@mozilla/readability/**','./node_modules/pdfjs-dist/legacy/build/*.mjs','./node_modules/pdfjs-dist/package.json']},async headers(){return [{source:'/api/origin',headers:[{key:'x-cohort-fixture',value:marker}]}]}};\n`);
    await writeFile(join(dir, 'app', 'layout.js'), "export default function Layout({children}){return <html><body>{children}</body></html>}\n");
    await writeFile(join(dir, 'app', 'api', 'origin', 'route.js'), `export const dynamic='force-dynamic';
export async function GET(request){
  if(new URL(request.url).searchParams.has('delay')) await new Promise(resolve=>setTimeout(resolve,300));
  return Response.json({origin:new URL(request.url).origin,url:request.url,host:request.headers.get('host'),proto:request.headers.get('x-forwarded-proto')});
}\n`);
    const requireFixture = createRequire(join(dir, 'package.json'));
    assert.equal(requireFixture('next/package.json').version, NEXT_VERSION);
    evidence.builds.push(await compileFixture(dir, requireFixture.resolve('next/dist/bin/next'), dir));
    const originalCwd = process.cwd();
    try { process.chdir(dir); running = await startNextPublicServer({ dir, port: 0 }); }
    finally { process.chdir(originalCwd); }
    const { physicalPort } = running.receipt;
    assert.equal(running.server.keepAliveTimeout, 100000);
    assert.equal(running.server.keepAliveTimeoutBuffer, 5000);
    assert.equal(running.server.maxRequestsPerSocket, 0);
    const positive = await get(physicalPort);
    assert.equal(positive.status, 200);
    assert.equal(positive.headers['x-cohort-fixture'], 'prepared-config-header');
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
    // The immutable launcher must use its completed build from an operational
    // storage cwd, while ordinary startup above keeps loading source config.
    const storage = join(dir, 'isolated-runtime-storage');
    await mkdir(storage);
    // Decoy code in the operational cwd must never be selected by compiled readers.
    for (const file of ['lib/web-research/html-reader-worker.mjs', 'lib/web-research/pdf-reader-worker.mjs', 'lib/research/arxiv-bibliography-worker.mjs']) {
      await mkdir(dirname(join(storage, file)), { recursive: true });
      await writeFile(join(storage, file), "throw Error('Wrong storage cohort');\n");
    }
    const immutableBefore = await buildBytes(dir);
    const priorCwd = process.cwd();
    const priorSerialized = process.env.__NEXT_PRIVATE_STANDALONE_CONFIG;
    try {
      process.chdir(storage);
      running = await startNextPublicServer({ dir, port: 0, useBuildConfig: true });
    } finally { process.chdir(priorCwd); }
    assert.equal(process.env.__NEXT_PRIVATE_STANDALONE_CONFIG, priorSerialized);
    assert.equal((await get(running.receipt.physicalPort)).status, 200);
    assert.equal(running.receipt.runtimeCache, 'bounded-process-memory');
    await running.close(); running = null;
    assert.deepEqual(await buildBytes(dir), immutableBefore, 'Requests and positive close cannot mutate immutable code/build files');
    evidence.predecessorBuildDigest = createHash('sha256').update(JSON.stringify(immutableBefore)).digest('hex');
    // Exercise the actual eval entry and a fresh config cache. Using the module
    // path as argv[1] used to activate its CLI guard and start a second server.
    const fixtureCommit = 'ab'.repeat(20);
    const role = await startPreparedPublicRole(dir, preparationEnvironment({ commit: fixtureCommit, scratch: storage }), storage, 'actual-prepared-entry');
    try {
      const response = await get(3940);
      assert.equal(response.status, 200);
      assert.equal(response.headers['x-cohort-fixture'], 'prepared-config-header');
      assert.equal((await readPreparedPublicHealth(fixtureCommit)).commit, fixtureCommit);
      const extracted = await get(3940, { path: '/api/extraction' });
      assert.equal(extracted.status, 200, `Compiled extraction refused: ${extracted.body}`);
      assert.deepEqual(JSON.parse(extracted.body),
        { html: 'Cohort original', pdf: 'Cohort PDF original', bibliography: 'Cohort metadata' });
      const cached = await get(3940, { path: '/api/cached' });
      assert.equal(cached.status, 200, `Seeded route refused: ${cached.body}`);
      const image = await get(3940, { path: '/_next/image?url=%2Fpixel.png&w=32&q=75' });
      assert.equal(image.status, 200, `Optimized local image refused: ${image.body}`);
    } finally {
      assert.equal((await drainPreparedPublicRole(role)).httpDrained, true);
    }
    assert.match(role.output(), /"httpDrained":true/);
    assert.doesNotMatch(role.output(), /NEXT_PUBLIC_SERVER_START_FAILED/);
    assert.equal(role.ready.buildId, (await readFile(join(dir, '.next', 'BUILD_ID'), 'utf8')).trim());
    evidence.roles.push({ label: 'predecessor', ready: role.ready, output: role.capture() });
    // A separately compiled candidate proves actual old/new/old code selection,
    // not merely relabeling one build. Both roles use the same retained storage.
    await mkdir(candidate);
    for (const name of ['app', 'lib', 'scripts', 'public', 'package.json', 'next.config.ts'])
      await cp(join(dir, name), join(candidate, name), { recursive: true, force: false, errorOnExist: true });
    await writeFile(join(candidate, 'fixture-headers.cjs'), "exports.marker='compiled-candidate-header';\n");
    await symlink(modules, join(candidate, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    evidence.builds.push(await compileFixture(candidate, requireFixture.resolve('next/dist/bin/next'), storage));
    const candidateBefore = await buildBytes(candidate);
    evidence.candidateBuildDigest = createHash('sha256').update(JSON.stringify(candidateBefore)).digest('hex');
    assert.notEqual((await readFile(join(candidate, '.next', 'BUILD_ID'), 'utf8')).trim(), role.ready.buildId);
    for (const [label, cohort, commit, header] of [
      ['candidate', candidate, 'c'.repeat(40), 'compiled-candidate-header'],
      ['rollback', dir, fixtureCommit, 'prepared-config-header'],
    ]) {
      const started = performance.now();
      const nextRole = await startPreparedPublicRole(cohort, preparationEnvironment({ commit, scratch: storage }), storage, label);
      const readinessMs = Math.round(performance.now() - started);
      try {
        assert.equal((await get(3940)).headers['x-cohort-fixture'], header);
        assert.equal((await readPreparedPublicHealth(commit)).commit, commit);
        assert.equal(nextRole.ready.buildId, (await readFile(join(cohort, '.next', 'BUILD_ID'), 'utf8')).trim());
      } finally { assert.equal((await drainPreparedPublicRole(nextRole)).httpDrained, true); }
      evidence.roles.push({ label, readinessMs, ready: nextRole.ready, output: nextRole.capture() });
    }
    assert.deepEqual(await buildBytes(dir), immutableBefore);
    assert.deepEqual(await buildBytes(candidate), candidateBefore);
    // Lose the IPC ACK of an actual compiled server. The original stays owned
    // through one graceful drain and both pipe EOFs; no replacement is started.
    const withoutAck = (...args) => {
      const child = spawn(...args), emit = child.emit;
      child.emit = function(event, ...values) { return event === 'message' ? true : emit.call(this, event, ...values); };
      return child;
    };
    await assert.rejects(startPreparedPublicRole(dir, preparationEnvironment({ commit: fixtureCommit, scratch: storage }),
      storage, 'uncertain-ack', withoutAck, { readinessTimeoutMs: 10000 }), error => {
      assert.match(error.message, /acknowledgement not observed/);
      assert.equal(error.rehearsal.drainAccepted, true); assert.equal(error.rehearsal.capture.complete, true);
      evidence.uncertainAck = error.rehearsal;
      return true;
    });
    assert.deepEqual(await buildBytes(dir), immutableBefore);
    if (process.platform !== 'win32') {
      // POSIX SIGTERM exercises the actual supported shutdown in a separate process.
      // Use an ephemeral socket; a live QA instance may already own port 3940.
      // Windows child.kill is
      // forceful, so it must never stand in for this graceful-exit evidence.
      const entry = `import {startNextPublicServer,installNextPublicShutdown} from ${JSON.stringify(new URL('./next-public-server.mjs', import.meta.url).href)};
const running=await startNextPublicServer({dir:${JSON.stringify(dir)},port:0,useBuildConfig:true});
installNextPublicShutdown(running);
console.log(JSON.stringify(running.receipt));
setInterval(()=>{},60000);`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', entry], {
        cwd: storage, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
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
    evidence.accepted = true;
  } finally {
    if (running) await running.close();
    if (priorMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorMode;
    if (priorDist === undefined) delete process.env.NEXT_DIST_DIR; else process.env.NEXT_DIST_DIR = priorDist;
    // Retain compiled cohorts, original logs and failed preparation for review.
    // No test timeout or failure authorizes removing a live or ambiguous role.
    console.log(JSON.stringify(evidence));
  }
});

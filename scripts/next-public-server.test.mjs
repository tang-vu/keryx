import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, cp, copyFile, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { preparationEnvironment } from './prepare-immutable-release.mjs';
import { startNextPublicServer, NEXT_VERSION } from './next-public-server.mjs';
import { createPublicRequestObservation } from './next-public-observation.mjs';
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
    await copyFile(join(root, 'scripts', 'next-public-observation.mjs'), join(dir, 'scripts', 'next-public-observation.mjs'));
    await copyFile(join(root, 'scripts', 'immutable-next-cache.cjs'), join(dir, 'scripts', 'immutable-next-cache.cjs'));
    await mkdir(join(dir, 'app', 'api', 'origin'), { recursive: true });
    await mkdir(join(dir, 'app', 'api', 'health'), { recursive: true });
    await mkdir(join(dir, 'app', 'api', 'extraction'), { recursive: true });
    await mkdir(join(dir, 'app', 'api', 'cached'), { recursive: true });
    await mkdir(join(dir, 'public'));
    await writeFile(join(dir, 'public', 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=', 'base64'));
    for (const file of ['lib/web-research/extraction-worker.ts', 'lib/web-research/extraction-failure.ts', 'lib/web-research/html-reader.ts',
      'lib/web-research/html-reader-worker.mjs', 'lib/web-research/html-content-worker.mjs', 'lib/web-research/html-visibility.mjs',
      'lib/web-research/html-section-worker.mjs', 'lib/web-research/html-section-scope.ts',
      'lib/web-research/pdf-reader.ts', 'lib/web-research/pdf-reader-worker.mjs', 'lib/web-research/pdf-text-scope.ts',
      'lib/web-research/unicode-prefix-worker.mjs',
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
 const section=await extractHtml('<main><h2 id="limits">Limits</h2><p>'+('This local section retains the qualification: retries may duplicate delivery. '.repeat(4))+'</p><h2>Next section</h2></main>','https://example.com/section',undefined,'limits');
 if(!section.truncated||section.text.includes('Next section'))throw Error('Compiled section scope lost');
 return Response.json({html:html.title,section:section.htmlSectionScope?.fragment,pdf:pdf.text,bibliography:bibliography.metadata.citation_title?.[0]?.value});
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
    const priorLog = console.log;
    let closing;
    try {
      console.log = () => { throw Error('Synthetic diagnostic sink unavailable'); };
      closing = running.close().then(() => { closed = true; });
    } finally { console.log = priorLog; }
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
    for (const file of ['lib/web-research/html-reader-worker.mjs', 'lib/web-research/pdf-reader-worker.mjs', 'lib/web-research/unicode-prefix-worker.mjs', 'lib/research/arxiv-bibliography-worker.mjs']) {
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
        { html: 'Cohort original', section: 'limits', pdf: 'Cohort PDF original', bibliography: 'Cohort metadata' });
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
      const active = get(childPort, { path: '/api/origin?delay=1&private=synthetic-private-receipt' });
      await new Promise((accept) => setTimeout(accept, 80));
      child.kill('SIGTERM');
      assert.equal((await active).status, 200);
      assert.deepEqual(await exited, { code: 143, signal: null });
      assert.match(stdout, /"httpDrained":true/);
      const observations = stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
        .filter(value => value.format === 'keryx-public-request-observation-v1');
      assert.deepEqual(observations.map(value => value.stage), ['drain-start', 'http-drained']);
      assert.equal(observations[0].seen, 1);
      assert.equal(observations[1].active, 0);
      assert.equal(observations[1].responsesFinished, 1);
      assert.equal(observations[1].closedBeforeFinish, 0);
      assert.deepEqual(observations[1].groups.map(value => [value.surface, value.method]), [['api', 'get-head']]);
      assert.doesNotMatch(JSON.stringify(observations), /synthetic-private-receipt|api\/origin|delay=/);
      for (const observation of observations) {
        assert.ok(Buffer.byteLength(JSON.stringify(observation)) < 8192);
        assert.ok(Object.values(observation.memory).every(value => Number.isSafeInteger(value) && value > 0));
      }
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

async function observedHttp(handler, run) {
  const observation = createPublicRequestObservation();
  const server = createServer((req, res) => { observation.observe(req, res); handler(req, res); });
  await new Promise(accept => server.listen(0, '127.0.0.1', accept));
  try { await run(server.address().port, observation); }
  finally {
    // Only this test-owned ephemeral native fixture, never a production role.
    server.closeAllConnections();
    await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
  }
}

function nativeRequest(port, { path = '/', method = 'GET', body = '', headers = {} } = {}) {
  return new Promise((accept, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; }); res.on('error', reject);
      res.once('end', () => accept({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('public request observation: preserves native private POST, error and HEAD responses without retaining their contents', { timeout: 10000 }, async () => {
  const sentinel = 'SYNTHETIC_PRIVATE';
  let bodyListeners;
  await observedHttp((req, res) => {
    bodyListeners = req.listenerCount('data');
    if (req.method !== 'POST') { res.statusCode = req.method === 'HEAD' ? 200 : 503; res.end(sentinel); return; }
    let body = ''; req.setEncoding('utf8'); req.on('data', chunk => { body += chunk; });
    req.once('end', () => {
      res.setHeader('x-fixture', 'unchanged');
      res.end(JSON.stringify({ target: req.url, auth: req.headers.authorization, cookie: req.headers.cookie, body }));
    });
  }, async (port, observation) => {
    const input = { path: `/api/ask/${sentinel}?receipt=${sentinel}`, method: 'POST', body: `${sentinel}-signature`,
      headers: { authorization: `Bearer ${sentinel}`, cookie: `${sentinel}=session` } };
    const response = await nativeRequest(port, input);
    assert.equal(response.status, 200); assert.equal(response.headers['x-fixture'], 'unchanged');
    assert.deepEqual(JSON.parse(response.body), { target: input.path, auth: input.headers.authorization, cookie: input.headers.cookie, body: input.body });
    assert.equal((await nativeRequest(port, { path: `/${sentinel}` })).status, 503);
    assert.deepEqual(await nativeRequest(port, { path: `/api/health?token=${sentinel}`, method: 'HEAD' }).then(value => [value.status, value.body]), [200, '']);
    assert.equal(bodyListeners, 0, 'Observation must never consume the request body');
    const snapshot = observation.snapshot('http-drained');
    assert.deepEqual([snapshot.seen, snapshot.active, snapshot.responsesFinished, snapshot.closedBeforeFinish], [3, 0, 3, 0]);
    assert.equal(snapshot.groups.find(value => value.surface === 'page').statusFamilies[4], 1);
    assert.doesNotMatch(JSON.stringify(snapshot), /SYNTHETIC_PRIVATE|signature|receipt=|Bearer|session/);
  });
});

test('public request observation: native SSE disconnect counts once as premature close and preserves streamed bytes', { timeout: 10000 }, async () => {
  let serverClosed;
  const closed = new Promise(accept => { serverClosed = accept; });
  await observedHttp((_req, res) => {
    res.once('close', () => setImmediate(serverClosed));
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: SYNTHETIC_PRIVATE\n\n');
  }, async (port, observation) => {
    const first = await new Promise((accept, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/api/ask?token=SYNTHETIC_PRIVATE', agent: false }, res => {
        res.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); });
        res.once('data', chunk => { accept({ bytes: chunk.toString(), status: res.statusCode, type: res.headers['content-type'] }); res.destroy(); });
      });
      req.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); }); req.end();
    });
    assert.deepEqual(first, { bytes: 'data: SYNTHETIC_PRIVATE\n\n', status: 200, type: 'text/event-stream' });
    await closed;
    const snapshot = observation.snapshot('http-drained');
    assert.deepEqual([snapshot.seen, snapshot.active, snapshot.responsesFinished, snapshot.closedBeforeFinish], [1, 0, 0, 1]);
    assert.deepEqual(snapshot.groups[0].statusFamilies, [0, 0, 0, 0, 0, 0]);
    assert.doesNotMatch(JSON.stringify(snapshot), /SYNTHETIC_PRIVATE|api\/ask|token=/);
  });
});

test('public request observation: native pending responses stay active until their own finish', { timeout: 10000 }, async () => {
  const held = [];
  await observedHttp((_req, res) => { held.push(res); res.flushHeaders(); }, async (port, observation) => {
    const open = (path, method) => new Promise((accept, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, method, agent: false }, res => {
        let body = ''; const ended = new Promise((done, fail) => {
          res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; }); res.on('error', fail); res.once('end', () => done(body));
        });
        accept({ ended, status: res.statusCode });
      }); req.on('error', reject); req.end();
    });
    const first = await open('/api/health?private=SYNTHETIC_PRIVATE', 'GET');
    const second = await open('/api/orders/SYNTHETIC_PRIVATE', 'POST');
    const pending = observation.snapshot('drain-start');
    assert.equal(pending.active, 2); assert.equal(pending.responsesFinished, 0);
    assert.deepEqual(pending.groups.map(value => [value.surface, value.method, value.active]), [['health', 'get-head', 1], ['api', 'post', 1]]);
    assert.ok(pending.groups.every(value => Number.isSafeInteger(value.busyForMs) && value.busyForMs >= 0));
    held[0].end('first original'); assert.equal(await first.ended, 'first original');
    assert.equal(observation.snapshot('drain-start').active, 1);
    assert.equal(observation.snapshot('drain-start').groups[0].busyForMs, 0);
    held[1].end('second original'); assert.equal(await second.ended, 'second original');
    const drained = observation.snapshot('http-drained');
    assert.deepEqual([drained.seen, drained.active, drained.responsesFinished, drained.closedBeforeFinish], [2, 0, 2, 0]);
    assert.doesNotMatch(JSON.stringify([pending, drained]), /SYNTHETIC_PRIVATE|orders|private=/);
  });
});

test('public request observation: many unique native targets retain only twelve fixed groups and a bounded record', { timeout: 10000 }, async () => {
  await observedHttp((_req, res) => res.end('original'), async (port, observation) => {
    for (let i = 0; i < 8; i++) for (const path of ['/api/health?x=', '/api/private/', '/_next/static/', '/private/'])
      for (const method of ['GET', 'POST', 'OPTIONS']) {
        const response = await nativeRequest(port, { path: `${path}SYNTHETIC_PRIVATE_${i}`, method });
        assert.equal(response.body, 'original');
      }
    const snapshot = observation.snapshot('http-drained');
    assert.deepEqual([snapshot.seen, snapshot.active, snapshot.responsesFinished, snapshot.closedBeforeFinish], [96, 0, 96, 0]);
    assert.equal(snapshot.groups.length, 12);
    assert.ok(snapshot.groups.every(value => ['health', 'api', 'asset', 'page'].includes(value.surface)
      && ['get-head', 'post', 'other'].includes(value.method) && value.seen === 8));
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 8192);
    assert.doesNotMatch(JSON.stringify(snapshot), /SYNTHETIC_PRIVATE|static\/|private\/|x=/);
  });
});

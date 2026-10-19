import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { assertMainSource, hostedChildEnvironment, copyBrowserCache, captureProcess, completeCapture, archiveEntries, packageCohort } from './prepare-hosted-immutable-release.mjs';

const commit = 'a'.repeat(40);
const publicInputs = {
  NEXT_PUBLIC_CIRCLE_APP_ID: '00000000-0000-4000-8000-000000000001',
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: '123456789-synthetic.apps.googleusercontent.com',
  KERYX_REGISTRY_ADDRESS: `0x${'1'.repeat(40)}`, NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: `0x${'1'.repeat(40)}`,
  KERYX_REGISTRY_READ_ADDRESS: `0x${'2'.repeat(40)}`, NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS: `0x${'2'.repeat(40)}`,
};
function fixture(t, createCandidate = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-hosted-test-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.match(path.basename(root), /^keryx-hosted-test-/); fs.rmSync(root, { recursive: true, force: true }); });
  const input = path.join(root, 'browsers'), candidate = path.join(root, commit);
  fs.mkdirSync(input);
  if (createCandidate) { fs.mkdirSync(candidate); fs.mkdirSync(path.join(candidate, 'preparation-scratch')); }
  fs.writeFileSync(path.join(input, 'chromium'), 'synthetic browser bytes');
  return { root, input, candidate };
}

test('manual source accepts only the complete current-main checkout identity', () => {
  assert.doesNotThrow(() => assertMainSource(commit, commit, commit));
  for (const value of ['main', commit.slice(0, 8), commit.toUpperCase(), `${commit}\n`, null, ['a']])
    assert.throws(() => assertMainSource(value, commit, commit));
  assert.throws(() => assertMainSource(commit, 'b'.repeat(40), commit));
  assert.throws(() => assertMainSource(commit, commit, 'b'.repeat(40)));
});

test('outer official command receives no runner tokens, storage, keys or Node injection', () => {
  const home = path.resolve(os.tmpdir()), inherited = { PATH: 'toolchain', ...publicInputs,
    GITHUB_TOKEN: 'synthetic', ACTIONS_RUNTIME_TOKEN: 'synthetic', NODE_OPTIONS: '--import=unsafe',
    KERYX_STORAGE_MANIFEST: '/funded', PRIVATE_KEY: 'synthetic', SUPABASE_URL: 'https://shared.invalid' };
  const actual = hostedChildEnvironment({ commit, home, inherited });
  assert.equal(actual.HOME, home); assert.equal(actual.PATH, 'toolchain');
  for (const [key, value] of Object.entries(publicInputs)) assert.equal(actual[key], value);
  for (const key of ['GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'NODE_OPTIONS', 'KERYX_STORAGE_MANIFEST', 'PRIVATE_KEY', 'SUPABASE_URL', 'PLAYWRIGHT_BROWSERS_PATH'])
    assert(!Object.hasOwn(actual, key));
  assert.throws(() => hostedChildEnvironment({ commit, home, inherited: { ...inherited, NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: `0x${'3'.repeat(40)}` } }));
});

test('browser input copies independently only into real helper-created scratch', t => {
  const f = fixture(t), result = copyBrowserCache(f.input, f.candidate);
  assert.deepEqual(result, { beforeTests: true, independentFileCopy: true, files: 1, bytes: 23 });
  const output = path.join(f.candidate, 'preparation-scratch', '.cache', 'ms-playwright', 'chromium');
  fs.writeFileSync(output, 'candidate only');
  assert.equal(fs.readFileSync(path.join(f.input, 'chromium'), 'utf8'), 'synthetic browser bytes');
  assert.throws(() => copyBrowserCache(f.input, f.candidate));
});

test('browser copy refuses a test phase already started and does not overwrite scratch', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.candidate, 'tests.log'), 'already running');
  assert.throws(() => copyBrowserCache(f.input, f.candidate), /TESTS_ALREADY_STARTED/);
  assert(!fs.existsSync(path.join(f.candidate, 'preparation-scratch', '.cache')));
});

test('real browser observer waits for scratch and preserves the original close/EOF boundary', { timeout: 5000 }, async t => {
  const f = fixture(t, false), events = [];
  let announce, copiedReady;
  const announced = new Promise(resolve => { announce = resolve; });
  const cacheReady = new Promise(resolve => { copiedReady = resolve; });
  const driver = fileURLToPath(new URL('./prepare-hosted-immutable-release.mjs', import.meta.url));
  const watcher = captureProcess(process.execPath, [driver, '--watch', f.input, f.candidate], {
    cwd: f.root, env: {}, directory: f.root, name: 'watcher', input: true,
    onLine(event) { events.push(event); if (event.event === 'watching') announce(event); if (event.event === 'cache-copied') copiedReady(event); },
  });
  t.after(() => { if (!watcher.child.stdin.destroyed) watcher.child.stdin.end(); });
  const first = await Promise.race([announced, watcher.done.then(() => null)]);
  assert.equal(first?.event, 'watching'); assert(!fs.existsSync(f.candidate));
  fs.mkdirSync(f.candidate); fs.mkdirSync(path.join(f.candidate, 'preparation-scratch'));
  // Closing stdin emulates actual official close only after the real copy event.
  const copied = await Promise.race([cacheReady, watcher.done.then(() => null)]);
  watcher.child.stdin.end();
  const capture = await watcher.done;
  assert(copied?.beforeTests); assert(copied?.independentFileCopy); assert(completeCapture(capture));
});

test('browser input refuses links escaping its installed cache', t => {
  const f = fixture(t), outside = path.join(f.root, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret'), 'synthetic forbidden');
  try { fs.symlinkSync(outside, path.join(f.input, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (process.platform === 'win32' && e.code === 'EPERM') { t.skip('Linux checks link containment'); return; } throw e; }
  assert.throws(() => copyBrowserCache(f.input, f.candidate), /BROWSER_CACHE_LINK_ESCAPE/);
  assert(!fs.existsSync(path.join(f.candidate, 'preparation-scratch', '.cache')));
});

test('actual process capture requires exit zero and full stream EOF', async t => {
  const f = fixture(t), env = { PATH: process.env.PATH ?? '' };
  const good = await captureProcess(process.execPath, ['-e', "process.stdout.write('out');process.stderr.write('err')"], { cwd: f.root, env, directory: f.root, name: 'good' }).done;
  assert(completeCapture(good)); assert.equal(good.exitCode, 0); assert.equal(good.signal, null);
  assert.equal(fs.readFileSync(path.join(f.root, 'good.stdout.log'), 'utf8'), 'out');
  assert.equal(fs.readFileSync(path.join(f.root, 'good.stderr.log'), 'utf8'), 'err');
  const bad = await captureProcess(process.execPath, ['-e', "process.stderr.write('actual failure');process.exitCode=7"], { cwd: f.root, env, directory: f.root, name: 'bad' }).done;
  assert(!completeCapture(bad)); assert.equal(bad.exitCode, 7); assert(bad.fullEOF);
  for (const altered of [{ ...good, fullEOF: false }, { ...good, signal: 'SIGTERM' }, { ...good, exitObserved: false }]) assert(!completeCapture(altered));
});

test('capture overflow drains the real process and refuses acceptance', async t => {
  const f = fixture(t);
  const r = await captureProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(10000))"], { cwd: f.root, env: {}, directory: f.root, name: 'overflow', limit: 32 }).done;
  assert.equal(r.exitCode, 0); assert(r.fullEOF); assert(r.overflow); assert(!completeCapture(r));
  assert.equal(r.logs.stdout.observedBytes, 10000); assert.equal(r.logs.stdout.retainedBytes, 32);
});

test('spawn errors remain real refused captures', async t => {
  const f = fixture(t);
  const r = await captureProcess(path.join(f.root, 'does-not-exist'), [], { cwd: f.root, env: {}, directory: f.root, name: 'missing' }).done;
  assert(r.errors.includes('SPAWN')); assert(!r.exitObserved); assert(!completeCapture(r));
});

test('packaging transfers exactly the source and three original receipts, preserving links and modes', t => {
  if (process.platform !== 'linux') { t.skip('Actual GNU tar link/mode behavior is exercised in Linux CI'); return; }
  const f = fixture(t), source = path.join(f.candidate, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, '.hidden'), 'source bytes'); fs.chmodSync(path.join(source, '.hidden'), 0o400);
  fs.writeFileSync(path.join(source, 'executable'), '#!/bin/sh\n'); fs.chmodSync(path.join(source, 'executable'), 0o500);
  fs.symlinkSync('.hidden', path.join(source, 'contained-link'));
  const originals = {};
  for (const name of ['source-manifest.json', 'artifact-inspection.json', 'preparation.json']) {
    originals[name] = Buffer.from(`{"synthetic":"${name}"}\n`); fs.writeFileSync(path.join(f.candidate, name), originals[name]);
  }
  fs.writeFileSync(path.join(f.candidate, 'tests.log'), 'must not transfer');
  fs.writeFileSync(path.join(f.candidate, 'preparation-scratch', 'not-cohort'), 'must not transfer');
  const archive = path.join(f.root, 'cohort.tar.gz');
  const receipt = packageCohort({ releases: f.root, commit, archive, env: { PATH: process.env.PATH } });
  assert.deepEqual(receipt.entries, archiveEntries(commit));
  assert.equal(receipt.sha256, createHash('sha256').update(fs.readFileSync(archive)).digest('hex'));
  const extracted = path.join(f.root, 'extracted'); fs.mkdirSync(extracted);
  execFileSync('tar', ['-xzf', archive, '-C', extracted]);
  const candidate = path.join(extracted, commit);
  assert.deepEqual(fs.readdirSync(candidate).sort(), ['artifact-inspection.json', 'preparation.json', 'source', 'source-manifest.json']);
  for (const [name, bytes] of Object.entries(originals)) assert.deepEqual(fs.readFileSync(path.join(candidate, name)), bytes);
  assert.equal(fs.readlinkSync(path.join(candidate, 'source', 'contained-link')), '.hidden');
  assert.equal(fs.statSync(path.join(candidate, 'source', 'executable')).mode & 0o777, 0o500);
  assert.equal(fs.statSync(path.join(candidate, 'source', '.hidden')).mode & 0o777, 0o400);
  assert.throws(() => packageCohort({ releases: f.root, commit, archive, env: {} }), /EEXIST/);
});

test('workflow stays manual/read-only and never forwards runner authentication to preparation', () => {
  const file = fileURLToPath(new URL('../.github/workflows/hosted-immutable-preparation.yml', import.meta.url));
  const workflow = fs.readFileSync(file, 'utf8');
  assert.match(workflow, /workflow_dispatch:/); assert(!/^\s+(?:push|pull_request|schedule):/m.test(workflow));
  assert.match(workflow, /persist-credentials: false/); assert.match(workflow, /contents: read/); assert.match(workflow, /actions: read/);
  assert.match(workflow, /unshare --net/); assert.match(workflow, /--bounding-set=-all --no-new-privs/);
  assert(!/secrets\.|ssh |scp |gh release|cancel-in-progress: true/.test(workflow));
  assert.match(workflow, /retention-days: 3/);
});

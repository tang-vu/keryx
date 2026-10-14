import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  preflightNpm, preflightRegistry, readNpmPackage, readOfficialEntry, registryVersionUrl, validateNpmReadback,
  validateRegistryReadback, validateRelease, verifyRegistry,
} from './mcp-registry-release.mjs';

const manifest = JSON.parse(readFileSync(new URL('../mcp/server.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../mcp/package.json', import.meta.url), 'utf8'));
const context = { version: pkg.version, repository: 'tang-vu/keryx', ref: 'refs/heads/main' };
const clone = (value) => structuredClone(value);
const entry = (server = manifest, isLatest = true) => ({
  server: clone(server), _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest } },
});
const pack = { name: pkg.name, version: pkg.version, filename: `${pkg.name}-${pkg.version}.tgz`, integrity: `sha512-${'a'.repeat(86)}==` };
const published = { name: pkg.name, version: pkg.version, mcpName: pkg.mcpName, repository: pkg.repository,
  dist: { integrity: pack.integrity, tarball: `https://registry.npmjs.org/${pkg.name}/-/${pack.filename}` } };

test('committed release matches repository-owned namespace and exact npm/remote descriptors', () => {
  validateRelease(manifest, pkg, context);
  validateNpmReadback(published, [pack], pkg);
  assert.equal(registryVersionUrl(manifest), `https://registry.modelcontextprotocol.io/v0.1/servers/io.github.tang-vu%2Fkeryx/versions/${pkg.version}`);
});

test('rejects namespace, version, remote, package, extra manifest fields and workflow context drift', () => {
  for (const mutate of [
    (m) => { m.name = 'io.github.minhvu2212/keryx'; },
    (m) => { m.version = '0.0.0'; },
    (m) => { m.remotes[0].url = 'https://other.example/mcp'; },
    (m) => { m.remotes.push(clone(m.remotes[0])); },
    (m) => { m.packages[0].version = '0.0.0'; },
    (m) => { m.packages[0].registryBaseUrl = 'https://mirror.example'; },
    (m) => { m.packages[0].transport.type = 'streamable-http'; },
    (m) => { m._meta = { authority: 'invented' }; },
  ]) {
    const changed = clone(manifest); mutate(changed);
    assert.throws(() => validateRelease(changed, pkg, context));
  }
  for (const changed of [{ repository: 'minhvu2212/keryx' }, { ref: 'refs/heads/feature' }, { version: '0.0.0' }, { version: 'latest' }]) {
    assert.throws(() => validateRelease(manifest, pkg, { ...context, ...changed }));
  }
  const changed = clone(pkg); changed.mcpName = 'io.github.other/keryx';
  assert.throws(() => validateRelease(manifest, changed, context));
});

test('npm must match verified archive integrity and prove same namespace before registry publication', () => {
  for (const mutate of [
    (p) => { p.version = '0.0.0'; }, (p) => { p.mcpName = 'io.github.other/keryx'; },
    (p) => { p.dist.integrity = 'sha512-different'; },
    (p) => { p.dist.tarball = 'https://mirror.example/package.tgz'; },
    (p) => { p.repository.url = 'git+https://github.com/other/keryx.git'; },
  ]) {
    const changed = clone(published); mutate(changed);
    assert.throws(() => validateNpmReadback(changed, [pack], pkg));
  }
  assert.throws(() => validateNpmReadback(published, [], pkg));
});

test('preflight skips matching existing publication, permits definite 404 and refuses uncertainty/conflicts', async () => {
  assert.equal(await preflightRegistry(manifest, async (url) => {
    assert.equal(url, `${registryVersionUrl(manifest)}?include_deleted=true`);
    return entry();
  }), 'already-published');
  assert.equal(await preflightRegistry(manifest, async () => null), 'absent');
  await assert.rejects(preflightRegistry(manifest, async () => { throw new Error('timeout'); }));
  const conflict = entry(); conflict.server.remotes[0].url = 'https://other.example/mcp';
  await assert.rejects(preflightRegistry(manifest, async () => conflict));
  const inactive = entry(); inactive._meta['io.modelcontextprotocol.registry/official'].status = 'deleted';
  assert.throws(() => validateRegistryReadback(manifest, inactive));
  await assert.rejects(preflightRegistry(manifest, async () => inactive));
});

test('npm recovery permits absence or matching immutable version, refuses conflict and unknown read', async () => {
  assert.equal(await preflightNpm(pkg, [pack], async () => null), 'absent');
  assert.equal(await preflightNpm(pkg, [pack], async () => published), 'already-published');
  const conflict = clone(published); conflict.dist.integrity = 'sha512-different';
  await assert.rejects(preflightNpm(pkg, [pack], async () => conflict));
  await assert.rejects(preflightNpm(pkg, [pack], async () => { throw new Error('unknown'); }));
  assert.equal(await readNpmPackage(pkg, async (url, options) => {
    assert.equal(url, `https://registry.npmjs.org/keryx-mcp/${pkg.version}`);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(null, { status: 404 });
  }), null);
  await assert.rejects(readNpmPackage(pkg, async () => new Response('provider body', { status: 503 })), /Public npm registry readback unavailable; do not republish/);
  await assert.rejects(readNpmPackage(pkg, async () => Response.json(null)), /Public npm registry readback unavailable; do not republish/);
});

test('verification retries bounded reads for propagation and requires exact active latest manifest', async () => {
  let calls = 0;
  let sleeps = 0;
  await verifyRegistry(manifest, { attempts: 2, sleep: async () => { sleeps++; }, read: async () => {
    calls++;
    return calls <= 2 ? null : entry();
  } });
  assert.equal(calls, 4); assert.equal(sleeps, 1);
  await assert.rejects(verifyRegistry(manifest, { attempts: 2, sleep: async () => {}, read: async () => null }), /Do not republish/);
  await assert.rejects(verifyRegistry(manifest, { attempts: 1, read: async () => entry(manifest, false) }));
  await assert.rejects(verifyRegistry(manifest, { attempts: 13 }));
});

test('public reads are fixed HTTPS endpoints with deadline, no redirects, finite bodies and sanitized failures', async () => {
  const url = registryVersionUrl(manifest);
  const read = await readOfficialEntry(url, async (observed, options) => {
    assert.equal(observed, url); assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    return Response.json(entry());
  });
  validateRegistryReadback(manifest, read);
  assert.equal(await readOfficialEntry(url, async () => new Response(null, { status: 404 })), null);
  for (const response of [new Response('private provider body', { status: 503 }), new Response('x'.repeat(262_145)), new Response('invalid json'), Response.json(null), Response.json([])]) {
    await assert.rejects(readOfficialEntry(url, async () => response), /^Error: Official MCP Registry readback unavailable; do not republish$/);
  }
  await assert.rejects(readOfficialEntry('https://other.example/server', async () => { throw new Error('must not fetch'); }));
});

test('immutable MCP asset publication uses exact names without rg and refuses uncertain reads or byte drift', async t => {
  const workflow = readFileSync(new URL('../.github/workflows/mcp-release.yml', import.meta.url), 'utf8');
  // Exercise the actual shell branch, never a live gh command or publication.
  const branch = workflow.slice(workflow.indexOf('          package=$(find mcp-assets'))
    .split('\n').map(line => line.replace(/^ {10}/, '')).join('\n');
  assert(branch.startsWith('package=$(find mcp-assets'));
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const cases = [
    { name: 'empty release', assets: '', events: ['view', 'upload'] },
    { name: 'exact existing package', assets: 'other.txt\nkeryx-mcp-0.0.0.tgz\nlast.txt', events: ['view', 'download'] },
    { name: 'prefix and suffix are different assets', assets: 'prefix-keryx-mcp-0.0.0.tgz\nkeryx-mcp-0.0.0.tgz.source.json', events: ['view', 'upload'] },
    { name: 'release read fails', failure: 'view', assets: '', events: ['view'], fails: true },
    { name: 'gh tool unavailable', failure: 'missing', assets: '', events: ['view'], fails: true },
    { name: 'existing download fails', failure: 'download', assets: 'keryx-mcp-0.0.0.tgz', events: ['view', 'download'], fails: true },
    { name: 'existing package bytes differ', failure: 'package', assets: 'keryx-mcp-0.0.0.tgz', events: ['view', 'download'], fails: true },
    { name: 'existing provenance bytes differ', failure: 'manifest', assets: 'keryx-mcp-0.0.0.tgz', events: ['view', 'download'], fails: true },
  ];
  for (const scenario of cases) await t.test(scenario.name, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'keryx-mcp-asset-test-'));
    try {
      mkdirSync(path.join(root, 'bin')); mkdirSync(path.join(root, 'mcp-assets'));
      writeFileSync(path.join(root, 'mcp-assets/keryx-mcp-0.0.0.tgz'), 'synthetic immutable archive');
      writeFileSync(path.join(root, 'mcp-assets/keryx-mcp-0.0.0.tgz.source.json'), 'synthetic exact-source provenance');
      writeFileSync(path.join(root, 'asset-names.txt'), scenario.assets);
      writeFileSync(path.join(root, 'branch.sh'), branch);
      const gh = path.join(root, 'bin/gh'), rg = path.join(root, 'bin/rg');
      writeFileSync(gh, `#!/bin/bash
set -e
[[ "$1" == release ]]
printf '%s\\n' "$2" >> events.txt
case "$2" in
  view) [[ "$MCP_TEST_FAILURE" != view ]] || exit 23
    [[ "$MCP_TEST_FAILURE" != missing ]] || exit 127
    cat asset-names.txt ;;
  download) [[ "$MCP_TEST_FAILURE" != download ]] || exit 24
    cp mcp-assets/* existing/
    [[ "$MCP_TEST_FAILURE" != package ]] || printf changed >> existing/keryx-mcp-0.0.0.tgz
    [[ "$MCP_TEST_FAILURE" != manifest ]] || printf changed >> existing/keryx-mcp-0.0.0.tgz.source.json ;;
  upload) ;;
  *) exit 99 ;;
esac
`);
      // Simulate the observed missing-tool exit even if the developer has rg installed.
      writeFileSync(rg, '#!/bin/bash\nprintf "rg\\n" >> events.txt\nexit 127\n');
      chmodSync(gh, 0o755); chmodSync(rg, 0o755);
      const bin = path.join(root, 'bin').replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
      const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', 'branch.sh'], {
        cwd: root, encoding: 'utf8', timeout: 10_000,
        env: { PATH: `${bin}:/usr/bin:/bin`, ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
          RELEASE_TAG: 'v0.0.0-synthetic', MCP_TEST_FAILURE: scenario.failure ?? '' },
      });
      assert.ifError(result.error); assert.equal(result.signal, null);
      assert.equal(result.status === 0, !scenario.fails, result.stderr);
      const events = readFileSync(path.join(root, 'events.txt'), 'utf8').trim().split('\n');
      assert.deepEqual(events, scenario.events);
      assert(!events.includes('rg'), 'No optional tool participates in publication admission');
    } finally {
      assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
      assert.match(path.basename(root), /^keryx-mcp-asset-test-/);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

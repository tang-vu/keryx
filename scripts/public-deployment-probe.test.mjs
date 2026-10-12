import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { deploymentOptions, verifyPublicDeployment } from './public-deployment-probe.mjs';
import { parseDeploymentArgs } from './verify-public-deployment.mjs';

const sha = 'a'.repeat(40), now = Date.parse('2026-10-12T08:00:00.000Z');
const stamp = new Date(now).toISOString();
const options = { expectedCommit: sha, origin: 'https://example.com' };
function fixtures() {
  return {
    '/api/health': { name: 'keryx', ok: true, status: 'operational', db: 'ok', network: 'arc',
      settles: 'real', commit: sha.slice(0, 8), time: stamp,
      monitoring: { state: 'recent', checks: ['registry', 'dispatches', 'settlement', 'reconciliation']
        .map(name => ({ name, state: 'recent', checkedAt: stamp, maxAgeSeconds: 1800 })) } },
    '/api/metrics': { metricsScope: { cohort: 'mixed-all-origins', period: 'all-time', network: 'not-row-partitioned' },
      usage: { endpoint: '/api/usage', unclassifiedIsOutside: false }, metrics: { totalQueries: 0, totalPayments: 0 } },
    '/api/usage': { basis: 'complete-bounded-database-window', complete: true, network: 'eip155:5042',
      period: 'all', since: '1970-01-01T00:00:00.000Z', until: stamp,
      columns: ['outside', 'team', 'scripted', 'unknown'].map(cohort => ({ cohort, researchRuns: 0, settledPayments: 0, settledMicros: '0' })) },
  };
}
function transport(records, requests = []) {
  return async (url, init) => {
    requests.push({ url: String(url), init });
    const path = new URL(url).pathname;
    return path in records ? Response.json(records[path]) : new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
  };
}
const probe = records => verifyPublicDeployment(options, { now: () => now, fetchImpl: transport(records) });
const find = (report, id) => report.checks.find(check => check.id === id);

test('zero usage is a valid observation, with explicit prefix and proof limits and anonymous GETs', async () => {
  const requests = [], report = await verifyPublicDeployment(options, { now: () => now, fetchImpl: transport(fixtures(), requests) });
  assert.equal(report.status, 'pass');
  assert.equal(report.warnings, 0);
  assert.match(find(report, 'commit').detail, /8-character.*prefix/);
  assert.match(find(report, 'metrics').detail, /not outside-user/);
  assert.equal(requests.length, 6);
  for (const { url, init } of requests) {
    assert.equal(new URL(url).origin, options.origin);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    assert.deepEqual(Object.keys(init.headers).sort(), ['Accept', 'User-Agent']);
    assert.equal(init.body, undefined);
  }
  assert.equal(new URL(requests.find(row => row.url.includes('/api/usage')).url).searchParams.get('network'), 'eip155:5042');
});

test('healthy HTTP cannot hide a different commit, network or incomplete feature', async () => {
  for (const [path, mutate, id] of [
    ['/api/health', data => { data.commit = 'b'.repeat(8); }, 'commit'],
    ['/api/health', data => { data.commit = 'aaa'; }, 'commit'],
    ['/api/health', data => { data.network = 'arcTestnet'; }, 'health'],
    ['/api/health', data => { data.status = 'degraded'; }, 'health'],
    ['/api/health', data => { data.time = new Date(now - 120001).toISOString(); }, 'health'],
    ['/api/health', data => { data.settles = 'offline'; }, 'health'],
    ['/api/usage', data => { data.network = 'eip155:5042002'; }, 'usage'],
    ['/api/usage', data => { data.complete = false; }, 'usage'],
    ['/api/usage', data => { data.columns[1].cohort = 'outside'; }, 'usage'],
    ['/api/usage', data => { data.columns[0].settledMicros = '0.1'; }, 'usage'],
    ['/api/metrics', data => { delete data.metricsScope; }, 'metrics'],
  ]) {
    const data = fixtures(); mutate(data[path]); const report = await probe(data);
    assert.equal(report.status, 'fail', id);
    assert.equal(find(report, id).status, 'fail', id);
  }
});

test('testnet stays explicitly selected, and offline mode is not promoted to real settlement', async () => {
  const records = fixtures(); records['/api/health'].network = 'arcTestnet';
  records['/api/health'].settles = 'offline'; records['/api/usage'].network = 'eip155:5042002';
  const report = await verifyPublicDeployment({ ...options, network: 'arcTestnet' }, { now: () => now, fetchImpl: transport(records) });
  assert.equal(report.status, 'pass');
  assert.equal(report.network, 'arcTestnet');
  assert.match(find(report, 'health').detail, /availability remain unprobed/);
});

test('missing, duplicate or future monitoring is visible; strict mode refuses it', async () => {
  for (const mutate of [data => { delete data.monitoring; },
    data => { data.monitoring.checks[0].checkedAt = new Date(now + 1).toISOString(); },
    data => { data.monitoring.checks[1].name = 'registry'; },
    data => { data.monitoring.checks[0].checkedAt = new Date(now - 1800001).toISOString(); }]) {
    const records = fixtures(); mutate(records['/api/health']);
    const warning = await probe(records);
    assert.equal(warning.status, 'pass'); assert.equal(find(warning, 'monitoring').status, 'warn');
    const strict = await verifyPublicDeployment({ ...options, requireMonitoring: true }, { now: () => now, fetchImpl: transport(records) });
    assert.equal(strict.status, 'fail'); assert.equal(find(strict, 'monitoring').status, 'fail');
  }
});

test('unreachable, redirected, oversized or deceptive successful responses fail without printing external bodies', async () => {
  for (const response of [
    () => new Response('private upstream detail', { status: 403 }),
    () => new Response('private upstream detail', { status: 302, headers: { Location: 'https://other.example/' } }),
    () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{broken private detail', { headers: { 'content-type': 'application/json' } }),
    () => Response.json({ text: 'x'.repeat(256 * 1024) }),
    () => { throw new Error('secret exception'); },
  ]) {
    const report = await verifyPublicDeployment(options, { now: () => now, fetchImpl: response });
    assert.equal(report.status, 'fail');
    assert.doesNotMatch(JSON.stringify(report), /private upstream|broken private|secret exception|other.example/);
  }
});

test('deadlines also bound an injected transport that ignores cancellation', async () => {
  const started = Date.now();
  const report = await verifyPublicDeployment({ ...options, timeoutMs: 100 }, { fetchImpl: () => new Promise(() => {}) });
  assert.equal(report.status, 'fail');
  assert.ok(Date.now() - started < 2000);
  assert.ok(report.checks.every(check => /timed out/.test(check.detail)));
});

test('invalid CLI inputs are rejected before network I/O, with no secret values echoed', () => {
  for (const origin of ['ftp://example.com', 'http://example.com', 'https://user:secret@example.com',
    'https://example.com/api', 'https://example.com?token=secret', 'https://example.com/#secret']) {
    assert.throws(() => deploymentOptions({ ...options, origin }));
  }
  assert.equal(deploymentOptions({ ...options, origin: 'http://127.0.0.1:3939' }).origin, 'http://127.0.0.1:3939');
  for (const args of [[], ['--expect-commit', sha, '--json', '--json'], ['--expect-commit', sha, '--origin'],
    ['--expect-commit', sha, '--timeout-ms', '0'], ['--expect-commit', sha, '--network', 'other'], ['--secret', 'secret']]) {
    assert.throws(() => parseDeploymentArgs(args));
  }
});

test('real CLI probes only fixture GETs and exits nonzero for an unavailable public feature', async t => {
  const requests = [], records = fixtures();
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/api/health') { records[path].time = new Date().toISOString(); records[path].monitoring.state = 'incomplete'; }
    if (path === '/api/usage') { response.writeHead(503, { 'content-type': 'application/json' }); response.end('{"error":"usage_unavailable"}'); return; }
    response.writeHead(200, { 'content-type': path in records ? 'application/json' : 'text/html' });
    response.end(path in records ? JSON.stringify(records[path]) : '<html>Fixture only</html>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./verify-public-deployment.mjs', import.meta.url)),
    '--origin', `http://127.0.0.1:${server.address().port}`, '--expect-commit', sha, '--json'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1, stderr);
  const report = JSON.parse(stdout); assert.equal(find(report, 'usage').httpStatus, 503);
  assert.equal(find(report, 'commit').status, 'pass');
  assert.equal(requests.length, 6); assert.ok(requests.every(row => row.method === 'GET'));
});

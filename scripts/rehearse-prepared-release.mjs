// Actual prepared Next runtime, isolated testnet/offline storage and loopback only.
// This is an idle public-web handover rehearsal, not financial-worker acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyImmutableArtifact } from './immutable-release-staging.mjs';
import { preparationEnvironment } from './prepare-immutable-release.mjs';

const program = `
  const { pathToFileURL } = await import('node:url');
  const { startNextPublicServer, installNextPublicShutdown } = await import(pathToFileURL(process.argv[2]));
  const running = await startNextPublicServer({ dir: process.argv[3], port: 3940, useBuildConfig: true });
  installNextPublicShutdown(running);
  process.on('message', message => { if (message === 'drain') process.emit('SIGTERM'); });
  process.send({ ...running.receipt, source: process.argv[3] });
`;

export async function startPreparedPublicRole(source, env, scratch, label, spawnRole = spawn) {
  const logFile = path.join(scratch, `${label}.log`);
  // Refuse log creation before there is an owned process to drain.
  const log = fs.openSync(logFile, 'wx', 0o600);
  let child;
  try { child = spawnRole(process.execPath, ['--input-type=module', '-e', program,
    // argv[1] must identify this eval entry, not the imported module. Otherwise
    // its direct-invocation guard also starts an unconfigured second server.
    'keryx-prepared-role-rehearsal',
    path.join(source, 'scripts/next-public-server.mjs'), source], {
    cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  }); } catch (error) { fs.closeSync(log); throw error; }
  const limit = 4 * 1024 * 1024, observedHash = createHash('sha256'), errors = new Set();
  let observedBytes = 0, writtenBytes = 0, closed = false, writeFailed = false;
  let retained = Buffer.alloc(0);
  const issue = (error, fallback) => errors.add(String(error?.code ?? fallback).slice(0, 64));
  for (const stream of [child.stdout, child.stderr]) {
    stream.once('error', error => issue(error, 'PIPE_READ_FAILED'));
    stream.on('data', bytes => {
      bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      observedBytes += bytes.length; observedHash.update(bytes);
      const count = Math.min(bytes.length, limit - writtenBytes);
      if (!writeFailed && count > 0) try {
        // Count Buffer bytes and handle partial writes. Fixed offsets never put
        // more than limit bytes in the file, even if a write fails partway.
        let offset = 0;
        while (offset < count) {
          const written = fs.writeSync(log, bytes, offset, count - offset, writtenBytes);
          if (!written) throw Error('EMPTY_LOG_WRITE');
          offset += written; writtenBytes += written;
        }
      } catch (error) { writeFailed = true; issue(error, 'LOG_WRITE_FAILED'); }
      // Continue consuming/hash-counting both pipes after the cap or an error.
      // Never terminate a role to satisfy an output bound.
    });
  }
  const capture = () => ({ format: 'keryx-prepared-role-output-v1', logFile, limitBytes: limit,
    observedBytes, retainedBytes: retained.length, overflowBytes: Math.max(0, observedBytes - limit),
    droppedBytes: observedBytes - retained.length, closed,
    stdoutEof: child.stdout.readableEnded, stderrEof: child.stderr.readableEnded,
    complete: closed && child.stdout.readableEnded && child.stderr.readableEnded && !errors.size &&
      retained.length === Math.min(observedBytes, limit),
    errors: [...errors].sort(), observedSha256: observedHash.copy().digest('hex'),
    retainedSha256: createHash('sha256').update(retained).digest('hex') });
  let processError, exit;
  const exited = new Promise((resolve, reject) => {
    child.once('error', error => { processError = error; issue(error, 'PROCESS_FAILED'); });
    child.once('exit', (code, signal) => { exit = { code, signal }; });
    // Child exit does not establish stdout/stderr EOF. Close follows both pipe
    // closures, so buffered closed-receipt bytes remain part of the raw log.
    child.once('close', (code, signal) => {
      try { fs.fsyncSync(log); } catch (error) { issue(error, 'LOG_SYNC_FAILED'); }
      try { fs.closeSync(log); } catch (error) { issue(error, 'LOG_CLOSE_FAILED'); }
      try {
        if (fs.statSync(logFile).size > limit) throw Error('LOG_LIMIT_EXCEEDED');
        retained = fs.readFileSync(logFile);
      } catch (error) { issue(error, 'LOG_READ_FAILED'); }
      closed = true;
      if (processError) {
        processError.rehearsal = { phase: 'before-readiness', exit: exit ?? { code, signal }, source, capture: capture() };
        reject(processError);
      }
      else resolve(exit ?? { code, signal });
    });
  });
  exited.catch(() => {});
  const ready = await Promise.race([
    new Promise(resolve => child.once('message', resolve)),
    exited.then(exit => {
      const error = Error('Prepared public server exited before readiness; inspect its retained output');
      error.rehearsal = { phase: 'before-readiness', exit, source, logFile,
        outputBytes: retained.length, outputSha256: createHash('sha256').update(retained).digest('hex'),
        outputTail: retained.subarray(-8192).toString('utf8'), capture: capture() };
      throw error;
    }),
  ]);
  assert.equal(ready.ready, true); assert.equal(ready.source, source);
  assert.equal(ready.physicalHost, '127.0.0.1'); assert.equal(ready.physicalPort, 3940);
  return { child, exited, output: () => retained.toString('utf8'), capture };
}

export async function readPreparedPublicHealth(commit) {
  // Pinned Node fetch drops Host overrides. Preserve the exact trusted ingress
  // metadata with the same Node HTTP client used by the public-origin fixture.
  const response = await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: 3940, path: '/api/health', agent: false,
      headers: { Host: 'keryx.cc', 'X-Forwarded-Proto': 'https' } }, res => {
      const chunks = []; let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 64 * 1024) res.destroy(Error('Prepared health response exceeded bound'));
        else chunks.push(chunk);
      });
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(30000, () => req.destroy(Error('Prepared health request timed out')));
    req.once('error', reject); req.end();
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.commit, commit); assert.equal(body.network, 'arcTestnet'); assert.equal(body.settles, 'offline');
  assert.equal(body.db, 'ok');
  return { commit: body.commit, network: body.network, settles: body.settles,
    status: body.status, a2aJobs: body.a2aJobs, a2aWorker: body.a2aWorker };
}

export async function drainPreparedPublicRole(role) {
  // Native Windows signals terminate immediately. IPC calls the actual registered
  // application signal handler; Linux uses the real SIGTERM delivery instead.
  if (process.platform === 'win32') role.child.send('drain');
  else role.child.kill('SIGTERM');
  const exited = await role.exited;
  assert.equal(exited.code, 143); assert.equal(exited.signal, null);
  const capture = role.capture();
  const closed = role.output().split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).find(value => value?.format === 'keryx-next-public-server-closed-v1');
  if (!capture.complete || capture.overflowBytes || capture.droppedBytes || capture.errors.length) {
    const error = Error('Prepared rehearsal output refused after owned role close; retain capture evidence');
    error.rehearsal = { phase: 'after-role-close', exit: exited, capture, closedReceipt: closed ?? null };
    throw error;
  }
  assert.equal(closed?.httpDrained, true); assert.equal(closed?.pid, role.child.pid);
  return closed;
}

export async function rehearsePreparedRelease(options) {
  const before = verifyImmutableArtifact(options);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-prepared-rehearsal-'));
  const source = path.join(options.candidate, 'source');
  const env = preparationEnvironment({ commit: before.commit, scratch });
  const initialStarted = performance.now();
  let active;
  try {
  const predecessor = await startPreparedPublicRole(source, env, scratch, 'predecessor'); active = predecessor;
  const initial = await readPreparedPublicHealth(before.commit);
  const initialReadyMs = Math.round(performance.now() - initialStarted);
  const startedAt = new Date().toISOString(), maintenanceStarted = performance.now();
  let previousClosed;
  try { previousClosed = await drainPreparedPublicRole(predecessor); }
  finally { if (predecessor.capture().closed) active = undefined; }
  const drainedAt = performance.now();
  // Rehash all exact candidate bytes at the actual handover boundary.
  const after = verifyImmutableArtifact(options); assert.deepEqual(after, before);
  const replacement = await startPreparedPublicRole(source, env, scratch, 'replacement'); active = replacement;
  const final = await readPreparedPublicHealth(before.commit);
  const handoverMs = Math.round(performance.now() - maintenanceStarted);
  const postDrainReadinessMs = Math.round(performance.now() - drainedAt);
  let replacementClosed;
  try { replacementClosed = await drainPreparedPublicRole(replacement); }
  finally { if (replacement.capture().closed) active = undefined; }
  const receipt = { format: 'keryx-prepared-next-rehearsal-v1', productionAdmitted: false,
    evidence: 'actual prepared Next public server; same-cohort idle restart; isolated testnet/offline SQLite',
    commit: before.commit, tree: before.tree, buildId: before.buildId,
    artifactInspectionSha256: options.artifactInspectionSha256, artifactDigest: before.artifactDigest,
    platform: process.platform, node: process.versions.node, startedAt, initialReadyMs,
    handoverMs, postDrainReadinessMs, initial, final, previousClosed, replacementClosed,
    output: { predecessor: predecessor.capture(), replacement: replacement.capture() },
    nativeSignal: process.platform !== 'win32', scratch,
    financialWorkerDrainAccepted: false, rollbackAccepted: false,
    productionAvailabilityTargetAccepted: false, schedulesChanged: false };
  const file = path.join(options.candidate, 'runtime-rehearsal.json');
  fs.writeFileSync(file, JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 });
  return receipt;
  } finally {
    // Failed health/identity assertions must still positively drain the owned
    // isolated role. Never force termination or remove its diagnostic/store files.
    if (active) await drainPreparedPublicRole(active);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [candidate, sourceManifestSha256, artifactInspectionSha256] = process.argv.slice(2);
  if (process.argv.length !== 5) { console.error('Expected CANDIDATE SOURCE_SHA256 ARTIFACT_SHA256'); process.exitCode = 1; }
  else rehearsePreparedRelease({ candidate, sourceManifestSha256, artifactInspectionSha256 })
    .then(value => console.log(JSON.stringify(value)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

// Actual prepared Next runtime, isolated testnet/offline storage and loopback only.
// This is an idle public-web handover rehearsal, not financial-worker acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyImmutableArtifact } from './immutable-release-staging.mjs';
import { preparationEnvironment } from './prepare-immutable-release.mjs';

const program = `
  const { pathToFileURL } = await import('node:url');
  const { startNextPublicServer, installNextPublicShutdown } = await import(pathToFileURL(process.argv[1]));
  const running = await startNextPublicServer({ dir: process.argv[2], port: 3940 });
  installNextPublicShutdown(running);
  process.on('message', message => { if (message === 'drain') process.emit('SIGTERM'); });
  process.send({ ...running.receipt, source: process.argv[2] });
`;

async function start(source, env, scratch, label) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', program,
    path.join(source, 'scripts/next-public-server.mjs'), source], {
    cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  let output = '';
  const log = fs.openSync(path.join(scratch, `${label}.log`), 'wx', 0o600);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
    // Keep diagnostics bounded without terminating a role to truncate a log.
    const remaining = 4 * 1024 * 1024 - output.length;
    if (remaining > 0) { const retained = bytes.subarray(0, remaining); fs.writeSync(log, retained); output += retained; }
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => { fs.fsyncSync(log); fs.closeSync(log); resolve({ code, signal }); });
  });
  exited.catch(() => {});
  const ready = await Promise.race([
    new Promise(resolve => child.once('message', resolve)),
    exited.then(() => { throw Error('Prepared public server exited before readiness; inspect its output'); }),
  ]);
  assert.equal(ready.ready, true); assert.equal(ready.source, source);
  assert.equal(ready.physicalHost, '127.0.0.1'); assert.equal(ready.physicalPort, 3940);
  return { child, exited, output: () => output };
}

async function health(commit) {
  const response = await fetch('http://127.0.0.1:3940/api/health', {
    headers: { Host: 'keryx.cc', 'X-Forwarded-Proto': 'https' }, signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.commit, commit); assert.equal(body.network, 'arcTestnet'); assert.equal(body.settles, 'offline');
  assert.equal(body.db, 'ok');
  return { commit: body.commit, network: body.network, settles: body.settles,
    status: body.status, a2aJobs: body.a2aJobs, a2aWorker: body.a2aWorker };
}

async function drain(role) {
  // Native Windows signals terminate immediately. IPC calls the actual registered
  // application signal handler; Linux uses the real SIGTERM delivery instead.
  if (process.platform === 'win32') role.child.send('drain');
  else role.child.kill('SIGTERM');
  const exited = await role.exited;
  assert.equal(exited.code, 143); assert.equal(exited.signal, null);
  const closed = role.output().split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).find(value => value?.format === 'keryx-next-public-server-closed-v1');
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
  const predecessor = await start(source, env, scratch, 'predecessor'); active = predecessor;
  const initial = await health(before.commit);
  const initialReadyMs = Math.round(performance.now() - initialStarted);
  const startedAt = new Date().toISOString(), maintenanceStarted = performance.now();
  const previousClosed = await drain(predecessor);
  active = undefined;
  const drainedAt = performance.now();
  // Rehash all exact candidate bytes at the actual handover boundary.
  const after = verifyImmutableArtifact(options); assert.deepEqual(after, before);
  const replacement = await start(source, env, scratch, 'replacement'); active = replacement;
  const final = await health(before.commit);
  const handoverMs = Math.round(performance.now() - maintenanceStarted);
  const postDrainReadinessMs = Math.round(performance.now() - drainedAt);
  const replacementClosed = await drain(replacement);
  active = undefined;
  const receipt = { format: 'keryx-prepared-next-rehearsal-v1', productionAdmitted: false,
    evidence: 'actual prepared Next public server; same-cohort idle restart; isolated testnet/offline SQLite',
    commit: before.commit, tree: before.tree, buildId: before.buildId,
    artifactInspectionSha256: options.artifactInspectionSha256, artifactDigest: before.artifactDigest,
    platform: process.platform, node: process.versions.node, startedAt, initialReadyMs,
    handoverMs, postDrainReadinessMs, initial, final, previousClosed, replacementClosed,
    nativeSignal: process.platform !== 'win32', scratch,
    financialWorkerDrainAccepted: false, rollbackAccepted: false,
    productionAvailabilityTargetAccepted: false, schedulesChanged: false };
  const file = path.join(options.candidate, 'runtime-rehearsal.json');
  fs.writeFileSync(file, JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 });
  return receipt;
  } finally {
    // Failed health/identity assertions must still positively drain the owned
    // isolated role. Never force termination or remove its diagnostic/store files.
    if (active) await drain(active);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [candidate, sourceManifestSha256, artifactInspectionSha256] = process.argv.slice(2);
  if (process.argv.length !== 5) { console.error('Expected CANDIDATE SOURCE_SHA256 ARTIFACT_SHA256'); process.exitCode = 1; }
  else rehearsePreparedRelease({ candidate, sourceManifestSha256, artifactInspectionSha256 })
    .then(value => console.log(JSON.stringify(value)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

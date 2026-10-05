// Synthetic process/file rehearsal only. No application imports, sockets, signers,
// runtime ENV, production paths, job execution or economic-state updates.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stageImmutableSource, recordImmutableArtifact, verifyImmutableArtifact } from './immutable-release-staging.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-immutable-rehearsal-'));
const repo = path.join(root, 'serving-source'), releasesDir = path.join(root, 'releases');
const children = new Set();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const workerProgram = `
  const fs = require('node:fs'), crypto = require('node:crypto');
  const file = process.argv[1];
  const read = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const identity = read();
  const timer = setInterval(() => {
    if (read() !== identity) { process.send({ kind: 'source-changed' }); process.exitCode = 1; clearInterval(timer); }
    else process.send({ kind: 'observed', identity });
  }, 20);
  const exit = () => { clearInterval(timer); clearTimeout(lifetime); process.exit(0); };
  const lifetime = setTimeout(exit, 15000);
  process.on('SIGTERM', () => { process.send({ kind: 'drained', identity }, exit); });
  process.on('message', message => {
    if (message.kind === 'drain') process.send({ kind: 'drained', identity }, exit);
  });
  process.on('disconnect', exit);
  process.send({ kind: 'ready', identity });
`;

function start(source) {
  const child = spawn(process.execPath, ['-e', workerProgram, path.join(source, 'runtime.txt')],
    { env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  children.add(child);
  const messages = [];
  let settled = false;
  const exited = new Promise((resolve, reject) => {
    child.once('error', error => { settled = true; children.delete(child); reject(error); });
    child.once('exit', (code, signal) => {
      settled = true; children.delete(child);
      if (code === 0 && signal === null) resolve();
      else reject(Error('Synthetic worker did not exit cleanly.'));
    });
  });
  // Attach immediately so an early exit cannot become an unhandled rejection.
  exited.catch(() => {});
  child.on('message', message => messages.push(message));
  const waitFor = kind => new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setInterval(() => {
      const found = messages.find(message => message.kind === kind);
      if (found) { clearInterval(timer); resolve(found); }
      else if (settled || messages.some(message => message.kind === 'source-changed') || performance.now() - started > 5000) {
        clearInterval(timer); reject(Error('Synthetic observation incomplete; do not infer drain or readiness.'));
      }
    }, 10);
  });
  return { child, messages, exited, waitFor };
}

async function drain(worker) {
  if (process.platform === 'win32') {
    // Windows child.kill('SIGTERM') forcibly terminates rather than proving a
    // handler completed. Use an explicit synthetic IPC shutdown on that host.
    worker.child.send({ kind: 'drain' });
  } else worker.child.kill('SIGTERM');
  await worker.waitFor('drained'); await worker.exited;
}

try {
  fs.mkdirSync(repo, { mode: 0o700 }); fs.mkdirSync(releasesDir, { mode: 0o700 });
  const git = args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); git(['config', 'user.name', 'Synthetic Rehearsal']); git(['config', 'user.email', 'fixture@example.invalid']);
  fs.writeFileSync(path.join(repo, 'runtime.txt'), 'synthetic predecessor source\n');
  git(['add', '.']); git(['commit', '-qm', 'synthetic predecessor']);
  const predecessor = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(repo, 'runtime.txt'), 'synthetic candidate source\n');
  git(['add', '.']); git(['commit', '-qm', 'synthetic candidate']);
  const commit = git(['rev-parse', 'HEAD']);
  // Serving generation remains pinned to the predecessor bytes, never a checkout.
  const old = stageImmutableSource({ repo, releasesDir, commit: predecessor, reserveBytes: 0 });
  const retained = path.join(root, 'synthetic-retained-state.json');
  fs.writeFileSync(retained, JSON.stringify({ evidence: 'synthetic only',
    pending: [{ nonce: 'synthetic-original-nonce', microUsdc: '2000', status: 'pending' }],
    schedulers: 'held', activeRoles: ['synthetic-reader'], replayedJobs: 0 }));
  const stateDigest = hash(fs.readFileSync(retained));
  const serving = start(old.source); const oldReady = await serving.waitFor('ready');
  const preparationStarted = performance.now();
  const candidate = stageImmutableSource({ repo, releasesDir, commit, reserveBytes: 0 });
  fs.mkdirSync(path.join(candidate.source, '.next'));
  fs.mkdirSync(path.join(candidate.source, 'node_modules'));
  fs.writeFileSync(path.join(candidate.source, '.next', 'BUILD_ID'), 'synthetic-only-artifact\n');
  fs.writeFileSync(path.join(candidate.source, '.next', 'next-server.js.nft.json'), JSON.stringify({ version: 1, files: ['../runtime.txt'] }));
  const inspected = recordImmutableArtifact(candidate);
  verifyImmutableArtifact({ ...candidate, artifactInspectionSha256: inspected.artifactInspectionSha256 });
  const preparationMs = performance.now() - preparationStarted;
  await serving.waitFor('observed');
  assert.ok(serving.messages.every(message => message.identity === oldReady.identity));
  const maintenanceStarted = performance.now();
  await drain(serving);
  // Reverify exactly the accepted bytes after positively exiting the old role.
  verifyImmutableArtifact({ ...candidate, artifactInspectionSha256: inspected.artifactInspectionSha256 });
  const replacement = start(candidate.source), ready = await replacement.waitFor('ready');
  assert.notEqual(ready.identity, oldReady.identity);
  const handoverMs = performance.now() - maintenanceStarted;
  const rollbackStarted = performance.now();
  await drain(replacement);
  const rolledBack = start(old.source);
  assert.equal((await rolledBack.waitFor('ready')).identity, oldReady.identity);
  const rollbackMs = performance.now() - rollbackStarted;
  await drain(rolledBack);
  assert.equal(hash(fs.readFileSync(retained)), stateDigest);
  assert.equal(git(['rev-parse', 'HEAD']), commit);
  console.log(JSON.stringify({ evidence: 'synthetic file/process fixture; not Keryx runtime or production acceptance',
    productionAdmitted: false, sourcePreparationAndInspectionMs: Math.round(preparationMs),
    syntheticHandoverMs: Math.round(handoverMs), syntheticRollbackMs: Math.round(rollbackMs),
    previouslyServingSourceUnchanged: true, retainedSyntheticPendingStateUnchanged: true,
    allSyntheticRolesPositivelyExited: true, schedulerPolicy: 'held', realPayments: 0 }));
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  // No SIGKILL or forced timeout. A failed observation retains fixture evidence;
  // children have an independent finite lifetime and exit on IPC disconnect.
  for (const child of children) { if (child.connected) child.disconnect(); }
  if (children.size === 0 && process.exitCode !== 1) {
    assert.equal(path.dirname(root), os.tmpdir()); assert.match(path.basename(root), /^keryx-immutable-rehearsal-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

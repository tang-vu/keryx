import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { startPreparedPublicRole, drainPreparedPublicRole } from './rehearse-prepared-release.mjs';

test('rehearsal readiness refusal retains ownership until graceful close and pipe evidence', async t => {
  // Only in-memory child/pipe seams; no server, real process, socket or ENV load.
  // Retain these small synthetic logs for inspection rather than deleting them.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-readiness-refusal-'));
  for (const kind of ['not-ready', 'source', 'host', 'port', 'exit-failed', 'incomplete']) {
    await t.test(`readiness refusal ${kind}`, async () => {
      const child = new EventEmitter(); child.pid = 4242;
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      const source = path.join(scratch, 'source');
      const ready = { ready: kind !== 'not-ready', source: kind === 'source' ? source + '-other' : source,
        physicalHost: kind === 'host' ? '0.0.0.0' : '127.0.0.1', physicalPort: kind === 'port' ? 3939 : 3940 };
      if (kind === 'exit-failed' || kind === 'incomplete') ready.ready = false;
      let drainRequests = 0, closeObserved = false, rejected = false;
      const closed = Buffer.from(JSON.stringify({ format: 'keryx-next-public-server-closed-v1',
        httpDrained: true, pid: child.pid, signal: 'SIGTERM', exitCode: 143 }) + '\n');
      child.send = child.kill = () => {
        drainRequests++;
        queueMicrotask(async () => {
          child.stdout.write(closed);
          child.emit('exit', kind === 'exit-failed' ? 7 : 143, null);
          await Promise.resolve(); assert.equal(rejected, false, 'exit alone cannot finish readiness refusal');
          child.stdout.end();
          if (kind === 'incomplete') child.stderr.destroy(); else child.stderr.end();
          await new Promise(resolve => setImmediate(resolve));
          closeObserved = true; child.emit('close', kind === 'exit-failed' ? 7 : 143, null);
        });
        return true;
      };
      const pending = startPreparedPublicRole(source, {}, scratch, kind, () => child);
      pending.catch(() => { rejected = true; });
      child.emit('message', ready);
      await assert.rejects(pending, error => {
        assert.equal(closeObserved, true);
        assert.equal(error.rehearsal.phase, 'readiness-refused');
        assert.deepEqual(error.rehearsal.exit, { code: kind === 'exit-failed' ? 7 : 143, signal: null });
        assert.equal(error.rehearsal.drainAccepted, !['exit-failed', 'incomplete'].includes(kind));
        assert.equal(error.rehearsal.capture.closed, true);
        assert.equal(error.rehearsal.capture.stdoutEof, true);
        assert.equal(error.rehearsal.capture.stderrEof, kind !== 'incomplete');
        assert.equal(error.rehearsal.capture.retainedSha256, createHash('sha256').update(closed).digest('hex'));
        return true;
      });
      assert.equal(drainRequests, 1, 'one existing graceful drain, no forced termination');
      assert.deepEqual(fs.readFileSync(path.join(scratch, `${kind}.log`)), closed);
      assert.equal(fs.existsSync(path.join(scratch, 'runtime-rehearsal.json')), false);
    });
  }
});

test('rehearsal readiness closed before assertion retains refusal evidence without another drain', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-readiness-closed-'));
  const source = path.join(scratch, 'source'), child = new EventEmitter();
  child.pid = 4242; child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let drainRequests = 0;
  child.send = child.kill = () => { drainRequests++; throw Error('Already-closed synthetic child must not receive a drain'); };
  const pending = startPreparedPublicRole(source, {}, scratch, 'closed-before-assertion', () => child);
  const expected = 'synthetic readiness output\nsynthetic close diagnostic\n';
  child.stdout.write('synthetic readiness output\n'); child.stderr.write('synthetic close diagnostic\n');
  child.stdout.end(); child.stderr.end();
  await new Promise(resolve => setImmediate(resolve));
  const refused = assert.rejects(pending, error => {
    assert.equal(error.rehearsal.phase, 'readiness-refused');
    assert.deepEqual(error.rehearsal.exit, { code: 7, signal: null });
    assert.equal(error.rehearsal.drainAccepted, false); assert.equal(error.rehearsal.closedReceipt, null);
    const capture = error.rehearsal.capture;
    assert.equal(capture.closed, true); assert.equal(capture.complete, true);
    assert.equal(capture.stdoutEof, true); assert.equal(capture.stderrEof, true);
    assert.equal(capture.observedBytes, Buffer.byteLength(expected));
    assert.equal(capture.retainedBytes, Buffer.byteLength(expected));
    assert.equal(capture.observedSha256, createHash('sha256').update(expected).digest('hex'));
    assert.equal(capture.retainedSha256, capture.observedSha256);
    assert.deepEqual(capture.errors, []);
    return true;
  });
  // Resolve readiness first, then close synchronously before its assertion resumes.
  child.emit('message', { ready: false, source, physicalHost: '127.0.0.1', physicalPort: 3940 });
  child.emit('exit', 7, null); child.emit('close', 7, null);
  await refused;
  assert.equal(drainRequests, 0);
  assert.equal(fs.readFileSync(path.join(scratch, 'closed-before-assertion.log'), 'utf8'), expected);
  assert.equal(fs.existsSync(path.join(scratch, 'runtime-rehearsal.json')), false);
  // Retain the synthetic log; no cleanup or real process lifecycle operation.
});

test('rehearsal retains final drain output after exit and completes only after pipe close', async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-rehearsal-pipes-'));
  t.after(() => {
    assert.equal(path.dirname(scratch), os.tmpdir());
    assert.match(path.basename(scratch), /^keryx-rehearsal-pipes-/);
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const source = path.join(scratch, 'source');
  const started = startPreparedPublicRole(source, {}, scratch, 'late-pipes', () => child);
  child.emit('message', { ready: true, source, physicalHost: '127.0.0.1', physicalPort: 3940 });
  const role = await started;
  let complete = false; role.exited.then(() => { complete = true; });
  child.stdout.write('before exit\n'); child.emit('exit', 143, null);
  await Promise.resolve(); assert.equal(complete, false);
  const closed = JSON.stringify({ format: 'keryx-next-public-server-closed-v1', httpDrained: true });
  child.stdout.write(closed + '\n'); child.stderr.write('late stderr\n');
  child.stdout.end(); child.stderr.end();
  await new Promise(resolve => setImmediate(resolve)); child.emit('close', 143, null);
  assert.deepEqual(await role.exited, { code: 143, signal: null });
  const expected = 'before exit\n' + closed + '\nlate stderr\n';
  assert.equal(role.output(), expected);
  assert.equal(fs.readFileSync(path.join(scratch, 'late-pipes.log'), 'utf8'), expected);
  assert.equal(role.capture().complete, true);
  assert.equal(role.capture().observedBytes, Buffer.byteLength(expected));
  assert.equal(role.capture().retainedSha256, createHash('sha256').update(expected).digest('hex'));

  const failing = new EventEmitter(); failing.stdout = new PassThrough(); failing.stderr = new PassThrough();
  const refused = startPreparedPublicRole(source, {}, scratch, 'before-ready', () => failing);
  const verifiedFailure = assert.rejects(refused, error => {
    const output = 'synthetic startup failure\nlate diagnostic\n';
    assert.deepEqual(error.rehearsal.exit, { code: 7, signal: null });
    assert.equal(error.rehearsal.outputTail, output);
    assert.equal(error.rehearsal.outputSha256, createHash('sha256').update(output).digest('hex'));
    return true;
  });
  failing.stderr.write('synthetic startup failure\n'); failing.emit('exit', 7, null);
  failing.stderr.write('late diagnostic\n'); failing.stdout.end(); failing.stderr.end();
  await new Promise(resolve => setImmediate(resolve)); failing.emit('close', 7, null);
  await verifiedFailure;
});

test('rehearsal retains exact bounded bytes and refuses loss/errors only after owned role close', async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-rehearsal-pipes-'));
  t.after(() => {
    assert.equal(path.dirname(scratch), os.tmpdir());
    assert.match(path.basename(scratch), /^keryx-rehearsal-pipes-/);
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  const limit = 4 * 1024 * 1024, pid = 4242;
  const closed = Buffer.from(JSON.stringify({ format: 'keryx-next-public-server-closed-v1',
    httpDrained: true, pid, signal: 'SIGTERM', exitCode: 143 }) + '\n');
  const remaining = limit - closed.length;
  const boundary = Buffer.concat([closed, Buffer.from('€'.repeat(Math.floor(remaining / 3))),
    Buffer.alloc(remaining % 3, 0x20)]);
  for (const kind of ['boundary', 'multibyte-overflow', 'late-overflow', 'pipe-error', 'incomplete']) {
    const child = new EventEmitter(); child.pid = pid;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closeObserved = false, drainRequests = 0;
    const initial = kind === 'pipe-error' || kind === 'incomplete' ? closed : boundary;
    const beforeExitExtra = kind === 'multibyte-overflow' ? Buffer.from('€😀') : Buffer.alloc(0);
    const afterExitExtra = kind === 'late-overflow' ? Buffer.from('late stderr €😀\n') : Buffer.alloc(0);
    child.send = child.kill = () => {
      drainRequests++;
      queueMicrotask(async () => {
        // Split a UTF-8 sequence across data callbacks. Closed receipt is already
        // present, so later overflow must still invalidate successful evidence.
        child.stdout.write(initial.subarray(0, closed.length + 1));
        child.stdout.write(initial.subarray(closed.length + 1));
        if (beforeExitExtra.length) child.stdout.write(beforeExitExtra);
        child.emit('exit', 143, null);
        if (afterExitExtra.length) child.stderr.write(afterExitExtra);
        if (kind === 'pipe-error') child.stderr.emit('error', Object.assign(Error('synthetic pipe failure'), { code: 'EIO' }));
        child.stdout.end();
        if (kind === 'incomplete') child.stderr.destroy(); else child.stderr.end();
        await new Promise(resolve => setImmediate(resolve));
        closeObserved = true; child.emit('close', 143, null);
      });
      return true;
    };
    const source = path.join(scratch, 'source');
    const started = startPreparedPublicRole(source, {}, scratch, kind, () => child);
    child.emit('message', { ready: true, source, physicalHost: '127.0.0.1', physicalPort: 3940 });
    const role = await started;
    if (kind === 'boundary') assert.equal((await drainPreparedPublicRole(role)).httpDrained, true);
    else await assert.rejects(drainPreparedPublicRole(role), error => {
      assert.equal(closeObserved, true, 'refusal must follow actual child close/pipe completion');
      assert.equal(error.rehearsal.phase, 'after-role-close');
      assert.deepEqual(error.rehearsal.exit, { code: 143, signal: null });
      assert.equal(error.rehearsal.closedReceipt.httpDrained, true);
      assert.equal(error.rehearsal.closedReceipt.pid, pid);
      return true;
    });
    assert.equal(drainRequests, 1, 'one graceful drain, no forced termination');
    const observed = Buffer.concat([initial, beforeExitExtra, afterExitExtra]);
    const retained = observed.subarray(0, limit), capture = role.capture();
    assert.deepEqual(fs.readFileSync(path.join(scratch, `${kind}.log`)), retained);
    assert.equal(capture.observedBytes, observed.length);
    assert.equal(capture.retainedBytes, retained.length);
    assert.equal(capture.overflowBytes, Math.max(0, observed.length - limit));
    assert.equal(capture.droppedBytes, observed.length - retained.length);
    assert.equal(capture.observedSha256, createHash('sha256').update(observed).digest('hex'));
    assert.equal(capture.retainedSha256, createHash('sha256').update(retained).digest('hex'));
    assert.equal(capture.complete, !['pipe-error', 'incomplete'].includes(kind));
    if (kind === 'pipe-error') assert.deepEqual(capture.errors, ['EIO']);
    if (kind === 'incomplete') assert.equal(capture.stderrEof, false);
  }
});

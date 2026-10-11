import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { startPreparedPublicRole } from './rehearse-prepared-release.mjs';

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
  child.stdout.end(); child.stderr.end(); child.emit('close', 143, null);
  assert.deepEqual(await role.exited, { code: 143, signal: null });
  const expected = 'before exit\n' + closed + '\nlate stderr\n';
  assert.equal(role.output(), expected);
  assert.equal(fs.readFileSync(path.join(scratch, 'late-pipes.log'), 'utf8'), expected);
});

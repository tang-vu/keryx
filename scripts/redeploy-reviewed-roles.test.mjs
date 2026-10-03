import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployReviewedRole, validateReviewedRoles, readReviewedRoles } from './redeploy-reviewed-roles.mjs';

const config = () => ({ apps: ['keryx', 'keryx-a2a-worker'].map(name => ({
  name, script: '/usr/bin/env', interpreter: 'none', cwd: '/root/keryx',
  autorestart: false, kill_timeout: 330000,
  args: ['-i', 'PATH=/usr/bin:/bin', 'NODE_ENV=production', '/usr/bin/node',
    '--env-file=/root/keryx/.env.local', ...(name === 'keryx'
      ? ['/root/keryx/node_modules/next/dist/bin/next', 'start', '-p', '3939']
      : ['--import', '/root/keryx/node_modules/tsx/dist/loader.mjs', '/root/keryx/scripts/a2a-research-worker.mts'])],
})) });
const old = name => ({ name, pid: 0, pm2_env: { status: 'stopped', pm_exec_path: '/usr/bin/npm',
  pm_cwd: '/root/keryx', exec_interpreter: 'none', args: ['run', name === 'keryx' ? 'start' : 'a2a-worker'],
  autorestart: true, kill_timeout: 330000, env: { PRIVATE_KEY: 'not-for-export' } } });

function harness(initial = [old('keryx')]) {
  const c = config(), events = [], retained = [];
  let rows = initial, reads = 0;
  return { c, events, retained, manager: {
    list() { reads++; return structuredClone(rows); },
    run(args) {
      events.push(args);
      if (args[0] === 'delete') rows = [];
      else {
        const a = c.apps.find(a => a.name === args.at(-1));
        rows = [{ name: a.name, pid: 123, pm2_env: { status: 'online', pm_exec_path: a.script,
          pm_cwd: a.cwd, exec_interpreter: a.interpreter, args: a.args,
          autorestart: a.autorestart, kill_timeout: a.kill_timeout } }];
      }
    },
  }, recheck() { events.push(['read-protected-config']); },
  retain(name, row) { retained.push({ name, row }); events.push(['retain-before-delete']); },
  change(fn) { rows = fn(rows); }, get reads() { return reads; } };
}
function deploy(h, mode = 'web') {
  return deployReviewedRole(mode, '/root/.local/share/release/roles.json', h.c, h.manager, h.recheck, h.retain);
}

test('exact clean roles: arbitrary ENV, arguments, paths and duplicates refuse', () => {
  assert.equal(validateReviewedRoles(config()).apps.length, 2);
  for (const mutate of [c => c.apps[0].env = {}, c => c.apps[0].args.push('PRIVATE_KEY=x'),
    c => c.apps[0].args[4] = '--env-file=/tmp/keys', c => c.apps[1].name = 'keryx',
    c => c.apps[0].cwd = '/tmp', c => c.apps[0].kill_timeout = 1000]) {
    const c = config(); mutate(c); assert.throws(() => validateReviewedRoles(c));
  }
});
test('stopped definition retained without raw environment before replacement', () => {
  const h = harness(); deploy(h);
  assert.equal(h.retained.length, 1);
  assert.ok(!JSON.stringify(h.retained).includes('not-for-export'));
  assert.equal(h.retained[0].row.environmentFile, '/root/keryx/.env.local');
  assert.ok(h.events.findIndex(e => e[0] === 'retain-before-delete') < h.events.findIndex(e => e[0] === 'delete'));
  assert.deepEqual(h.events.filter(e => ['start', 'delete'].includes(e[0])),
    [['delete', 'keryx'], ['start', '/root/.local/share/release/roles.json', '--only', 'keryx']]);
});
test('absent role starts without delete; validation never mutates', () => {
  const h = harness([]); deploy(h); assert.ok(!h.events.some(e => e[0] === 'delete'));
  const v = harness(); deploy(v, 'validate'); assert.equal(v.retained.length, 0);
  assert.deepEqual(v.events, [['read-protected-config']]);
});
test('active, duplicate, unstable and secret-shaped definitions refuse before mutation', () => {
  for (const rows of [[{ ...old('keryx'), pid: 9 }], [old('keryx'), old('keryx')],
    [{ ...old('keryx'), pm2_env: { ...old('keryx').pm2_env, status: 'launching' } }],
    [{ ...old('keryx'), pm2_env: { ...old('keryx').pm2_env, args: ['PRIVATE_KEY=x'] } }]]) {
    const h = harness(rows); assert.throws(() => deploy(h)); assert.equal(h.events.length, 0);
  }
});
test('PID/definition races or failed preservation refuse at delete boundary', () => {
  for (const change of [r => [{ ...r[0], pid: 22 }], r => [{ ...r[0], pm2_env: { ...r[0].pm2_env, autorestart: false } }]]) {
    const h = harness(), retain = h.retain;
    h.retain = (...args) => { retain(...args); h.change(change); };
    assert.throws(() => deploy(h)); assert.ok(!h.events.some(e => ['start', 'delete'].includes(e[0])));
  }
  const h = harness(); h.retain = () => { throw Error('disk full'); };
  assert.throws(() => deploy(h)); assert.ok(!h.events.some(e => e[0] === 'delete'));
});
test('failed start leaves preserved stopped reference; no retries or stop commands', () => {
  const h = harness(), run = h.manager.run;
  h.manager.run = args => { if (args[0] === 'start') throw Error('start failed'); run(args); };
  assert.throws(() => deploy(h)); assert.equal(h.retained.length, 1);
  assert.ok(!h.events.some(e => ['stop', 'restart', 'reload'].includes(e[0])));
});
test('a competing definition after delete or just before absent-role start refuses', () => {
  const deleted = harness(), run = deleted.manager.run;
  deleted.manager.run = args => {
    run(args);
    if (args[0] === 'delete') deleted.change(() => [{ ...old('keryx'), pid: 456 }]);
  };
  assert.throws(() => deploy(deleted));
  assert.deepEqual(deleted.events.filter(e => ['delete', 'start'].includes(e[0])), [['delete', 'keryx']]);
  for (const pid of [0, 456]) {
    const absent = harness([]), recheck = absent.recheck;
    let checks = 0;
    absent.recheck = () => {
      recheck();
      if (++checks === 3) absent.change(() => [{ ...old('keryx'), pid }]);
    };
    assert.throws(() => deploy(absent));
    assert.ok(!absent.events.some(e => ['delete', 'start'].includes(e[0])));
  }
});
test('post-start runtime must match reviewed kill policy and args', () => {
  const h = harness(), run = h.manager.run;
  h.manager.run = args => { run(args); if (args[0] === 'start') h.change(r => [{ ...r[0], pm2_env: { ...r[0].pm2_env, kill_timeout: 1000 } }]); };
  assert.throws(() => deploy(h)); assert.equal(h.retained.length, 1);
});
test('protected reader rejects caller-controlled path/hash before file access', () => {
  for (const file of ['/tmp/roles.json', '/root/.local/share/../roles.json', '/root/.local/share/x;touch.json'])
    assert.throws(() => readReviewedRoles(file, '0'.repeat(64)));
  assert.throws(() => readReviewedRoles('/root/.local/share/roles.json', 'invalid'));
});

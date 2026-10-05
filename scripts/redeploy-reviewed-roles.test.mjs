import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployReviewedRole, validateReviewedRoles, readReviewedRoles } from './redeploy-reviewed-roles.mjs';

const config = () => ({ apps: ['keryx', 'keryx-a2a-worker'].map(name => ({
  name, script: '/usr/bin/env', interpreter: 'none', cwd: '/root/keryx',
  autorestart: false, kill_timeout: 330000,
  args: ['-i', 'PATH=/usr/bin:/bin', 'NODE_ENV=production', '/usr/bin/node',
    '--env-file=/root/keryx/.env.local', ...(name === 'keryx'
      ? ['/root/keryx/scripts/next-public-server.mjs', '--port', '3939']
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

const modelFile = 'KERYX_MODEL_ALLOWANCE_FILE=/root/.local/share/release/model-allowance.json';
const modelHash = `KERYX_MODEL_ALLOWANCE_SHA256=${'a'.repeat(64)}`;
const controlled = (...controls) => {
  const c = config(); for (const app of c.apps) app.args.splice(3, 0, ...controls); return c;
};

test('only paired model allowance and boolean brief controls may precede the fixed binary', () => {
  for (const controls of [[], ['KERYX_DECISION_BRIEF=0'], ['KERYX_DECISION_BRIEF=1'],
    [modelFile, modelHash], ['KERYX_DECISION_BRIEF=0', modelFile, modelHash]]) {
    const c = controlled(...controls); assert.equal(validateReviewedRoles(c), c);
    for (const app of c.apps) {
      const binary = app.args.indexOf('/usr/bin/node');
      assert.equal(app.args[binary + 1], '--env-file=/root/keryx/.env.local');
    }
  }
  for (const controls of [[modelFile], [modelHash], [modelFile, modelFile, modelHash],
    ['KERYX_DECISION_BRIEF=1', 'KERYX_DECISION_BRIEF=0'], ['KERYX_DECISION_BRIEF=true'],
    ['KERYX_DECISION_BRIEF=1\nPRIVATE_KEY=x'], ['NODE_OPTIONS=--import=/tmp/unsafe.mjs'],
    ['PRIVATE_KEY=x'], ['KERYX_NETWORK=arcTestnet'], ['KERYX_SETTLEMENT_MODE=offline'],
    [modelFile.replace('/root/.local/share/release/', '/tmp/'), modelHash],
    [modelFile.replace('release/', 'release/../'), modelHash],
    [modelFile.replace('release/', 'release//'), modelHash],
    [modelFile, 'KERYX_MODEL_ALLOWANCE_SHA256=invalid']])
    assert.throws(() => validateReviewedRoles(controlled(...controls)));
  const mismatch = controlled(modelFile, modelHash); mismatch.apps[1] = config().apps[1];
  assert.throws(() => validateReviewedRoles(mismatch));
  const tail = config(); for (const app of tail.apps) app.args.push('KERYX_DECISION_BRIEF=1');
  assert.throws(() => validateReviewedRoles(tail));
});

test('controlled stopped roles can restore the ordinary chain without exporting arbitrary environment', () => {
  const previous = controlled('KERYX_DECISION_BRIEF=0', modelFile, modelHash).apps[0];
  const h = harness([{ name: previous.name, pid: 0, pm2_env: { status: 'stopped',
    pm_exec_path: previous.script, pm_cwd: previous.cwd, exec_interpreter: previous.interpreter,
    args: previous.args, autorestart: previous.autorestart, kill_timeout: previous.kill_timeout,
    env: { PRIVATE_KEY: 'not-for-export' } } }]);
  h.c.apps = controlled('KERYX_DECISION_BRIEF=0').apps;
  deploy(h);
  assert.deepEqual(h.retained[0].row.args, previous.args);
  assert.ok(!JSON.stringify(h.retained).includes('not-for-export'));
  assert.deepEqual(h.events.filter(e => e[0] === 'start'),
    [['start', '/root/.local/share/release/roles.json', '--only', 'keryx']]);
});
test('new web launcher requires exact public server and production port; stopped prior launchers recover', () => {
  const priorTail = ['/root/keryx/node_modules/next/dist/bin/next', 'start', '-p', '3939'];
  for (const mutate of [a => a.args.splice(-3), a => a.args[a.args.length - 1] = '3940',
    a => a.args[a.args.length - 3] = '/tmp/server.mjs', a => a.args.push('--hostname', 'evil.example'),
    a => a.args[a.args.length - 2] = '--host', a => a.args.splice(-3, 3, ...priorTail)]) {
    const c = config(); mutate(c.apps[0]); assert.throws(() => validateReviewedRoles(c));
  }
  for (const tail of [priorTail, [...priorTail, '--hostname', '127.0.0.1', '--keepAliveTimeout', '100000']]) {
    const h = harness(), wanted = h.c.apps[0], previousArgs = [...wanted.args.slice(0, -3), ...tail];
    h.change(() => [{ name: 'keryx', pid: 0, pm2_env: { status: 'stopped',
      pm_exec_path: wanted.script, pm_cwd: wanted.cwd, exec_interpreter: wanted.interpreter,
      args: previousArgs, autorestart: wanted.autorestart, kill_timeout: wanted.kill_timeout } }]);
    deploy(h);
    assert.deepEqual(h.retained[0].row.args, previousArgs);
    assert.ok(h.events.some(e => e[0] === 'start'));
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

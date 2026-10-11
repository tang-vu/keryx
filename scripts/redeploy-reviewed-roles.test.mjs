import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployReviewedRole, validateReviewedRoles, readReviewedRoles, releaseSource, verifyReleaseReview } from './redeploy-reviewed-roles.mjs';

const config = () => ({ apps: ['keryx', 'keryx-a2a-worker'].map(name => ({
  name, script: '/usr/bin/env', interpreter: 'none', cwd: '/root/keryx',
  autorestart: false, kill_timeout: 330000,
  args: ['-i', 'PATH=/usr/bin:/bin', 'NODE_ENV=production', '/usr/bin/node',
    '--env-file=/root/keryx/.env.local', ...(name === 'keryx'
      ? ['/root/keryx/scripts/next-public-server.mjs', '--port', '3939']
      : ['--import', '/root/keryx/node_modules/tsx/dist/loader.mjs', '/root/keryx/scripts/a2a-research-worker.mts'])],
})) });
const stagedConfig = () => {
  const c = config(), commit = 'c'.repeat(40), source = releaseSource(commit);
  c.release = { commit, sourceManifestSha256: '1'.repeat(64), artifactInspectionSha256: '2'.repeat(64),
    preparationSha256: '0'.repeat(64),
    runtimeEnvironmentSha256: '3'.repeat(64), compatibilityReviewFile: '/root/.local/share/release/compatibility.json',
    compatibilityReviewSha256: '4'.repeat(64) };
  for (const app of c.apps) {
    app.args.splice(3, 0, `KERYX_COMMIT=${commit}`);
    app.args.splice(6, app.args.length - 6, ...(app.name === 'keryx'
      ? [`${source}/scripts/next-immutable-server.mjs`, '--port', '3939']
      : ['--import', `${source}/node_modules/tsx/dist/loader.mjs`, `${source}/scripts/a2a-research-worker.mts`]));
  }
  return c;
};
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
test('staged roles preserve operational cwd/ENV and bind both executable closures to one full commit', () => {
  assert.equal(validateReviewedRoles(stagedConfig()).apps.length, 2);
  for (const mutate of [c => c.apps[0].cwd = releaseSource(c.release.commit),
    c => c.apps[1].args[3] = `KERYX_COMMIT=${'d'.repeat(40)}`,
    c => c.apps[1].args[7] = '/root/keryx/node_modules/tsx/dist/loader.mjs',
    c => c.apps[0].args[6] = '/root/keryx/scripts/next-public-server.mjs',
    c => c.release.commit = 'main', c => c.release = null,
    c => c.release.compatibilityReviewFile = '/tmp/compatibility.json',
    c => c.release.extra = 'arbitrary']) {
    const c = stagedConfig(); mutate(c); assert.throws(() => validateReviewedRoles(c));
  }
  const c = config(); c.apps[0].args.splice(3, 0, `KERYX_COMMIT=${'c'.repeat(40)}`);
  assert.throws(() => validateReviewedRoles(c));
});
test('staged native compatibility review must bind exact artifact, existing ENV and authorized held roles', () => {
  const c = stagedConfig(), binding = c.release;
  const artifact = { commit: binding.commit, tree: 'b'.repeat(40), buildId: 'accepted-build',
    artifactDigest: '5'.repeat(64), sourceManifestSha256: binding.sourceManifestSha256 };
  const review = { format: 'keryx-reviewed-release-compatibility-v1', ...artifact,
    artifactInspectionSha256: binding.artifactInspectionSha256, runtimeEnvironmentSha256: binding.runtimeEnvironmentSha256,
    acceptanceEvidenceSha256: '6'.repeat(64), storageIdentityDigest: '7'.repeat(64),
    economicSchemaDigest: '8'.repeat(64), retainedEconomicStateSha256: '9'.repeat(64),
    sourceAndArtifactAccepted: true, mainnetPublicSettingsAccepted: true,
    previouslyActiveRoles: ['keryx', 'keryx-a2a-worker'], heldSchedulers: true, rollback: 'hold-for-review' };
  const preparation = { format: 'keryx-immutable-preparation-v1', productionAdmitted: false, ...artifact,
    artifactInspectionSha256: binding.artifactInspectionSha256, writerHoldStarted: false, runtimeEnvironmentLoaded: false,
    checks: { publicBuildSettings: { network: 'arc' }, platform: 'linux', node: '24.21.0', npm: '11.19.0',
      results: ['typecheck', 'tests', 'build'].map(name => ({ name, exitCode: 0, signal: null, processError: null, outputSha256: 'a'.repeat(64) })) } };
  const reader = value => (file, expected, environment) => {
    if (file.endsWith('/preparation.json')) { assert.equal(expected, binding.preparationSha256); return preparation; }
    if (environment) { assert.equal(file, '/root/keryx/.env.local'); assert.equal(expected, binding.runtimeEnvironmentSha256); return; }
    assert.equal(file, binding.compatibilityReviewFile); assert.equal(expected, binding.compatibilityReviewSha256);
    return value;
  };
  assert.equal(verifyReleaseReview(binding, reader(review), artifact), review);
  const reordered = { ...review, previouslyActiveRoles: [...review.previouslyActiveRoles].reverse() };
  assert.equal(verifyReleaseReview(binding, reader(reordered), artifact), reordered);
  preparation.checks.publicBuildSettings.network = 'arcTestnet';
  assert.throws(() => verifyReleaseReview(binding, reader(review), artifact));
  preparation.checks.publicBuildSettings.network = 'arc';
  preparation.checks.results[0].exitCode = 7;
  assert.throws(() => verifyReleaseReview(binding, reader(review), artifact));
  preparation.checks.results[0].exitCode = 0;
  for (const mutate of [r => r.mainnetPublicSettingsAccepted = false, r => r.heldSchedulers = false,
    r => r.previouslyActiveRoles.push('keryx-private-worker'), r => r.rollback = 'automatic',
    r => r.retainedEconomicStateSha256 = '', r => r.buildId = 'different',
    r => r.artifactInspectionSha256 = 'a'.repeat(64), r => r.tree = 'a'.repeat(40),
    r => r.runtimeEnvironmentSha256 = 'a'.repeat(64), r => r.storageIdentityDigest = null]) {
    const r = structuredClone(review); mutate(r);
    assert.throws(() => verifyReleaseReview(binding, reader(r), artifact));
  }
  assert.throws(() => verifyReleaseReview(binding, () => { throw Error('changed ENV'); }, artifact));
});
test('positively exited prior immutable definitions are retained before replacement', () => {
  const c = stagedConfig(), app = c.apps[0];
  let rows = [{ name: app.name, pid: 0, pm2_env: { status: 'stopped', pm_exec_path: app.script,
    pm_cwd: app.cwd, exec_interpreter: app.interpreter, args: app.args,
    autorestart: app.autorestart, kill_timeout: app.kill_timeout, env: { PRIVATE_KEY: 'synthetic' } } }];
  const events = [], retained = [];
  const manager = { list: () => structuredClone(rows), run: args => {
    events.push(args[0]);
    rows = args[0] === 'delete' ? [] : [{ name: app.name, pid: 123, pm2_env: { status: 'online',
      pm_exec_path: app.script, pm_cwd: app.cwd, exec_interpreter: app.interpreter, args: app.args,
      autorestart: app.autorestart, kill_timeout: app.kill_timeout } }];
  } };
  deployReviewedRole('web', '/root/.local/share/release/roles.json', c, manager, () => {},
    (_name, previous) => { events.push('retain'); retained.push(previous); });
  assert.deepEqual(events, ['retain', 'delete', 'start']);
  assert.equal(retained[0].environmentFile, '/root/keryx/.env.local');
  assert.equal(JSON.stringify(retained).includes('PRIVATE_KEY'), false);
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployReviewedRole, validateReviewedRoles, readReviewedRoles, releaseSource, verifyReleaseReview, artifactMetadata, recordArtifactReuse, verifyArtifactReuse } from './redeploy-reviewed-roles.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { nativeReleaseFiles, SERVER1_NATIVE_RELEASE, verifyNativeCutoverReceipt } from './redeploy-reviewed-roles.mjs';

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

test('metadata reuse refuses same-size writes with restored mtime, replacement, topology and mode drift', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-artifact-reuse-'));
  try {
    fs.chmodSync(root, 0o700);
    const file = path.join(root, 'content'); fs.writeFileSync(file, 'accepted', { mode: 0o600 });
    const before = artifactMetadata(root), stat = fs.statSync(file);
    fs.writeFileSync(file, 'modified'); fs.utimesSync(file, stat.atime, stat.mtime);
    assert.notDeepEqual(artifactMetadata(root), before);
    const changed = artifactMetadata(root); fs.unlinkSync(file); fs.writeFileSync(file, 'modified', { mode: 0o600 });
    assert.notDeepEqual(artifactMetadata(root), changed);
    const replaced = artifactMetadata(root); fs.mkdirSync(path.join(root, 'extra'), { mode: 0o700 });
    assert.notDeepEqual(artifactMetadata(root), replaced);
    if (process.platform !== 'win32') {
      fs.chmodSync(file, 0o644); const readable = artifactMetadata(root);
      fs.chmodSync(file, 0o600); assert.notDeepEqual(artifactMetadata(root), readable);
      fs.chmodSync(file, 0o666); assert.throws(() => artifactMetadata(root)); fs.chmodSync(file, 0o600);
      fs.symlinkSync('content', path.join(root, 'alias')); assert.doesNotThrow(() => artifactMetadata(root));
      fs.unlinkSync(path.join(root, 'alias')); fs.symlinkSync('../escape', path.join(root, 'alias'));
      assert.throws(() => artifactMetadata(root));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reuse proof binds full role/config inputs, original inspection, stable metadata and finite age', { skip: process.platform !== 'linux' }, () => {
  const c = stagedConfig(), at = Date.now(), metadata = { sha256: 'a'.repeat(64), entries: 10, bytes: 500 };
  const snapshot = source => { assert.equal(source, releaseSource(c.release.commit)); return metadata; };
  const artifact = { commit: c.release.commit, sourceManifestSha256: c.release.sourceManifestSha256, artifactDigest: 'd'.repeat(64) };
  let inspections = 0;
  const proof = recordArtifactReuse(c, () => { inspections++; return artifact; }, at, snapshot);
  assert.equal(inspections, 1);
  c.release.artifactReuseFile = '/root/.local/share/release/artifact-reuse.json'; c.release.artifactReuseSha256 = 'e'.repeat(64);
  assert.equal(verifyArtifactReuse(c, proof, at, snapshot), artifact);
  for (const mutate of [v => v.apps[0].autorestart = true, v => v.release.runtimeEnvironmentSha256 = 'f'.repeat(64),
    v => v.release.artifactInspectionSha256 = 'f'.repeat(64), v => v.release.preparationSha256 = 'f'.repeat(64),
    v => v.release.compatibilityReviewSha256 = 'f'.repeat(64), v => v.release.artifactReuseFile = '/tmp/proof.json',
    v => delete v.release.artifactReuseSha256]) {
    const changed = structuredClone(c); mutate(changed); assert.throws(() => verifyArtifactReuse(changed, proof, at, snapshot));
  }
  assert.throws(() => verifyArtifactReuse(c, proof, at + 7200001, snapshot));
  assert.throws(() => verifyArtifactReuse(c, proof, at - 5001, snapshot));
  assert.throws(() => verifyArtifactReuse(c, proof, at, () => ({ ...metadata, entries: 11 })));
  assert.throws(() => verifyArtifactReuse(c, { ...proof, source: '/tmp/substitute' }, at, snapshot));
  const base = stagedConfig(); let reads = 0;
  assert.throws(() => recordArtifactReuse(base, () => artifact, at, () => ({ ...metadata, entries: reads++ })));
  assert.throws(() => recordArtifactReuse(base, () => ({ ...artifact, commit: 'f'.repeat(40) }), at, snapshot));
});

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
    checks: { publicBuildSettings: { network: 'arc', forceOffline: false, mainnetPublicConfigSha256: '4'.repeat(64), privateRunHeadersSha256: 'd'.repeat(64) }, platform: 'linux', node: '24.22.1', npm: '11.19.0',
      results: ['typecheck', 'tests', 'build'].map(name => ({ name, exitCode: 0, signal: null, processError: null, outputSha256: 'a'.repeat(64) })) } };
  const reader = value => (file, expected, environment) => {
    if (file.endsWith('/preparation.json')) { assert.equal(expected, binding.preparationSha256); return preparation; }
    if (environment) { assert.equal(file, '/root/keryx/.env.local'); assert.equal(expected, binding.runtimeEnvironmentSha256); return { mainnetPublicConfigSha256: '4'.repeat(64) }; }
    assert.equal(file, binding.compatibilityReviewFile); assert.equal(expected, binding.compatibilityReviewSha256);
    return value;
  };
  const verify = (read, actual = artifact) => verifyReleaseReview(binding, read, actual, () => 'd'.repeat(64));
  assert.equal(verify(reader(review)), review);
  const reordered = { ...review, previouslyActiveRoles: [...review.previouslyActiveRoles].reverse() };
  assert.equal(verify(reader(reordered)), reordered);
  preparation.checks.publicBuildSettings.network = 'arcTestnet';
  assert.throws(() => verify(reader(review)));
  preparation.checks.publicBuildSettings.network = 'arc';
  preparation.checks.publicBuildSettings.forceOffline = true;
  assert.throws(() => verify(reader(review)));
  preparation.checks.publicBuildSettings.forceOffline = false;
  preparation.checks.results[0].exitCode = 7;
  assert.throws(() => verify(reader(review)));
  preparation.checks.results[0].exitCode = 0;
  for (const mutate of [r => r.mainnetPublicSettingsAccepted = false, r => r.heldSchedulers = false,
    r => r.previouslyActiveRoles.push('keryx-private-worker'), r => r.rollback = 'automatic',
    r => r.retainedEconomicStateSha256 = '', r => r.buildId = 'different',
    r => r.artifactInspectionSha256 = 'a'.repeat(64), r => r.tree = 'a'.repeat(40),
    r => r.runtimeEnvironmentSha256 = 'a'.repeat(64), r => r.storageIdentityDigest = null]) {
    const r = structuredClone(review); mutate(r);
    assert.throws(() => verify(reader(r)));
  }
  assert.throws(() => verify(() => { throw Error('changed ENV'); }));
  for (const key of ['mainnetPublicConfigSha256', 'privateRunHeadersSha256']) {
    const old = preparation.checks.publicBuildSettings[key];
    for (const value of [undefined, '', 'e'.repeat(64)]) {
      preparation.checks.publicBuildSettings[key] = value;
      assert.throws(() => verify(reader(review)));
    }
    preparation.checks.publicBuildSettings[key] = old;
  }
  assert.throws(() => verifyReleaseReview(binding, reader(review), artifact, () => 'e'.repeat(64)));
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

function nativeCompatibilityFixture() {
  const c=stagedConfig(),binding=c.release,files=nativeReleaseFiles(binding),hash=v=>createHash('sha256').update(v).digest('hex');
  const artifact={commit:binding.commit,tree:'b'.repeat(40),buildId:'accepted-build',artifactDigest:'5'.repeat(64),sourceManifestSha256:binding.sourceManifestSha256};
  const identity={format:'keryx-mainnet-storage-identity-v1',deploymentId:'11111111-1111-4111-8111-111111111111',storageId:'22222222-2222-4222-8222-222222222222',network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:'a'.repeat(64),enrollmentId:'33333333-3333-4333-8333-333333333333',enrolledAt:'2026-11-11T00:00:00.000Z',provenanceDigest:'b'.repeat(64)};
  const review={format:'keryx-reviewed-native-release-compatibility-v1',...artifact,artifactInspectionSha256:binding.artifactInspectionSha256,runtimeEnvironmentSha256:binding.runtimeEnvironmentSha256,
    acceptanceEvidenceSha256:'6'.repeat(64),storageIdentityDigest:hash(JSON.stringify(identity)),nativeStorage:{sourceSqlSha256:SERVER1_NATIVE_RELEASE.sourceSqlSha256,catalogSha256:SERVER1_NATIVE_RELEASE.catalogSha256,runtimeManifestSha256:'8'.repeat(64),cutoverReceiptSha256:'9'.repeat(64)},
    sourceAndArtifactAccepted:true,mainnetPublicSettingsAccepted:true,previouslyActiveRoles:['keryx','keryx-a2a-worker'],heldSchedulers:true,rollback:'hold-for-review'};
  const preparation={format:'keryx-immutable-preparation-v1',productionAdmitted:false,...artifact,artifactInspectionSha256:binding.artifactInspectionSha256,writerHoldStarted:false,runtimeEnvironmentLoaded:false,
    checks:{publicBuildSettings:{network:'arc',forceOffline:false,mainnetPublicConfigSha256:'4'.repeat(64),privateRunHeadersSha256:'d'.repeat(64)},platform:'linux',node:'24.22.1',npm:'11.19.0',results:['typecheck','tests','build'].map(name=>({name,exitCode:0,signal:null,processError:null,outputSha256:'a'.repeat(64)}))}};
  const nativeEnvironment={manifest:SERVER1_NATIVE_RELEASE.manifest,legacySelectorsAbsent:true,network:'arc',publicNetwork:'arc',baseUrl:'https://keryx.cc',forceOffline:'0',publicPolicySha256:SERVER1_NATIVE_RELEASE.publicPolicySha256};
  const manifest={format:'keryx-storage-deployment-v1',identity,backend:{kind:'postgres',database:'keryx_mainnet',endpoint:{kind:'unix',directory:'/run/postgresql-keryx',port:5432},sourceDigest:SERVER1_NATIVE_RELEASE.catalogSha256,credentialPaths:{application:'/root/.local/share/keryx-mainnet-runtime/production-v2/app.json',reader:'/root/.local/share/keryx-mainnet-runtime/production-v2/reader.json'}}};
  const receipt={format:'keryx-server1-native-cutover-v1',phase:'complete',sourceCommit:SERVER1_NATIVE_RELEASE.sourceCommit,targetCommit:binding.commit,sourceManifestSha256:'a'.repeat(64),runtimeManifestSha256:review.nativeStorage.runtimeManifestSha256,identityDigest:review.storageIdentityDigest,sourceSqlSha256:SERVER1_NATIVE_RELEASE.sourceSqlSha256,catalogSha256:SERVER1_NATIVE_RELEASE.catalogSha256,finalSnapshotSha256:'b'.repeat(64),finalSchemaSha256:'c'.repeat(64),finalDataDigest:'d'.repeat(64),nativeCensusSha256:'e'.repeat(64),publicPolicySha256:SERVER1_NATIVE_RELEASE.publicPolicySha256,
    sourceWritersNaturallyEnded:true,sourceStartupRetired:true,sourceManifestRetired:true,privateWorkerInactive:true,pendingOriginalsPreserved:true,targetMode:'active',activationOutcome:'acknowledged',runtimeHbaVerified:true,newFunding:false,financialPolicyChanged:false,createdAt:'2026-11-15T00:00:00.000Z'};
  const calls=[];let cutover=receipt;
  const read=(file,expected,environment)=>{
    calls.push({file,expected,environment});
    if(file.endsWith('/preparation.json'))return preparation;
    if(file===binding.compatibilityReviewFile)return review;
    if(environment)return {mainnetPublicConfigSha256:'4'.repeat(64),nativeEnvironment};
    if(file===files.manifest||file===SERVER1_NATIVE_RELEASE.manifest){assert.equal(expected,review.nativeStorage.runtimeManifestSha256);return manifest;}
    if(file===files.cutover){assert.equal(expected,review.nativeStorage.cutoverReceiptSha256);return cutover;}
    throw Error('Unreviewed fixture read');
  };
  return {binding,files,artifact,review,preparation,manifest,receipt,nativeEnvironment,calls,read,setCutover:v=>{cutover=v;},verify:phase=>verifyReleaseReview(binding,read,artifact,()=>'d'.repeat(64),phase)};
}
test('native artifact preparation uses fixed staged ENV/manifest while Source remains online; startup requires actual completed cutover',()=>{
  const f=nativeCompatibilityFixture();f.setCutover(null);
  assert.equal(f.verify('artifact'),f.review);assert(f.calls.some(c=>c.file===f.files.environment&&c.environment==='native-staged'));assert(!f.calls.some(c=>c.file===f.files.cutover||c.file==='/root/keryx/.env.local'));
  assert.throws(()=>f.verify('startup'));f.setCutover(f.receipt);assert.equal(f.verify('startup'),f.review);assert(f.calls.some(c=>c.file==='/root/keryx/.env.local'&&c.environment==='native-active'));
  assert.throws(()=>f.verify('allow-production'));
});
test('artifact CLI final review uses staged native controls before the cutover receipt exists, including artifact reuse',()=>{
  // Execute the actual synchronous CLI tail with recorded artifact/filesystem
  // dependencies; the native compatibility validator itself remains real.
  const source=fs.readFileSync(new URL('./redeploy-reviewed-roles.mjs',import.meta.url),'utf8');
  const begin=source.indexOf('        const artifact = config.release.artifactReuseFile');
  const finish="        console.log('Reviewed immutable source/artifact and compatibility binding passed.');";
  const end=source.indexOf(finish,begin);
  assert(begin>=0&&end>begin);assert.equal(source.indexOf('        const artifact = config.release.artifactReuseFile',begin+1),-1);
  const run=new Function('config','verifyArtifactReuse','readProtectedDeploymentJson','inspect',
    'verifyReleaseSourcePaths','releaseSource','verifyReleaseReview','console',source.slice(begin,end+finish.length));
  for(const reuse of [false,true]){
    const f=nativeCompatibilityFixture();f.setCutover(null);
    const proof=Object.freeze({fixture:'existing separately qualified artifact proof'}),events=[];
    if(reuse){f.binding.artifactReuseFile=path.posix.dirname(f.binding.compatibilityReviewFile)+'/artifact-reuse.json';f.binding.artifactReuseSha256='e'.repeat(64);}
    const read=(file,hash,environment)=>{
      if(reuse&&file===f.binding.artifactReuseFile){assert.equal(hash,f.binding.artifactReuseSha256);events.push('read-reuse');return proof;}
      return f.read(file,hash,environment);
    };
    run({release:f.binding},(config,actual)=>{assert.equal(config.release,f.binding);assert.equal(actual,proof);events.push('verify-reuse');return f.artifact;},read,
      ()=>{events.push('inspect');return f.artifact;},actual=>{assert.equal(actual,releaseSource(f.binding.commit));events.push('verify-source-paths');},releaseSource,
      (binding,reader,artifact,headers,phase)=>{assert.equal(headers,undefined);events.push('review');return verifyReleaseReview(binding,reader,artifact,()=>'d'.repeat(64),phase);},
      {log:message=>{assert.equal(message,'Reviewed immutable source/artifact and compatibility binding passed.');events.push('accepted');}});
    assert.deepEqual(events,reuse?['read-reuse','verify-reuse','verify-source-paths','review','accepted']:['inspect','verify-source-paths','review','accepted']);
    assert(f.calls.some(c=>c.file===f.files.environment&&c.environment==='native-staged'));
    assert(f.calls.some(c=>c.file===f.files.manifest));
    assert(!f.calls.some(c=>c.file===f.files.cutover||c.file==='/root/keryx/.env.local'));
    // The same unpublished receipt must continue to refuse the startup default.
    assert.throws(()=>f.verify());
  }
});
test('native compatibility cannot overload old SQLite digest fields, choose a target, or activate held/private/unknown state',()=>{
  for(const mutate of [f=>{f.review.economicSchemaDigest='f'.repeat(64);},f=>{delete f.review.nativeStorage;},f=>{f.review.nativeStorage.catalogSha256='0'.repeat(64);},f=>{f.review.nativeStorage.runtimeManifestSha256='bad';},
    f=>{f.manifest.backend.kind='sqlite';},f=>{f.manifest.backend.database='other';},f=>{f.manifest.backend.endpoint.kind='loopback';},f=>{f.manifest.backend.credentialPaths.reader='/root/other/reader.json';},f=>{f.manifest.identity.provenanceDigest='f'.repeat(64);},
    f=>{f.nativeEnvironment.legacySelectorsAbsent=false;},f=>{f.nativeEnvironment.manifest='/root/old-sqlite.json';},f=>{f.nativeEnvironment.baseUrl='https://other.invalid';},f=>{f.nativeEnvironment.publicPolicySha256='0'.repeat(64);},
    f=>{f.receipt.activationOutcome='unknown';},f=>{f.receipt.targetMode='held';},f=>{f.receipt.sourceCommit=f.binding.commit;},f=>{f.receipt.targetCommit='a'.repeat(40);},f=>{f.receipt.runtimeManifestSha256='a'.repeat(64);},f=>{f.receipt.identityDigest='a'.repeat(64);},
    f=>{f.receipt.finalDataDigest='bad';},f=>{f.receipt.sourceStartupRetired=false;},f=>{f.receipt.sourceWritersNaturallyEnded=false;},f=>{f.receipt.pendingOriginalsPreserved=false;},f=>{f.receipt.privateWorkerInactive=false;},f=>{f.receipt.newFunding=true;},f=>{f.receipt.financialPolicyChanged=true;},f=>{f.receipt.createdAt='2026-11-15';},f=>{f.receipt.extra='caller proof';}]){
    const f=nativeCompatibilityFixture();mutate(f);assert.throws(()=>f.verify('startup'));
  }
});
test('native cutover receipt remains explicit metadata; original transfer commit is separate from new serving commit',()=>{
  const f=nativeCompatibilityFixture();assert.notEqual(f.receipt.sourceCommit,f.receipt.targetCommit);assert.equal(verifyNativeCutoverReceipt(f.binding,f.review,f.receipt),f.receipt);
  assert.equal(Object.hasOwn(f.review,'economicSchemaDigest'),false);assert.equal(Object.hasOwn(f.review,'retainedEconomicStateSha256'),false);
  assert.equal(f.files.cutover,path.posix.dirname(f.binding.compatibilityReviewFile)+'/native-cutover.json');
});
test('native manifest uses the genuine runtime catalog digest and refuses the distinct SQL assembly digest',()=>{
  const f=nativeCompatibilityFixture();assert.equal(f.manifest.backend.sourceDigest,SERVER1_NATIVE_RELEASE.catalogSha256);
  assert.notEqual(SERVER1_NATIVE_RELEASE.catalogSha256,SERVER1_NATIVE_RELEASE.sourceSqlSha256);
  assert.equal(f.verify('startup'),f.review);assert.equal(f.review.nativeStorage.sourceSqlSha256,SERVER1_NATIVE_RELEASE.sourceSqlSha256);
  f.manifest.backend.sourceDigest=SERVER1_NATIVE_RELEASE.sourceSqlSha256;
  assert.throws(()=>f.verify('startup'));assert.throws(()=>f.verify('artifact'));
});

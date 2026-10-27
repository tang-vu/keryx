import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateEconomicMigrationConfig, readEconomicMigrationConfig, runEconomicDeployMigration,
  holdEconomicDeployRoles } from './redeploy-economic-migration.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const configFile = '/root/.local/share/release/economic.json';
const rolesFile = '/root/.local/share/release/roles.json';
const migrations = [
  ['keryx-redeploy-economic-migration-v1', '/root/keryx/scripts/mainnet-economic-storage-migrate.mts'],
  ['keryx-redeploy-original-fulfillment-migration-v1', '/root/keryx/scripts/mainnet-original-fulfillment-storage-migrate.mts'],
  ['keryx-redeploy-native-user-domains-migration-v1', '/root/keryx/scripts/private-profile-storage-migrate.mts'],
  ['keryx-redeploy-public-reference-archive-migration-v1', '/root/keryx/scripts/source-archive-storage-migrate.mts'],
];
const config = (format = migrations[0][0]) => ({ format,
  manifest: '/root/.local/share/storage/manifest.json', expectedManifestDigest: 'a'.repeat(64),
  expectedIdentityDigest: 'b'.repeat(64), backup: '/root/.local/share/release/original.sqlite',
  receipt: '/root/.local/share/release/migration.jsonl' });

test('configuration exposes only original identity bindings and fresh evidence destinations', () => {
  for (const [format] of migrations) {
    assert.deepEqual(validateEconomicMigrationConfig(config(format)), config(format));
    for (const mutate of [c => c.command = 'touch /tmp/unsafe', c => c.script = '/tmp/migrate.mts',
      c => c.format = 'v2', c => c.format = '__proto__', c => c.format = [format],
      c => c.format = '/root/keryx/scripts/mainnet-original-fulfillment-storage-migrate.mts',
      c => delete c.expectedIdentityDigest, c => c.expectedManifestDigest = 'A'.repeat(64),
      c => c.manifest = '/tmp/manifest.json', c => c.backup = '/root/.local/share/../old.sqlite',
      c => c.receipt = '/root/.local/share/a;touch.jsonl', c => c.backup = '/root/.local/share/a//b.sqlite',
      c => c.receipt = '/root/.local/share/x.sqlite', c => c.expectedIdentityDigest = null,
      c => c.expectedIdentityDigest = ['b'.repeat(64)]]) {
      const c = config(format); mutate(c); assert.throws(() => validateEconomicMigrationConfig(c));
    }
  }
});

for (const [format, script] of migrations) {
test(`protected ${format} reader hashes real bytes and refuses wrong hash, metadata, target race and host`, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-economic-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const file = path.join(directory, 'fixture.json'), bytes = Buffer.from(JSON.stringify(config(format)));
  fs.writeFileSync(file, bytes);
  let metadata = {}, parent = {}, changedTarget = false, reads = 0;
  const host = { platform: 'linux', uid: 0, fs: {
    lstatSync(value, options) {
      if (value !== configFile) return { isDirectory: () => true, isSymbolicLink: () => false,
        uid: 0, gid: 0, mode: 0o40700, ...parent };
      const stat = fs.lstatSync(file, options);
      return { ...stat, isFile: () => true, isSymbolicLink: () => false, uid: 0n, gid: 0n,
        mode: 0o100600n, ...(changedTarget && ++reads > 1 ? { ino: stat.ino + 1n } : {}), ...metadata };
    },
    openSync(_value, flags) { return fs.openSync(file, flags); },
    fstatSync: (...args) => fs.fstatSync(...args), readFileSync: (...args) => fs.readFileSync(...args),
    closeSync: (...args) => fs.closeSync(...args),
  } };
  assert.deepEqual(readEconomicMigrationConfig(configFile, sha(bytes), host), config(format));
  assert.throws(() => readEconomicMigrationConfig(configFile, '0'.repeat(64), host));
  for (const bad of ['/tmp/c.json', '/root/.local/share/../c.json', '/root/.local/share/c;echo.json'])
    assert.throws(() => readEconomicMigrationConfig(bad, sha(bytes), host));
  for (const bad of [{ uid: 1n }, { gid: 1n }, { mode: 0o100644n }, { nlink: 2n },
    { isSymbolicLink: () => true }, { size: 20000n }]) {
    metadata = bad; assert.throws(() => readEconomicMigrationConfig(configFile, sha(bytes), host));
  }
  metadata = {}; parent = { mode: 0o40777 };
  assert.throws(() => readEconomicMigrationConfig(configFile, sha(bytes), host));
  parent = {}; changedTarget = true; reads = 0;
  assert.throws(() => readEconomicMigrationConfig(configFile, sha(bytes), host));
  changedTarget = false;
  for (const extra of [{ uid: 1000 }, { platform: 'win32' }])
    assert.throws(() => readEconomicMigrationConfig(configFile, sha(bytes), { ...host, ...extra }));
  fs.writeFileSync(file, JSON.stringify({ ...config(format), manifest: configFile }));
  assert.throws(() => readEconomicMigrationConfig(configFile, sha(fs.readFileSync(file)), host));
});

test(`${format} runs only its fixed clean Node after positively reviewed roles and a protected-byte recheck`, () => {
  const calls = [], run = (...args) => { calls.push(args); return 'verified'; };
  assert.equal(runEconomicDeployMigration('migrate', config(format), rolesFile, 'c'.repeat(64), run,
    () => calls.push(['recheck'])), 'verified');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], ['/usr/bin/env', ['-i', 'PATH=/usr/bin:/bin', 'NODE_ENV=production',
    '/usr/bin/node', '/root/keryx/scripts/redeploy-reviewed-roles.mjs', rolesFile, 'c'.repeat(64), 'validate']]);
  assert.deepEqual(calls[1], ['recheck']);
  assert.deepEqual(calls[2], ['/usr/bin/env', ['-i', 'PATH=/usr/bin:/bin', 'NODE_ENV=production',
    '/usr/bin/node', '--import', '/root/keryx/node_modules/tsx/dist/loader.mjs',
    script, 'migrate', '--manifest', config(format).manifest,
    '--expected-manifest', 'a'.repeat(64), '--expected-identity', 'b'.repeat(64), '--backup', config(format).backup,
    '--receipt', config(format).receipt, '--writers-stopped']]);
  for (const args of [['migrate', '', 'c'.repeat(64)], ['migrate', rolesFile, 'bad'], ['rollback', rolesFile, 'c'.repeat(64)]])
    assert.throws(() => runEconomicDeployMigration(args[0], config(format), args[1], args[2], () => assert.fail(), () => assert.fail()));
  for (const mutate of [c => c.format = 'unreviewed', c => c.script = '/tmp/migrate.mts',
    c => delete c.expectedIdentityDigest]) {
    const invalid = config(format); mutate(invalid);
    assert.throws(() => runEconomicDeployMigration('migrate', invalid, rolesFile, 'c'.repeat(64),
      () => assert.fail('invalid configuration dispatched'), () => assert.fail('invalid configuration rechecked')));
  }
  const validation = [];
  runEconomicDeployMigration('validate', config(format), rolesFile, 'c'.repeat(64), (...a) => validation.push(a), () => {});
  assert.equal(validation.length, 1);
  let runs = 0;
  assert.throws(() => runEconomicDeployMigration('migrate', config(format), rolesFile, 'c'.repeat(64),
    () => { runs++; throw Error('active role'); }, () => assert.fail()));
  assert.equal(runs, 1);
  runs = 0;
  assert.throws(() => runEconomicDeployMigration('migrate', config(format), rolesFile, 'c'.repeat(64),
    () => { runs++; }, () => { throw Error('changed bytes'); }));
  assert.equal(runs, 1);
});
}

for (const [format, script] of migrations) {
test(`staged ${format} uses only the artifact-verified candidate and rechecks before and after DDL`, () => {
  const calls = [], commit = 'e'.repeat(40), cohort = `/root/.local/share/keryx-releases/${commit}/source`;
  const result = runEconomicDeployMigration('migrate', config(format), rolesFile, 'c'.repeat(64),
    (...args) => { calls.push(args); return 'migration receipt'; }, () => calls.push(['recheck']),
    { staged: '1', expectedCommit: commit });
  assert.equal(result, 'migration receipt');
  const role = name => ['/usr/bin/env', ['-i', 'PATH=/usr/bin:/bin', 'NODE_ENV=production',
    '/usr/bin/node', '/root/keryx/scripts/redeploy-reviewed-roles.mjs', rolesFile, 'c'.repeat(64), name, '1', commit]];
  assert.deepEqual(calls.slice(0, 3), [role('artifact'), role('validate'), ['recheck']]);
  assert.deepEqual(calls[3], ['/usr/bin/env', ['-i', 'PATH=/usr/bin:/bin', 'NODE_ENV=production',
    '/usr/bin/node', '--import', `${cohort}/node_modules/tsx/dist/loader.mjs`,
    cohort + script.slice('/root/keryx'.length), 'migrate', '--manifest', config(format).manifest,
    '--expected-manifest', 'a'.repeat(64), '--expected-identity', 'b'.repeat(64),
    '--backup', config(format).backup, '--receipt', config(format).receipt, '--writers-stopped']]);
  assert.deepEqual(calls.slice(4), [['recheck'], role('artifact'), role('validate')]);
  const validation = [];
  runEconomicDeployMigration('validate', config(format), rolesFile, 'c'.repeat(64),
    (...args) => validation.push(args), () => validation.push(['recheck']), { staged: '1', expectedCommit: commit });
  assert.deepEqual(validation, [role('artifact'), role('validate'), ['recheck']]);
  for (const options of [{ staged: '1' }, { staged: 'yes', expectedCommit: commit },
    { staged: '1', expectedCommit: 'A'.repeat(40) }, { staged: '1', expectedCommit: '../candidate' }])
    assert.throws(() => runEconomicDeployMigration('migrate', config(format), rolesFile, 'c'.repeat(64),
      () => assert.fail('unbound candidate executed'), () => assert.fail(), options));
  // Every pre/post artifact, role and protected-byte refusal must stop the one
  // sequence; no alternate script, automatic replay or predecessor restart.
  for (let failure = 0; failure < calls.length; failure++) {
    let at = 0; const observed = [];
    const step = entry => { observed.push(entry); if (at++ === failure) throw Error('refused boundary'); return 'receipt'; };
    assert.throws(() => runEconomicDeployMigration('migrate', config(format), rolesFile, 'c'.repeat(64),
      (...args) => step(args), () => step(['recheck']), { staged: '1', expectedCommit: commit }));
    assert.deepEqual(observed, calls.slice(0, failure + 1));
  }
});
}

test('failure hold stops both fixed roles even if the first stop fails; never starts or touches builds', () => {
  for (const broken of [false, true]) {
    const calls = [], rows = ['keryx', 'keryx-a2a-worker'].map(name => ({ name, pid: 4, pm2_env: { status: 'online' } }));
    const manager = { list: () => structuredClone(rows), run(args) {
      calls.push(args);
      if (args[0] === 'stop') {
        const row = rows.find(row => row.name === args[1]); row.pid = 0; row.pm2_env.status = 'stopped';
        if (broken && args[1] === 'keryx') throw Error('lost stop ACK');
      }
    } };
    if (broken) assert.throws(() => holdEconomicDeployRoles(manager)); else holdEconomicDeployRoles(manager);
    assert.deepEqual(calls, [['stop', 'keryx'], ['stop', 'keryx-a2a-worker'], ['save']]);
  }
  const calls = [];
  assert.throws(() => holdEconomicDeployRoles({ list: () => [{ name: 'keryx', pid: 7, pm2_env: { status: 'online' } }],
    run: args => calls.push(args) }));
  assert.deepEqual(calls, [['stop', 'keryx']]);
});

test('actual redeploy shell requires preparation, orders staged migration before startup, and fences subsequent failures', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-economic-deploy-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const trace = path.join(directory, 'trace');
  fs.writeFileSync(path.join(directory, 'ssh'), `#!/usr/bin/env bash
set -euo pipefail
args="$*"
input=""
if [[ "$args" == *'bash -s'* || "$args" == *'--input-type=module - '* ]]; then input=$(cat); fi
printf '%s\\n' "$args" >> "$ECONOMIC_TEST_TRACE"
if [[ "$input" == *'export function runEconomicDeployMigration'* ]]; then
  if [[ "$args" == *' - migrate '* ]]; then printf 'attempted' > "$ECONOMIC_TEST_TRACE.migrated"; fi
  if [[ "$args" == *' - migrate '* && "$ECONOMIC_TEST_FAILURE" == migration ]]; then exit 1; fi
elif [[ "$input" == *'export function deployReviewedRole'* ]]; then
  if [[ "$ECONOMIC_TEST_FAILURE" == config && -e "$ECONOMIC_TEST_TRACE.migrated" ]]; then exit 1; fi
  if [[ -n "$ECONOMIC_TEST_FAILURE" && "$args" == *" $ECONOMIC_TEST_FAILURE "* ]]; then exit 1; fi
fi
case "$args" in
  *'npm run typecheck'*) [[ "$ECONOMIC_TEST_FAILURE" != build ]] || exit 1 ;;
  *'git rev-parse --short HEAD'*) echo abc1234 ;;
  *'curl -fsS '*) [[ "$ECONOMIC_TEST_FAILURE" != health ]] || exit 1
    if [[ "\${KERYX_REDEPLOY_STAGED_RELEASE:-0}" == 1 ]]; then
      printf '{"commit":"%s"}\\n' "$KERYX_REDEPLOY_EXPECTED_COMMIT"
    else echo '{"commit":"abc1234"}'; fi ;;
esac
`, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o700 });
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'redeploy-vps.sh');
  const environment = { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    KERYX_SSH_BIN: path.join(directory, 'ssh').replaceAll('\\', '/'), ECONOMIC_TEST_TRACE: trace.replaceAll('\\', '/'),
    KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER: '1', KERYX_REDEPLOY_REVIEWED_PM2_CONFIG: rolesFile,
    KERYX_REDEPLOY_EXPECTED_COMMIT: 'e'.repeat(40),
    KERYX_REDEPLOY_REVIEWED_PM2_SHA256: 'c'.repeat(64), KERYX_REDEPLOY_ECONOMIC_MIGRATION_CONFIG: configFile,
    KERYX_REDEPLOY_ECONOMIC_MIGRATION_SHA256: 'd'.repeat(64) };
  const execute = (failure = '', extra = {}) => {
    fs.writeFileSync(trace, '');
    fs.rmSync(trace + '.migrated', { force: true });
    const result = spawnSync(bash, [script.replaceAll('\\', '/')], { env: { ...environment, ECONOMIC_TEST_FAILURE: failure, ...extra },
      encoding: 'utf8', timeout: 40000 });
    assert.ifError(result.error);
    return { ...result, trace: fs.readFileSync(trace, 'utf8') };
  };
  const ordinary = execute();
  assert.equal(ordinary.status, 1);
  assert.match(ordinary.stderr, /prepared staged release/);
  assert.equal(ordinary.trace, '', 'Refuse before SSH, source sync, build, migration or role mutation');
  const staged = { KERYX_REDEPLOY_STAGED_RELEASE: '1' };
  for (const extra of [{ KERYX_REDEPLOY_REVIEWED_PM2_CONFIG: '', KERYX_REDEPLOY_REVIEWED_PM2_SHA256: '' },
    { KERYX_REDEPLOY_EXPECTED_COMMIT: '' },
    { KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER: '0' }, { KERYX_REDEPLOY_ECONOMIC_MIGRATION_SHA256: '' },
    { KERYX_REDEPLOY_ECONOMIC_MIGRATION_CONFIG: '/tmp/untrusted.json' }]) {
    const result = execute('', { ...staged, ...extra }); assert.notEqual(result.status, 0); assert.equal(result.trace, '');
  }
  const prepared = execute('', staged);
  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  const stagedAt = text => prepared.trace.indexOf(text);
  assert.ok(stagedAt(' artifact 1 ' + 'e'.repeat(40)) >= 0);
  assert.ok(stagedAt(' artifact 1 ' + 'e'.repeat(40)) < stagedAt('- migrate ' + configFile));
  assert.ok(stagedAt('- validate ' + configFile) < stagedAt('- migrate ' + configFile));
  assert.ok(stagedAt('- migrate ' + configFile) < stagedAt(rolesFile + ' ' + 'c'.repeat(64) + ' a2a 1 '));
  assert.match(prepared.trace, new RegExp('- migrate ' + configFile + ' ' + 'd'.repeat(64) +
    ' ' + rolesFile + ' ' + 'c'.repeat(64) + ' 1 ' + 'e'.repeat(40)));
  assert.doesNotMatch(prepared.trace, /git (fetch|reset)|npm (ci|run)|dependency-state|NEXT_DIST_DIR|mv \.next|rm -rf|pm2 (reload|restart)|bash -s -- (resume|stop)|crontab/);
  assert.doesNotMatch(prepared.trace, / - hold\n/);
  for (const failure of ['migration', 'a2a', 'web', 'health', 'config']) {
    const result = execute(failure, staged);
    assert.notEqual(result.status, 0, 'staged ' + failure);
    assert.match(result.trace, / - hold\n/);
    assert.match(result.stderr, /No automatic rollback/);
    assert.doesNotMatch(result.trace, /git (fetch|reset)|npm (ci|run)|mv \.next|rm -rf|pm2 (reload|restart)|bash -s -- resume|crontab/);
  }
  const refusedArtifact = execute('artifact', staged);
  assert.notEqual(refusedArtifact.status, 0);
  assert.doesNotMatch(refusedArtifact.trace, / - (migrate|hold)/);
});

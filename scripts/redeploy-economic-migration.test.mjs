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
const config = () => ({ format: 'keryx-redeploy-economic-migration-v1',
  manifest: '/root/.local/share/storage/manifest.json', expectedManifestDigest: 'a'.repeat(64),
  expectedIdentityDigest: 'b'.repeat(64), backup: '/root/.local/share/release/original.sqlite',
  receipt: '/root/.local/share/release/migration.jsonl' });

test('configuration exposes only original identity bindings and fresh evidence destinations', () => {
  assert.deepEqual(validateEconomicMigrationConfig(config()), config());
  for (const mutate of [c => c.command = 'touch /tmp/unsafe', c => c.format = 'v2',
    c => delete c.expectedIdentityDigest, c => c.expectedManifestDigest = 'A'.repeat(64),
    c => c.manifest = '/tmp/manifest.json', c => c.backup = '/root/.local/share/../old.sqlite',
    c => c.receipt = '/root/.local/share/a;touch.jsonl', c => c.backup = '/root/.local/share/a//b.sqlite',
    c => c.receipt = '/root/.local/share/x.sqlite', c => c.expectedIdentityDigest = null,
    c => c.expectedIdentityDigest = ['b'.repeat(64)]]) {
    const c = config(); mutate(c); assert.throws(() => validateEconomicMigrationConfig(c));
  }
});

test('protected reader hashes real bytes and refuses wrong hash, metadata, target race and host', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-economic-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const file = path.join(directory, 'fixture.json'), bytes = Buffer.from(JSON.stringify(config()));
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
  assert.deepEqual(readEconomicMigrationConfig(configFile, sha(bytes), host), config());
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
  fs.writeFileSync(file, JSON.stringify({ ...config(), manifest: configFile }));
  assert.throws(() => readEconomicMigrationConfig(configFile, sha(fs.readFileSync(file)), host));
});

test('migration runs only fixed clean Node after positively reviewed roles and a protected-byte recheck', () => {
  const calls = [], run = (...args) => { calls.push(args); return 'verified'; };
  assert.equal(runEconomicDeployMigration('migrate', config(), rolesFile, 'c'.repeat(64), run,
    () => calls.push(['recheck'])), 'verified');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], ['/usr/bin/env', ['-i', 'PATH=/usr/bin:/bin', 'NODE_ENV=production',
    '/usr/bin/node', '/root/keryx/scripts/redeploy-reviewed-roles.mjs', rolesFile, 'c'.repeat(64), 'validate']]);
  assert.deepEqual(calls[1], ['recheck']);
  assert.deepEqual(calls[2], ['/usr/bin/env', ['-i', 'PATH=/usr/bin:/bin', 'NODE_ENV=production',
    '/usr/bin/node', '--import', '/root/keryx/node_modules/tsx/dist/loader.mjs',
    '/root/keryx/scripts/mainnet-economic-storage-migrate.mts', 'migrate', '--manifest', config().manifest,
    '--expected-manifest', 'a'.repeat(64), '--expected-identity', 'b'.repeat(64), '--backup', config().backup,
    '--receipt', config().receipt, '--writers-stopped']]);
  for (const args of [['migrate', '', 'c'.repeat(64)], ['migrate', rolesFile, 'bad'], ['rollback', rolesFile, 'c'.repeat(64)]])
    assert.throws(() => runEconomicDeployMigration(args[0], config(), args[1], args[2], () => assert.fail(), () => assert.fail()));
  const validation = [];
  runEconomicDeployMigration('validate', config(), rolesFile, 'c'.repeat(64), (...a) => validation.push(a), () => {});
  assert.equal(validation.length, 1);
  let runs = 0;
  assert.throws(() => runEconomicDeployMigration('migrate', config(), rolesFile, 'c'.repeat(64),
    () => { runs++; throw Error('active role'); }, () => assert.fail()));
  assert.equal(runs, 1);
  runs = 0;
  assert.throws(() => runEconomicDeployMigration('migrate', config(), rolesFile, 'c'.repeat(64),
    () => { runs++; }, () => { throw Error('changed bytes'); }));
  assert.equal(runs, 1);
});

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

test('actual redeploy shell orders migration after build, before startup, and fences all subsequent failures', t => {
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
  if [[ "$args" == *" $ECONOMIC_TEST_FAILURE" ]]; then exit 1; fi
fi
case "$args" in
  *'npm run typecheck'*) [[ "$ECONOMIC_TEST_FAILURE" != build ]] || exit 1 ;;
  *'git rev-parse --short HEAD'*) echo abc1234 ;;
  *'curl -fsS '*) [[ "$ECONOMIC_TEST_FAILURE" != health ]] || exit 1; echo '{"commit":"abc1234"}' ;;
esac
`, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o700 });
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'redeploy-vps.sh');
  const environment = { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    KERYX_SSH_BIN: path.join(directory, 'ssh').replaceAll('\\', '/'), ECONOMIC_TEST_TRACE: trace.replaceAll('\\', '/'),
    KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER: '1', KERYX_REDEPLOY_REVIEWED_PM2_CONFIG: rolesFile,
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
  const success = execute();
  assert.equal(success.status, 0, success.stdout + success.stderr);
  const at = text => success.trace.indexOf(text);
  assert.ok(at('- validate ' + configFile) < at('git fetch'));
  assert.ok(at('npm run build') < at('- migrate ' + configFile));
  assert.ok(at('- migrate ' + configFile) < at(rolesFile + ' ' + 'c'.repeat(64) + ' a2a'));
  assert.ok(!success.trace.includes(' - hold'));
  assert.ok(!/rm -rf|pm2 (reload|restart)|bash -s -- (resume|stop)|crontab/.test(success.trace));
  for (const failure of ['migration', 'a2a', 'web', 'health', 'config']) {
    const result = execute(failure);
    assert.notEqual(result.status, 0, failure);
    assert.match(result.trace, / - hold\n/);
    assert.doesNotMatch(result.trace, /rm -rf|pm2 (reload|restart)|bash -s -- resume|crontab/);
    assert.match(result.stderr, /No automatic rollback/);
  }
  const build = execute('build');
  assert.notEqual(build.status, 0); assert.doesNotMatch(build.trace, / - (migrate|hold)/);
  for (const extra of [{ KERYX_REDEPLOY_REVIEWED_PM2_CONFIG: '', KERYX_REDEPLOY_REVIEWED_PM2_SHA256: '' },
    { KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER: '0' }, { KERYX_REDEPLOY_ECONOMIC_MIGRATION_SHA256: '' },
    { KERYX_REDEPLOY_ECONOMIC_MIGRATION_CONFIG: '/tmp/untrusted.json' }]) {
    const result = execute('', extra); assert.notEqual(result.status, 0); assert.equal(result.trace, '');
  }
});

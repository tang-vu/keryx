import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { REVIEWED_CONTROLS, TRANSPORT_CONTROLS, redeployEnvironment, runRedeploy, runRedeployCommand } from './redeploy.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const reviewed = {
  KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER: '1',
  KERYX_REDEPLOY_REVIEWED_PM2_CONFIG: '/root/.local/share/reviewed/roles.json',
  KERYX_REDEPLOY_REVIEWED_PM2_SHA256: 'a'.repeat(64),
  KERYX_REDEPLOY_EXPECTED_COMMIT: 'b'.repeat(40),
  KERYX_REDEPLOY_STAGED_RELEASE: '1',
};
test('Windows forwards every reviewed control without translating native paths', () => {
  const env = redeployEnvironment({ ...reviewed, WSLENV: 'USER_SETTING/u:KERYX_REDEPLOY_REVIEWED_PM2_CONFIG/p' }, 'win32');
  assert.equal(env.WSLENV, ['USER_SETTING/u', ...TRANSPORT_CONTROLS].join(':'));
  for (const name of REVIEWED_CONTROLS) assert.equal(env[name], reviewed[name]);
});
test('partial reviewed controls refuse before a shell or deployment starts', () => {
  assert.throws(() => redeployEnvironment({ KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER: '1' }), /four complete/);
});
test('reviewed stop-before-build refuses before transport probing or a deployment starts', async () => {
  for (const staged of [undefined, '0']) {
    const env = { ...reviewed, KERYX_REDEPLOY_STAGED_RELEASE: staged };
    await assert.rejects(runRedeploy(env, () => assert.fail('deployment started'),
      () => assert.fail('transport probed')), /prepared staged release/);
  }
});
test('direct shell entry refuses reviewed stop-before-build before attempting SSH', () => {
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const result = spawnSync(bash, ['scripts/redeploy-vps.sh'], {
    env: { ...process.env, ...reviewed, KERYX_REDEPLOY_STAGED_RELEASE: '0',
      KERYX_SSH_BIN: '/nonexistent/keryx-test-must-not-contact-ssh' },
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /prepared staged release/);
  assert.doesNotMatch(result.stderr, /No such file|ssh .*failed/);
});
test('explicit legacy/testnet controls preserve their existing values', () => {
  const env = redeployEnvironment({ KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER: '0', KERYX_REDEPLOY_EXPECTED_COMMIT: 'b'.repeat(40) }, 'linux');
  assert.equal(env.KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER, '0');
  assert.equal(env.KERYX_REDEPLOY_EXPECTED_COMMIT, 'b'.repeat(40));
});
test('economic migration controls travel unchanged and require a complete reviewed pair', () => {
  const extra = { KERYX_REDEPLOY_ECONOMIC_MIGRATION_CONFIG: '/root/.local/share/reviewed/economic.json',
    KERYX_REDEPLOY_ECONOMIC_MIGRATION_SHA256: 'c'.repeat(64) };
  const env = redeployEnvironment({ ...reviewed, ...extra }, 'win32');
  assert.equal(env.KERYX_REDEPLOY_ECONOMIC_MIGRATION_CONFIG, extra.KERYX_REDEPLOY_ECONOMIC_MIGRATION_CONFIG);
  assert.throws(() => redeployEnvironment(extra), /complete reviewed/);
});
test('staged release transports an explicit reviewed transition with complete migration controls', () => {
  const extra = { KERYX_REDEPLOY_STAGED_RELEASE: '1' };
  const env = redeployEnvironment({ ...reviewed, ...extra }, 'win32');
  assert.equal(env.KERYX_REDEPLOY_STAGED_RELEASE, '1');
  assert.throws(() => redeployEnvironment(extra), /requires complete/);
  const migration = redeployEnvironment({ ...reviewed, ...extra,
    KERYX_REDEPLOY_ECONOMIC_MIGRATION_CONFIG: '/root/.local/share/reviewed/economic.json',
    KERYX_REDEPLOY_ECONOMIC_MIGRATION_SHA256: 'a'.repeat(64) });
  assert.equal(migration.KERYX_REDEPLOY_STAGED_RELEASE, '1');
  assert.equal(migration.KERYX_REDEPLOY_ECONOMIC_MIGRATION_SHA256, 'a'.repeat(64));
  assert.throws(() => redeployEnvironment({ ...reviewed, ...extra,
    KERYX_REDEPLOY_ECONOMIC_MIGRATION_CONFIG: '/root/.local/share/reviewed/economic.json' }), /complete reviewed/);
  assert.throws(() => redeployEnvironment({ ...reviewed, KERYX_REDEPLOY_STAGED_RELEASE: 'yes' }));
});
test('lost WSL controls refuse before the deployment launcher', async () => {
  let launched = false;
  await assert.rejects(runRedeploy(reviewed, () => { launched = true; }, () => ({ status: 0, signal: null, stdout: '\n\n\n\n', stderr: '' })), /no deployment started/);
  assert.equal(launched, false);
});
test('matching bash readback starts exactly one deployment and preserves its real failure', async () => {
  let launches = 0;
  const code = await runRedeploy(reviewed, (_binary, args, options) => {
    launches++; assert.deepEqual(args, ['scripts/redeploy-vps.sh']);
    assert.equal(options.env.KERYX_REDEPLOY_EXPECTED_COMMIT, reviewed.KERYX_REDEPLOY_EXPECTED_COMMIT);
    const child = new EventEmitter(); queueMicrotask(() => child.emit('close', 7, null)); return child;
  }, () => ({ status: 0, signal: null, stdout: TRANSPORT_CONTROLS.map(name => reviewed[name] ?? '').join('\n') + '\n', stderr: '' }));
  assert.equal(launches, 1); assert.equal(code, 7);
});
test('explicit preparation never probes SSH, holds writers or enters the deployment path', async () => {
  let prepared = false, deployed = false;
  const root = path.resolve('.');
  const seams = { prepare: options => { prepared = true; assert.equal(options.repo, root); return { productionAdmitted: false }; },
    deploy: () => { deployed = true; return 0; } };
  const result = await runRedeployCommand(['--prepare-release', root, root, 'a'.repeat(40), root, root], seams);
  assert.equal(result.productionAdmitted, false); assert.equal(prepared, true); assert.equal(deployed, false);
  for (const args of [['--prepare-release'], ['--unknown'], ['--prepare-release', '.', root, 'a'.repeat(40), root, root]])
    await assert.rejects(runRedeployCommand(args, seams));
  assert.equal(deployed, false);
  assert.equal(await runRedeployCommand([], seams), 0); assert.equal(deployed, true);
});

test('mainnet public compilation is one explicit keyless preparation option, not deployment', async () => {
  const root = path.resolve('.'), calls = [];
  const seams = { prepare: options => { calls.push(options); return { productionAdmitted: false }; },
    deploy: () => assert.fail('preparation entered deploy') };
  const args = ['--prepare-release', root, root, 'a'.repeat(40), root, root];
  await runRedeployCommand(args, seams);
  assert.equal(Object.hasOwn(calls[0], 'mainnetPublicBuild'), false);
  const result = await runRedeployCommand([...args, '--mainnet-public-build'], seams);
  assert.equal(calls[1].mainnetPublicBuild, true);
  assert.equal(result.productionAdmitted, false);
  for (const suffix of [['arc'], ['--mainnet-public-build', '--mainnet-public-build'], ['--runtime-env=/funded']])
    await assert.rejects(runRedeployCommand([...args, ...suffix], seams));
  assert.equal(calls.length, 2);
});

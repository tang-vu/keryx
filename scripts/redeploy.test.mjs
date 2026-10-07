import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { REVIEWED_CONTROLS, TRANSPORT_CONTROLS, redeployEnvironment, runRedeploy } from './redeploy.mjs';
const reviewed = {
  KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER: '1',
  KERYX_REDEPLOY_REVIEWED_PM2_CONFIG: '/root/.local/share/reviewed/roles.json',
  KERYX_REDEPLOY_REVIEWED_PM2_SHA256: 'a'.repeat(64),
  KERYX_REDEPLOY_EXPECTED_COMMIT: 'b'.repeat(40),
};
test('Windows forwards every reviewed control without translating native paths', () => {
  const env = redeployEnvironment({ ...reviewed, WSLENV: 'USER_SETTING/u:KERYX_REDEPLOY_REVIEWED_PM2_CONFIG/p' }, 'win32');
  assert.equal(env.WSLENV, ['USER_SETTING/u', ...TRANSPORT_CONTROLS].join(':'));
  for (const name of REVIEWED_CONTROLS) assert.equal(env[name], reviewed[name]);
});
test('partial reviewed controls refuse before a shell or deployment starts', () => {
  assert.throws(() => redeployEnvironment({ KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER: '1' }), /four complete/);
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

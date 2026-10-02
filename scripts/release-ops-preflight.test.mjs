import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectAlertFile, inspectCron, inspectUnits, runPreflight } from './release-ops-preflight.mjs';

const expectedCron = [
  '0 * * * * cd /root/keryx && /usr/bin/npm run backup >> backup.log 2>&1 # keryx-backup',
  '30 * * * * cd /root/keryx && /usr/bin/npm run check-treasury >> treasury.log 2>&1 # keryx-treasury',
  '45 * * * * cd /root/keryx && /usr/bin/npm run check-registry >> registry.log 2>&1 # keryx-registry',
  '15 * * * * cd /root/keryx && /usr/bin/npm run check-llm >> llm.log 2>&1 # keryx-llm',
  '50 * * * * cd /root/keryx && /usr/bin/npm run check-dispatches >> dispatch.log 2>&1 # keryx-dispatches',
  '55 * * * * cd /root/keryx && /usr/bin/npm run check-settlement >> settlement.log 2>&1 # keryx-settlement',
  '*/10 * * * * cd /root/keryx && /usr/bin/npm run reconcile-payments >> reconcile.log 2>&1 # keryx-reconcile',
].join('\n');
const observed = (output, ok = true) => ({ output, ok });
const unit = (load, active = 'inactive', pid = '0') => observed(`LoadState=${load}\nActiveState=${active}\nMainPID=${pid}\n`);
const release = '8bc7cffeac2d9d90bdb834581d7607ecf4b1cb03';
const pinnedBackup = `0 * * * * cd /root/keryx && /usr/bin/node --import /root/keryx/node_modules/tsx/dist/loader.mjs --no-warnings --env-file=.env.local --env-file=/root/.config/keryx-backup.env /root/.local/share/keryx-backup/${release}/scripts/backup-db.mts >> /root/keryx/data/backups/backup.log 2>&1 # keryx-backup`;
const backupCheck = (entry) => inspectCron(entry).find((check) => check.label === 'cron:backup');

test('cron inventory requires exactly one expected active schedule and command', () => {
  assert.ok(inspectCron(expectedCron).every((check) => check.status === 'pass'));
  const altered = expectedCron.replace('*/10 * * * *', '*/30 * * * *');
  assert.equal(inspectCron(altered).find((check) => check.label === 'cron:reconcile').status, 'fail');
  assert.equal(inspectCron(`${expectedCron}\n${expectedCron.split('\n')[0]}`).find((check) => check.label === 'cron:backup').status, 'fail');
  assert.equal(inspectCron(expectedCron.replace('npm run check-llm', 'npm run check-dispatches')).find((check) => check.label === 'cron:llm').status, 'fail');
  assert.equal(inspectCron(expectedCron.replace('cd /root/keryx && /usr/bin/npm run backup', 'cd /tmp && /usr/bin/npm run backup')).find((check) => check.label === 'cron:backup').status, 'fail');
});

test('accepts the approved hourly pinned backup and provisioned legacy log paths', () => {
  const inventory = expectedCron.replace(expectedCron.split('\n')[0], pinnedBackup);
  assert.ok(inspectCron(inventory).every((check) => check.status === 'pass'));
  assert.equal(backupCheck(pinnedBackup.replace(release, 'a'.repeat(40))).status, 'pass');
  const provisioned = expectedCron.replaceAll('>> ', '>> /root/keryx/data/backups/').replace('dispatch.log', 'dispatches.log');
  assert.ok(inspectCron(provisioned).every((check) => check.status === 'pass'));
  assert.ok(inspectCron(expectedCron.replaceAll('/usr/bin/npm', 'npm')).every((check) => check.status === 'pass'));
});

test('rejects altered pinned paths, runtime, environment, flags, schedule and source identity', () => {
  for (const changed of [
    pinnedBackup.replace('0 * * * *', '*/10 * * * *'),
    pinnedBackup.replace('cd /root/keryx', 'cd /tmp'),
    pinnedBackup.replace('/usr/bin/node', '/tmp/node'),
    pinnedBackup.replace('/root/keryx/node_modules/tsx/dist/loader.mjs', '/tmp/loader.mjs'),
    pinnedBackup.replace('--env-file=.env.local', '--env-file=/tmp/.env.local'),
    pinnedBackup.replace('--env-file=/root/.config/keryx-backup.env', '--env-file=/tmp/backup.env'),
    pinnedBackup.replace(' --env-file=/root/.config/keryx-backup.env', ''),
    pinnedBackup.replace('--no-warnings ', ''),
    pinnedBackup.replace('--no-warnings', '--no-warnings --eval=synthetic'),
    pinnedBackup.replace(release, release.slice(0, 7)),
    pinnedBackup.replace(release, release.toUpperCase()),
    pinnedBackup.replace(release, `${release}/../other`),
    pinnedBackup.replace('/root/.local/share/keryx-backup/', '/tmp/keryx-backup/'),
    pinnedBackup.replace('/scripts/backup-db.mts', '/scripts/restore-backup.mts'),
    pinnedBackup.replace(' >>', ' --init-r2 >>'),
    pinnedBackup.replace(' >>', ' --download-r2 synthetic >>'),
    pinnedBackup.replace('/root/keryx/data/backups/backup.log', '/tmp/backup.log'),
    pinnedBackup.replace(' >>', ' && echo synthetic >>'),
    pinnedBackup.replace(' # keryx-backup', ' ; echo synthetic # keryx-backup'),
    pinnedBackup.replace(' # keryx-backup', ' # keryx-backup unexpected'),
  ]) assert.equal(backupCheck(changed).status, 'fail');
});

test('rejects duplicate backup modes and arbitrary shell operations in legacy inventory', () => {
  for (const entries of [
    `${pinnedBackup}\n${pinnedBackup}`,
    `${pinnedBackup}\n${expectedCron.split('\n')[0]}`,
    `${pinnedBackup}\n${pinnedBackup} ; echo synthetic`,
  ]) assert.equal(backupCheck(entries).status, 'fail');
  for (const suffix of [' && echo synthetic', ' ; echo synthetic', ' | cat', ' &', ' --unexpected']) {
    const altered = expectedCron.replaceAll(' # keryx-', `${suffix} # keryx-`);
    assert.ok(inspectCron(altered).every((check) => check.status === 'fail'));
  }
});

test('alert check reports presence only and never returns the value', () => {
  const secret = 'https://private.example/secret-token';
  const good = inspectAlertFile(`# KERYX_ALERT_WEBHOOK=comment\nKERYX_ALERT_WEBHOOK="${secret}"`);
  assert.equal(good.status, 'pass');
  assert.ok(!JSON.stringify(good).includes(secret));
  for (const contents of ['', 'KERYX_ALERT_WEBHOOK=', 'KERYX_ALERT_WEBHOOK=""', 'KERYX_ALERT_WEBHOOK=# comment']) {
    assert.equal(inspectAlertFile(contents).status, 'fail');
  }
});

test('private Telegram pair and optional webhook are configured but never delivery verified', () => {
  const pair = 'KERYX_ALERT_TELEGRAM_BOT_TOKEN="123:synthetic_secret" # local only\nKERYX_ALERT_TELEGRAM_CHAT_ID=\'-1001234567890\'';
  for (const contents of [pair, `KERYX_ALERT_WEBHOOK=\n${pair}`, `KERYX_ALERT_WEBHOOK=https://synthetic.example/secret\n${pair}`]) {
    const check = inspectAlertFile(contents);
    assert.equal(check.status, 'pass');
    assert.match(check.detail, /Telegram ops.*delivery unverified/);
    assert.doesNotMatch(JSON.stringify(check), /synthetic_secret|1001234567890|synthetic.example/);
  }
  assert.equal(inspectAlertFile(pair.replace('KERYX_ALERT_TELEGRAM_BOT_TOKEN=', 'export KERYX_ALERT_TELEGRAM_BOT_TOKEN=')).status, 'pass');
});

test('partial, invalid and duplicate alert config fails even alongside a webhook', () => {
  const webhook = 'KERYX_ALERT_WEBHOOK=https://synthetic.example/private\n';
  for (const contents of [
    'KERYX_ALERT_TELEGRAM_BOT_TOKEN=123:synthetic_secret',
    'KERYX_ALERT_TELEGRAM_CHAT_ID=-1001234567890',
    'KERYX_ALERT_TELEGRAM_BOT_TOKEN=123:synthetic_secret\nKERYX_ALERT_TELEGRAM_CHAT_ID="" # missing',
    'KERYX_ALERT_TELEGRAM_BOT_TOKEN=123:synthetic_secret\nKERYX_ALERT_TELEGRAM_CHAT_ID=0',
    'KERYX_ALERT_TELEGRAM_BOT_TOKEN=../secret\nKERYX_ALERT_TELEGRAM_CHAT_ID=-1001234567890',
    'KERYX_ALERT_TELEGRAM_BOT_TOKEN=123:synthetic_secret\nKERYX_ALERT_TELEGRAM_BOT_TOKEN=123:synthetic_secret',
    'KERYX_ALERT_TELEGRAM_CHAT_ID=\nKERYX_ALERT_TELEGRAM_CHAT_ID=',
    'KERYX_ALERT_WEBHOOK=second',
    'KERYX_ALERT_TELEGRAM_BOT_TOKEN="unterminated',
  ]) {
    const check = inspectAlertFile(webhook + contents);
    assert.equal(check.status, 'fail');
    assert.doesNotMatch(JSON.stringify(check), /synthetic_secret|1001234567890|synthetic.example|unterminated/);
  }
  assert.equal(inspectAlertFile('KERYX_ALERT_WEBHOOK=https://synthetic.example/private # comment\nKERYX_ALERT_TELEGRAM_BOT_TOKEN= # disabled\nKERYX_ALERT_TELEGRAM_CHAT_ID=""').status, 'pass');
});

test('worker is required and absent cycle is informational unless explicitly required', () => {
  const worker = unit('loaded', 'active', '123');
  const absent = unit('not-found');
  assert.deepEqual(inspectUnits(worker, absent, absent).map((check) => check.status), ['pass', 'info']);
  assert.deepEqual(inspectUnits(worker, absent, absent, true).map((check) => check.status), ['pass', 'fail']);
  assert.deepEqual(inspectUnits(worker, unit('loaded', 'active'), unit('loaded')).map((check) => check.status), ['pass', 'pass']);
  assert.equal(inspectUnits(unit('loaded', 'inactive'), absent, absent)[0].status, 'fail');
  assert.equal(inspectUnits(worker, unit('loaded', 'inactive'), unit('loaded'))[1].status, 'fail');
  assert.equal(inspectUnits(worker, unit('loaded', 'active'), unit('loaded', 'failed'))[1].status, 'fail');
});

test('full preflight surfaces missing alert without exposing command or file content', () => {
  const calls = [];
  const command = (name, args) => {
    calls.push([name, args]);
    if (name === 'crontab') return observed(expectedCron);
    if (name === 'pm2') return observed('123\n');
    if (args[1] === 'keryx-private-worker.service') return unit('loaded', 'active', '123');
    return unit('not-found');
  };
  const checks = runPreflight({ command, readEnv: () => 'KERYX_ALERT_WEBHOOK=private-value' });
  assert.ok(checks.every((check) => check.status !== 'fail'));
  assert.equal(calls.length, 6);
  assert.ok(calls.filter(([name]) => name === 'systemctl').every(([, args]) => args.includes('--no-pager')));
  assert.ok(!JSON.stringify(checks).includes('private-value'));
  assert.equal(runPreflight({ command, readEnv: () => '' }).at(-1).status, 'fail');
});

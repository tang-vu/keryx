// Read-only host inventory for a release review. This never loads .env.local into
// process.env or prints command output (which can include private configuration).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const cronJobs = [
  ['backup', '0 * * * *', 'backup'],
  ['treasury', '30 * * * *', 'check-treasury'],
  ['registry', '45 * * * *', 'check-registry'],
  ['llm', '15 * * * *', 'check-llm'],
  ['dispatches', '50 * * * *', 'check-dispatches'],
  ['settlement', '55 * * * *', 'check-settlement'],
  ['reconcile', '*/10 * * * *', 'reconcile-payments'],
];

function result(label, status, detail) { return { label, status, detail }; }

export function inspectCron(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  return cronJobs.map(([tag, schedule, command]) => {
    const entries = lines.filter((line) => line.endsWith(`# keryx-${tag}`));
    const matches = entries.length === 1 && entries[0].startsWith(`${schedule} `)
      && new RegExp(`^cd\\s+/root/keryx\\s+&&\\s+(?:/\\S+/)?npm\\s+run\\s+${command}(?:\\s|$)`)
        .test(entries[0].slice(schedule.length).trimStart());
    return result(`cron:${tag}`, matches ? 'pass' : 'fail', matches ? 'scheduled' : entries.length === 0 ? 'missing' : 'duplicate or unexpected schedule/command');
  });
}

export function inspectAlertFile(contents) {
  const assignments = contents.split(/\r?\n/).filter((line) => /^\s*KERYX_ALERT_WEBHOOK\s*=/.test(line));
  if (assignments.length !== 1) return result('alert:webhook', 'fail', assignments.length ? 'duplicate assignment' : 'missing assignment');
  let value = assignments[0].replace(/^\s*KERYX_ALERT_WEBHOOK\s*=\s*/, '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim();
  return result('alert:webhook', value && !value.startsWith('#') ? 'pass' : 'fail', value && !value.startsWith('#') ? 'configured (delivery unverified)' : 'empty assignment');
}

function inspectPid(name, observation) {
  const pids = observation.ok ? observation.output.trim().split(/\s+/) : [];
  const active = pids.length > 0 && pids.every((pid) => /^[1-9]\d*$/.test(pid));
  return result(`pm2:${name}`, active ? 'pass' : 'fail', active ? 'running PID reported' : 'no running PID reported');
}

function properties(observation) {
  if (!observation.ok) return {};
  return Object.fromEntries(observation.output.split(/\r?\n/).filter((line) => line.includes('=')).map((line) => {
    const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
  }));
}

export function inspectUnits(worker, timer, cycle, requireTimer = false) {
  const w = properties(worker), t = properties(timer), c = properties(cycle);
  const workerOk = w.LoadState === 'loaded' && w.ActiveState === 'active' && /^[1-9]\d*$/.test(w.MainPID ?? '');
  const results = [result('systemd:private-worker', workerOk ? 'pass' : 'fail', workerOk ? 'active with PID' : 'not active with PID')];
  const absent = t.LoadState === 'not-found' && c.LoadState === 'not-found';
  const scheduled = t.LoadState === 'loaded' && t.ActiveState === 'active'
    && c.LoadState === 'loaded' && ['inactive', 'activating', 'active'].includes(c.ActiveState);
  const status = scheduled ? 'pass' : requireTimer || !absent ? 'fail' : 'info';
  results.push(result('systemd:withdrawal-cycle', status, scheduled ? 'timer active; service loaded' : absent ? 'not installed (activation gated)' : 'timer or service not in expected state'));
  return results;
}

export function runPreflight({ command, readEnv, requireTimer = false }) {
  const cron = command('crontab', ['-l']);
  const checks = cron.ok ? inspectCron(cron.output) : cronJobs.map(([tag]) => result(`cron:${tag}`, 'fail', 'crontab unavailable'));
  for (const name of ['keryx', 'keryx-a2a-worker']) checks.push(inspectPid(name, command('pm2', ['pid', name])));
  const show = (unit) => command('systemctl', ['show', unit, '--property=LoadState,ActiveState,MainPID', '--no-pager']);
  checks.push(...inspectUnits(show('keryx-private-worker.service'), show('keryx-withdrawal-cycle.timer'), show('keryx-withdrawal-cycle.service'), requireTimer));
  try { checks.push(inspectAlertFile(readEnv())); }
  catch { checks.push(result('alert:webhook', 'fail', 'environment file unreadable')); }
  return checks;
}

function command(name, args) {
  const child = spawnSync(name, args, { encoding: 'utf8', timeout: 10_000 });
  return { ok: child.status === 0 && !child.error, output: child.stdout ?? '' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--require-withdrawal-timer')) {
    console.error('Usage: node scripts/release-ops-preflight.mjs [--require-withdrawal-timer]');
    process.exitCode = 2;
  } else {
    const checks = runPreflight({ command, readEnv: () => readFileSync('.env.local', 'utf8'), requireTimer: args.includes('--require-withdrawal-timer') });
    for (const check of checks) console.log(`${check.status.toUpperCase()} ${check.label}: ${check.detail}`);
    if (checks.some((check) => check.status === 'fail')) process.exitCode = 1;
  }
}

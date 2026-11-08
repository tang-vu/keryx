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

// Source, runtime, loader, environment order and log sink form one approved pinned mode.
const pinnedBackupCommand = /^cd\s+\/root\/keryx\s+&&\s+\/usr\/bin\/node\s+--import\s+\/root\/keryx\/node_modules\/tsx\/dist\/loader\.mjs\s+--no-warnings\s+--env-file=\.env\.local\s+--env-file=\/root\/\.config\/keryx-backup\.env\s+\/root\/\.local\/share\/keryx-backup\/[0-9a-f]{40}\/scripts\/backup-db\.mts\s+>>\s+\/root\/keryx\/data\/backups\/backup\.log\s+2>&1\s+# keryx-backup$/;

function intendedCommand(tag, command, body) {
  if (tag === 'backup' && pinnedBackupCommand.test(body)) return true;
  const log = tag === 'dispatches' ? 'dispatch(?:es)?' : tag;
  // Keep legacy npm commands and their known optional log redirection. Anchor the whole command
  // so an extra flag, executable or shell operation cannot masquerade as the expected job.
  return new RegExp(`^cd\\s+/root/keryx\\s+&&\\s+(?:/(?:[A-Za-z0-9_.-]+/)+)?npm\\s+run\\s+${command}(?:\\s+>>\\s+(?:/root/keryx/data/backups/)?${log}\\.log\\s+2>&1)?\\s+# keryx-${tag}$`).test(body);
}

export function inspectCron(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  return cronJobs.map(([tag, schedule, command]) => {
    const entries = lines.filter((line) => new RegExp(`#\\s*keryx-${tag}\\b`).test(line));
    const matches = entries.length === 1 && entries[0].startsWith(`${schedule} `)
      && intendedCommand(tag, command, entries[0].slice(schedule.length).trimStart());
    return result(`cron:${tag}`, matches ? 'pass' : 'fail', matches ? 'scheduled' : entries.length === 0 ? 'missing' : 'duplicate or unexpected schedule/command');
  });
}

export function inspectAlertFile(contents) {
  const keys = ['KERYX_ALERT_WEBHOOK', 'KERYX_ALERT_TELEGRAM_BOT_TOKEN', 'KERYX_ALERT_TELEGRAM_CHAT_ID'];
  const values = [];
  for (const key of keys) {
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    const assignments = contents.split(/\r?\n/).filter((line) => pattern.test(line));
    if (assignments.length > 1) return result('alert:delivery', 'fail', 'duplicate alert assignment');
    let value = assignments.length ? assignments[0].replace(pattern, '').trim() : '';
    if (/^["']/.test(value)) {
      const quoted = value.match(/^(["'])(.*?)\1\s*(?:#.*)?$/);
      if (!quoted) return result('alert:delivery', 'fail', 'invalid quoted alert assignment');
      value = quoted[2].trim();
    } else value = value.replace(/(?:^|\s)#.*$/, '').trim();
    values.push(value);
  }
  const [webhook, token, chat] = values;
  if (Boolean(token) !== Boolean(chat)) return result('alert:delivery', 'fail', 'incomplete Telegram ops pair');
  if (token && (!/^\d+:[A-Za-z0-9_-]+$/.test(token) ||
    !(/^-?[1-9]\d*$/.test(chat) || /^@[A-Za-z][A-Za-z0-9_]{4,}$/.test(chat)))) {
    return result('alert:delivery', 'fail', 'invalid Telegram ops pair');
  }
  const channels = [webhook ? 'webhook' : '', token ? 'Telegram ops' : ''].filter(Boolean);
  return result('alert:delivery', channels.length ? 'pass' : 'fail',
    channels.length ? `${channels.join(' and ')} configured (delivery unverified)` : 'no alert channel configured');
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

function inspectPublicBoot(label, observation, requireRunning) {
  const fields = ['LoadState', 'ActiveState', 'MainPID', 'UnitFileState'];
  const values = new Map();
  // Read only the requested properties. Ambiguous/truncated output cannot prove
  // persistent startup, and raw host output must never enter a diagnostic.
  for (const line of observation.ok ? observation.output.split(/\r?\n/).filter(Boolean) : []) {
    const at = line.indexOf('=');
    const key = line.slice(0, at);
    if (at < 1 || !fields.includes(key) || values.has(key)) {
      return result(label, 'fail', 'boot properties unavailable or malformed');
    }
    values.set(key, line.slice(at + 1));
  }
  if (values.size !== fields.length || values.get('LoadState') !== 'loaded')
    return result(label, 'fail', 'boot properties unavailable or unit not loaded');
  // is-enabled also succeeds for states such as enabled-runtime and static.
  // Require the persistent enabled state used by the approved public services.
  if (values.get('UnitFileState') !== 'enabled')
    return result(label, 'fail', 'unit not persistently enabled; review boot configuration');
  const active = values.get('ActiveState'), pid = values.get('MainPID');
  const running = active === 'active' && /^[1-9]\d*$/.test(pid);
  if (!running && (requireRunning || active !== 'inactive' || pid !== '0'))
    return result(label, 'fail', 'unit not in the expected running state');
  return result(label, 'pass', requireRunning
    ? 'active with PID; persistently enabled'
    : 'persistently enabled; verify named PM2 role PIDs separately');
}

export function runPublicBootPreflight({ command, requireFrontDoor = false }) {
  const show = (unit) => command('systemctl', ['show', unit,
    '--property=LoadState,ActiveState,MainPID,UnitFileState', '--no-pager']);
  const checks = [
    inspectPublicBoot('boot:pm2', show('pm2-root.service'), false),
    inspectPublicBoot('boot:tunnel', show('cloudflared.service'), true),
  ];
  checks.push(requireFrontDoor
    ? inspectPublicBoot('boot:front-door', show('keryx-maintenance-front-door.service'), true)
    : result('boot:front-door', 'info', 'not required by this invocation; ingress route unverified'));
  return checks;
}

export function runPreflight({ command, readEnv, requireTimer = false, requireFrontDoor = false }) {
  const cron = command('crontab', ['-l']);
  const checks = cron.ok ? inspectCron(cron.output) : cronJobs.map(([tag]) => result(`cron:${tag}`, 'fail', 'crontab unavailable'));
  for (const name of ['keryx', 'keryx-a2a-worker']) checks.push(inspectPid(name, command('pm2', ['pid', name])));
  const show = (unit) => command('systemctl', ['show', unit, '--property=LoadState,ActiveState,MainPID', '--no-pager']);
  checks.push(...inspectUnits(show('keryx-private-worker.service'), show('keryx-withdrawal-cycle.timer'), show('keryx-withdrawal-cycle.service'), requireTimer));
  checks.push(...runPublicBootPreflight({ command, requireFrontDoor }));
  try { checks.push(inspectAlertFile(readEnv())); }
  catch { checks.push(result('alert:delivery', 'fail', 'environment file unreadable')); }
  return checks;
}

const usage = 'Usage: node scripts/release-ops-preflight.mjs [--require-withdrawal-timer] [--require-front-door] [--public-boot-only]';
class PreflightUsageError extends Error {}

export function runPreflightCommand(args, options) {
  const allowed = ['--require-withdrawal-timer', '--require-front-door', '--public-boot-only'];
  const bootOnly = args.includes('--public-boot-only');
  if (args.some((arg) => !allowed.includes(arg)) || bootOnly && args.includes('--require-withdrawal-timer'))
    throw new PreflightUsageError(usage);
  const selected = { ...options, requireFrontDoor: args.includes('--require-front-door') };
  return bootOnly ? runPublicBootPreflight(selected)
    : runPreflight({ ...selected, requireTimer: args.includes('--require-withdrawal-timer') });
}

function command(name, args) {
  const child = spawnSync(name, args, { encoding: 'utf8', timeout: 10_000 });
  return { ok: child.status === 0 && !child.error, output: child.stdout ?? '' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const checks = runPreflightCommand(process.argv.slice(2), { command, readEnv: () => readFileSync('.env.local', 'utf8') });
    for (const check of checks) console.log(`${check.status.toUpperCase()} ${check.label}: ${check.detail}`);
    if (checks.some((check) => check.status === 'fail')) process.exitCode = 1;
  } catch (error) {
    const invalidArgs = error instanceof PreflightUsageError;
    console.error(invalidArgs ? usage : 'Preflight inspection unavailable');
    process.exitCode = invalidArgs ? 2 : 1;
  }
}

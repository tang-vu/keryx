import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const names = ['keryx', 'keryx-a2a-worker'];
const prefix = ['-i', 'PATH=/usr/bin:/bin', 'NODE_ENV=production', '/usr/bin/node', '--env-file=/root/keryx/.env.local'];
const tails = {
  keryx: ['/root/keryx/node_modules/next/dist/bin/next', 'start', '-p', '3939'],
  'keryx-a2a-worker': ['--import', '/root/keryx/node_modules/tsx/dist/loader.mjs', '/root/keryx/scripts/a2a-research-worker.mts'],
};
const refuse = () => { throw Error('Reviewed role deployment refused; preserve processes and retained builds.'); };
const digest = b => createHash('sha256').update(b).digest('hex');

function stoppedDefinition(rows, name) {
  if (!Array.isArray(rows)) refuse();
  const found = rows.filter(r => r.name === name);
  if (found.length > 1) refuse();
  if (!found.length) return null;
  const r = found[0], e = r.pm2_env;
  if (r.pid !== 0 || !e || !['stopped', 'errored'].includes(e.status)) refuse();
  // Retain only recognized executable arguments. PM2's environment may contain
  // secrets; it is never copied, serialized, or printed by this helper.
  const clean = e.pm_exec_path === '/usr/bin/env' && e.exec_interpreter === 'none' &&
    JSON.stringify(e.args) === JSON.stringify([...prefix, ...tails[name]]);
  const legacy = /(?:^|\/)npm(?:-cli\.js)?$/.test(e.pm_exec_path ?? '') &&
    JSON.stringify(e.args) === JSON.stringify(['run', name === 'keryx' ? 'start' : 'a2a-worker']);
  if (e.pm_cwd !== '/root/keryx' || (!clean && !legacy) ||
      !['none', 'node', '/usr/bin/node'].includes(e.exec_interpreter) ||
      !Number.isSafeInteger(e.kill_timeout) || typeof e.autorestart !== 'boolean') refuse();
  return { name, pid: 0, status: e.status, script: e.pm_exec_path, cwd: e.pm_cwd,
    interpreter: e.exec_interpreter, args: e.args, autorestart: e.autorestart,
    kill_timeout: e.kill_timeout, environmentFile: '/root/keryx/.env.local' };
}

function retainDefinition(configFile, name, previous, expected) {
  const file = `${configFile}.${name}.${Date.now()}.previous.json`;
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ format: 'keryx-stopped-role-reference-v1',
      reviewedConfigSha256: expected, previous, environmentNotExported: true }) + '\n');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  const directory = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

export function validateReviewedRoles(value) {
  if (!value || Object.keys(value).join('|') !== 'apps' || !Array.isArray(value.apps) || value.apps.length !== 2) refuse();
  const allowed = new Set(['name', 'script', 'interpreter', 'cwd', 'args', 'autorestart', 'kill_timeout', 'out_file', 'error_file', 'exec_mode', 'instances', 'merge_logs', 'time']);
  for (const name of names) {
    const matches = value.apps.filter(a => a?.name === name);
    if (matches.length !== 1) refuse();
    const a = matches[0];
    if (Object.keys(a).some(k => !allowed.has(k)) || a.script !== '/usr/bin/env' || a.interpreter !== 'none' ||
        a.cwd !== '/root/keryx' || typeof a.autorestart !== 'boolean' ||
        !Number.isSafeInteger(a.kill_timeout) || a.kill_timeout < 330000 || a.kill_timeout > 900000 ||
        JSON.stringify(a.args) !== JSON.stringify([...prefix, ...tails[name]]) ||
        a.exec_mode !== undefined && a.exec_mode !== 'fork' || a.instances !== undefined && a.instances !== 1) refuse();
    for (const k of ['out_file', 'error_file']) if (a[k] !== undefined &&
      (typeof a[k] !== 'string' || !/^\/root\/\.pm2\/logs\/[a-zA-Z0-9_-]+\.log$/.test(a[k]))) refuse();
    for (const k of ['merge_logs', 'time']) if (a[k] !== undefined && typeof a[k] !== 'boolean') refuse();
  }
  return value;
}

export function readReviewedRoles(file, expectedSha256) {
  if (process.platform !== 'linux' || process.getuid() !== 0 || !/^[a-f0-9]{64}$/.test(expectedSha256) ||
      !/^\/root\/\.local\/share\/[a-zA-Z0-9_./-]+\.json$/.test(file) || path.resolve(file) !== file) refuse();
  for (let p = path.dirname(file); ; p = path.dirname(p)) {
    const s = fs.lstatSync(p);
    if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== 0 || s.gid !== 0 || s.mode & 0o022) refuse();
    if (p === '/') break;
  }
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== 0n || before.gid !== 0n || before.nlink !== 1n ||
      (before.mode & 0o777n) !== 0o600n || before.size < 1n || before.size > 65536n) refuse();
  const signature = s => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join('|');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (signature(fs.fstatSync(fd, { bigint: true })) !== signature(before)) refuse();
    const bytes = fs.readFileSync(fd);
    if (BigInt(bytes.length) !== before.size || digest(bytes) !== expectedSha256 ||
        signature(fs.fstatSync(fd, { bigint: true })) !== signature(before) ||
        signature(fs.lstatSync(file, { bigint: true })) !== signature(before)) refuse();
    return validateReviewedRoles(JSON.parse(bytes));
  } finally { fs.closeSync(fd); }
}

/** Only already exited managed roles may have their definitions replaced. */
export function deployReviewedRole(mode, configFile, config, manager, recheck, retain) {
  validateReviewedRoles(config);
  if (!['validate', 'a2a', 'web'].includes(mode)) refuse();
  const selected = mode === 'validate' ? names : [mode === 'web' ? 'keryx' : 'keryx-a2a-worker'];
  const rows = manager.list();
  const previous = selected.map(name => stoppedDefinition(rows, name));
  recheck();
  if (mode === 'validate') return;
  const name = selected[0];
  if (typeof retain !== 'function') refuse();
  retain(name, previous[0]);
  recheck();
  if (JSON.stringify(stoppedDefinition(manager.list(), name)) !== JSON.stringify(previous[0])) refuse();
  if (previous[0]) manager.run(['delete', name]);
  recheck();
  if (stoppedDefinition(manager.list(), name) !== null) refuse();
  manager.run(['start', configFile, '--only', name]);
  recheck();
  const started = manager.list().filter(r => r.name === name);
  const wanted = config.apps.find(a => a.name === name);
  if (started.length !== 1 || !Number.isSafeInteger(started[0].pid) || started[0].pid < 1 ||
      started[0].pm2_env?.status !== 'online' ||
      started[0].pm2_env?.pm_exec_path !== wanted.script || started[0].pm2_env?.pm_cwd !== wanted.cwd ||
      started[0].pm2_env?.exec_interpreter !== wanted.interpreter ||
      JSON.stringify(started[0].pm2_env?.args) !== JSON.stringify(wanted.args) ||
      started[0].pm2_env?.autorestart !== wanted.autorestart ||
      started[0].pm2_env?.kill_timeout !== wanted.kill_timeout) refuse();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) || process.argv[1] === '-') {
  try {
    if (process.argv.length !== 5) refuse();
    const [file, expected, mode] = process.argv.slice(2);
    const config = readReviewedRoles(file, expected);
    const call = args => execFileSync('/usr/bin/pm2', args, { encoding: 'utf8', maxBuffer: 4194304,
      env: { PATH: '/usr/bin:/bin', HOME: '/root', PM2_HOME: '/root/.pm2' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const manager = { list: () => JSON.parse(call(['jlist'])), run: args => { call(args); } };
    deployReviewedRole(mode, file, config, manager, () => readReviewedRoles(file, expected),
      (name, previous) => retainDefinition(file, name, previous, expected));
    console.log('Reviewed PM2 role boundary passed.');
  } catch { console.error('Reviewed role deployment refused; preserve processes and retained builds.'); process.exitCode = 1; }
}

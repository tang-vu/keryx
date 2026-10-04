import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const refuse = () => { throw Error('Economic deploy migration refused; keep writers stopped and retain all builds and evidence.'); };
const digestPattern = /^[a-f0-9]{64}$/;
const protectedPath = (value, suffix) => typeof value === 'string' &&
  /^\/root\/\.local\/share\/[a-zA-Z0-9_./-]+$/.test(value) &&
  !value.includes('..') && path.posix.normalize(value) === value && value.endsWith(suffix);
const signature = s => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join('|');

export function validateEconomicMigrationConfig(value) {
  const fields = ['format', 'manifest', 'expectedManifestDigest', 'expectedIdentityDigest', 'backup', 'receipt'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key)) ||
      value.format !== 'keryx-redeploy-economic-migration-v1' ||
      !protectedPath(value.manifest, '.json') || !protectedPath(value.backup, '.sqlite') ||
      !protectedPath(value.receipt, '.jsonl') ||
      typeof value.expectedManifestDigest !== 'string' || typeof value.expectedIdentityDigest !== 'string' ||
      !digestPattern.test(value.expectedManifestDigest) || !digestPattern.test(value.expectedIdentityDigest) ||
      new Set([value.manifest, value.backup, value.receipt]).size !== 3) refuse();
  return value;
}

// The injectable host is a test seam only. The command entry point always uses
// the real OS and filesystem; no command-line option can relax protection.
export function readEconomicMigrationConfig(file, expected, host = { fs, platform: process.platform, uid: process.getuid?.() }) {
  if (host.platform !== 'linux' || host.uid !== 0 || !protectedPath(file, '.json') || !digestPattern.test(expected)) refuse();
  const io = host.fs;
  for (let directory = path.posix.dirname(file); ; directory = path.posix.dirname(directory)) {
    const stat = io.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || stat.mode & 0o022) refuse();
    if (directory === '/') break;
  }
  const before = io.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== 0n || before.gid !== 0n || before.nlink !== 1n ||
      (before.mode & 0o777n) !== 0o600n || before.size < 1n || before.size > 16384n) refuse();
  const fd = io.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | fs.constants.O_NONBLOCK);
  try {
    if (signature(io.fstatSync(fd, { bigint: true })) !== signature(before)) refuse();
    const bytes = io.readFileSync(fd);
    if (BigInt(bytes.length) !== before.size || createHash('sha256').update(bytes).digest('hex') !== expected ||
        signature(io.fstatSync(fd, { bigint: true })) !== signature(before) ||
        signature(io.lstatSync(file, { bigint: true })) !== signature(before)) refuse();
    const value = validateEconomicMigrationConfig(JSON.parse(bytes));
    if ([value.manifest, value.backup, value.receipt].includes(file)) refuse();
    return value;
  } finally { io.closeSync(fd); }
}

function reviewedInputs(file, sha) {
  if (!protectedPath(file, '.json') || !digestPattern.test(sha)) refuse();
}
const cleanNode = ['-i', 'PATH=/usr/bin:/bin', 'NODE_ENV=production', '/usr/bin/node'];

/** Requires positively exited reviewed web/A2A definitions immediately before DDL.
 * The operator separately drains private workers and all other scheduled writers. */
export function runEconomicDeployMigration(mode, config, reviewedFile, reviewedSha, run, recheck) {
  validateEconomicMigrationConfig(config); reviewedInputs(reviewedFile, reviewedSha);
  if (!['validate', 'migrate'].includes(mode)) refuse();
  run('/usr/bin/env', [...cleanNode, '/root/keryx/scripts/redeploy-reviewed-roles.mjs', reviewedFile, reviewedSha, 'validate']);
  recheck();
  if (mode === 'validate') return;
  return run('/usr/bin/env', [...cleanNode, '--import', '/root/keryx/node_modules/tsx/dist/loader.mjs',
    '/root/keryx/scripts/mainnet-economic-storage-migrate.mts', 'migrate',
    '--manifest', config.manifest, '--expected-manifest', config.expectedManifestDigest,
    '--expected-identity', config.expectedIdentityDigest, '--backup', config.backup,
    '--receipt', config.receipt, '--writers-stopped']);
}

/** Failure containment must work even when a config/hash became unreadable after
 * DDL. This fixed operation can only stop the two public roles and save that hold. */
export function holdEconomicDeployRoles(manager) {
  let failed = false;
  for (const name of ['keryx', 'keryx-a2a-worker']) {
    try {
      const rows = manager.list();
      if (!Array.isArray(rows)) refuse();
      if (rows.some(row => row.name === name)) manager.run(['stop', name]);
    } catch { failed = true; }
  }
  const rows = manager.list();
  if (!Array.isArray(rows) || rows.some(row => ['keryx', 'keryx-a2a-worker'].includes(row.name) &&
      (row.pid !== 0 || !['stopped', 'errored'].includes(row.pm2_env?.status)))) refuse();
  manager.run(['save']);
  if (failed) refuse();
}

if (process.argv[1] === '-' || process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const run = (command, argv) => execFileSync(command, argv, { cwd: '/root/keryx', env: {},
      encoding: 'utf8', maxBuffer: 4194304, stdio: ['ignore', 'pipe', 'pipe'] });
    if (args.length === 1 && args[0] === 'hold') {
      const pm2 = argv => run('/usr/bin/env', ['-i', 'PATH=/usr/bin:/bin', 'HOME=/root', 'PM2_HOME=/root/.pm2', '/usr/bin/pm2', ...argv]);
      holdEconomicDeployRoles({ list: () => JSON.parse(pm2(['jlist'])), run: pm2 });
      console.log('Economic migration failure hold verified: public web and A2A stopped; builds retained.');
    } else {
      if (args.length !== 5) refuse();
      const [mode, file, expected, reviewedFile, reviewedSha] = args;
      const config = readEconomicMigrationConfig(file, expected);
      const result = runEconomicDeployMigration(mode, config, reviewedFile, reviewedSha, run,
        () => { if (JSON.stringify(readEconomicMigrationConfig(file, expected)) !== JSON.stringify(config)) refuse(); });
      if (mode === 'migrate') process.stdout.write(result);
      else console.log('Economic migration protected configuration and stopped public roles verified.');
    }
  } catch {
    console.error('Economic deploy migration refused or hold incomplete; keep writers stopped and retain all builds and evidence.');
    process.exitCode = 1;
  }
}

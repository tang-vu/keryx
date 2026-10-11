// Keyless preparation only. Never drain, start production roles, load runtime ENV,
// migrate storage or clean retained releases. The deployed path remains authoritative.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageImmutableSource, recordImmutableArtifact, verifyImmutableArtifact } from './immutable-release-staging.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const serial = value => JSON.stringify(value) + '\n';
const refuse = () => { throw Error('Release preparation refused; retain all candidate evidence. No writer hold or deployment started.'); };
const pinnedNode = '24.21.0';
const pinnedNpm = '11.19.0';
export const preparationCommands = Object.freeze([
  ['typecheck', ['run', 'typecheck']],
  ['tests', ['test']],
  ['build', ['run', 'build']],
]);

/** Fresh environment, not a denylist over potentially funded runtime settings.
 * A testnet browser bundle is deliberately not a mainnet production artifact. */
export function preparationEnvironment({ commit, scratch, inherited = process.env }) {
  if (!/^[a-f0-9]{40}$/.test(commit) || !path.isAbsolute(scratch) || path.resolve(scratch) !== scratch) refuse();
  const env = {
    PATH: inherited.PATH ?? '',
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', CI: '1',
    KERYX_NETWORK: 'arcTestnet', NEXT_PUBLIC_KERYX_NETWORK: 'arcTestnet',
    KERYX_FORCE_OFFLINE: '1', KERYX_COMMIT: commit,
    SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '',
    NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    HOME: scratch, USERPROFILE: scratch, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
    npm_config_cache: path.join(scratch, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false',
  };
  // Required Windows process/DLL lookup inputs, never credentials or NODE_OPTIONS.
  for (const name of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'PATHEXT'])
    if (inherited[name] !== undefined) env[name] = inherited[name];
  return env;
}

function exclusiveReceipt(file, value) {
  const bytes = serial(value), fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return hash(bytes);
}

/** Reuse only a *copy* of independently installed dependencies. Source is read-only;
 * fs.cp never hardlinks or leaves a serving-directory junction in the candidate.
 * Byte inspection subsequently rejects external links and missing trace files. */
export function copyPreparationDependencies({ source, dependencies }) {
  dependencies = fs.realpathSync.native(dependencies);
  if (!fs.lstatSync(dependencies).isDirectory() || fs.existsSync(path.join(source, 'node_modules'))) refuse();
  const lock = fs.readFileSync(path.join(source, 'package-lock.json'));
  const installed = fs.readFileSync(path.join(dependencies, '.package-lock.json'));
  const wanted = JSON.parse(lock), actual = JSON.parse(installed);
  if (wanted.lockfileVersion !== 3 || actual.lockfileVersion !== 3 ||
      !wanted.packages || !actual.packages) refuse();
  for (const [name, entry] of Object.entries(actual.packages)) {
    const expected = wanted.packages[name];
    if (!name.startsWith('node_modules/') || !expected ||
        entry.version !== expected.version || entry.integrity !== expected.integrity ||
        entry.resolved !== expected.resolved || entry.link || expected.link) refuse();
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }))
    if (!actual.packages[`node_modules/${name}`]) refuse();
  // Refuse external dependency links before dereferencing; a serving/root ENV or
  // data directory must never be imported as a candidate dependency.
  let files = 0, bytes = 0;
  const check = directory => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (++files > 250000) refuse();
      if (stat.isSymbolicLink()) {
        const target = fs.realpathSync.native(file), relative = path.relative(dependencies, target);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
            !fs.statSync(target).isFile()) refuse();
      } else if (stat.isDirectory()) check(file);
      else if (!stat.isFile()) refuse();
      else { bytes += stat.size; if (bytes > 8 * 1024 ** 3) refuse(); }
    }
  };
  check(dependencies);
  const available = fs.statfsSync(source, { bigint: true });
  if (available.bavail * available.bsize < BigInt(bytes + 4 * 1024 ** 3)) refuse();
  fs.cpSync(dependencies, path.join(source, 'node_modules'), {
    recursive: true, dereference: true, errorOnExist: true, force: false,
  });
  if (hash(fs.readFileSync(path.join(source, 'node_modules', '.package-lock.json'))) !== hash(installed) ||
      hash(fs.readFileSync(path.join(dependencies, '.package-lock.json'))) !== hash(installed)) refuse();
  return { lockSha256: hash(lock), installedLockSha256: hash(installed),
    copiedFiles: files, copiedBytes: bytes, method: 'independent-file-copy' };
}

/** Commands are fixed and run sequentially, before artifact recording and any hold.
 * The process seam lets tests prove failure ordering without pretending a build passed. */
export function runPreparationChecks({ staged, scratch, npmCli, run = spawnSync }) {
  if (process.versions.node !== pinnedNode || !path.isAbsolute(npmCli) ||
      !fs.lstatSync(npmCli).isFile()) refuse();
  const env = preparationEnvironment({ commit: staged.commit, scratch });
  const toolchain = { nodeSha256: hash(fs.readFileSync(process.execPath)), npmCliSha256: hash(fs.readFileSync(npmCli)) };
  const call = (args, heap, outputFd) => run(process.execPath, [npmCli, ...args], {
    cwd: staged.source, env: { ...env, NODE_OPTIONS: `--max-old-space-size=${heap}` },
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30 * 60 * 1000, windowsHide: true,
    ...(outputFd !== undefined ? { stdio: ['ignore', outputFd, outputFd] } : {}),
  });
  const version = call(['--version'], 1536);
  const versionOutput = (version.stdout ?? '') + (version.stderr ?? '');
  fs.writeFileSync(path.join(staged.candidate, 'npm-version.log'), versionOutput, { flag: 'wx', mode: 0o600 });
  exclusiveReceipt(path.join(staged.candidate, 'npm-version.json'), {
    expectedNpm: pinnedNpm, exitCode: version.status, signal: version.signal ?? null,
    processError: version.error?.code ?? null, outputSha256: hash(versionOutput), ...toolchain,
  });
  if (version.error || version.signal || version.status !== 0 || version.stdout.trim() !== pinnedNpm) refuse();
  const results = [];
  for (const [name, args] of preparationCommands) {
    const startedAt = new Date().toISOString(), started = performance.now();
    const logFile = path.join(staged.candidate, `${name}.log`), fd = fs.openSync(logFile, 'wx', 0o600);
    let result;
    try {
      result = call(args, name === 'typecheck' ? 2560 : 1536, fd);
      // Injectable processes may return captured output; native processes write
      // directly to the retained log even if the controller exits mid-check.
      fs.writeSync(fd, (result.stdout ?? '') + (result.stderr ?? ''));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    if (fs.statSync(logFile).size > 32 * 1024 * 1024) refuse();
    const output = fs.readFileSync(logFile);
    const receipt = { name, command: [process.execPath, npmCli, ...args], startedAt,
      elapsedMs: Math.round(performance.now() - started), exitCode: result.status,
      signal: result.signal ?? null, outputSha256: hash(output), processError: result.error?.code ?? null };
    exclusiveReceipt(path.join(staged.candidate, `${name}.json`), receipt);
    results.push(receipt);
    if (result.error || result.signal || result.status !== 0) refuse();
  }
  if (hash(fs.readFileSync(process.execPath)) !== toolchain.nodeSha256 || hash(fs.readFileSync(npmCli)) !== toolchain.npmCliSha256) refuse();
  return { node: process.versions.node, npm: pinnedNpm, platform: process.platform, ...toolchain,
    arch: process.arch, publicBuildSettings: { network: 'arcTestnet', forceOffline: true }, results };
}

export function prepareImmutableRelease({ repo, releasesDir, commit, dependencies, npmCli }) {
  if (process.versions.node !== pinnedNode) refuse();
  const startedAt = new Date().toISOString(), started = performance.now();
  const staged = stageImmutableSource({ repo, releasesDir, commit });
  // Scratch is deliberately outside source. Keep it on failure; never erase storage evidence.
  const scratch = path.join(staged.candidate, 'preparation-scratch');
  fs.mkdirSync(scratch, { mode: 0o700 });
  const inputs = copyPreparationDependencies({ source: staged.source, dependencies });
  const checks = runPreparationChecks({ staged, scratch, npmCli });
  const artifact = recordImmutableArtifact(staged);
  verifyImmutableArtifact({ ...staged, artifactInspectionSha256: artifact.artifactInspectionSha256 });
  const receipt = { format: 'keryx-immutable-preparation-v1', productionAdmitted: false,
    startedAt, elapsedMs: Math.round(performance.now() - started), commit: staged.commit,
    tree: artifact.tree, sourceManifestSha256: staged.sourceManifestSha256,
    artifactInspectionSha256: artifact.artifactInspectionSha256,
    artifactDigest: artifact.artifactDigest, buildId: artifact.buildId, inputs, checks,
    scratch, writerHoldStarted: false, runtimeEnvironmentLoaded: false };
  const preparationSha256 = exclusiveReceipt(path.join(staged.candidate, 'preparation.json'), receipt);
  return { ...staged, ...receipt, preparationSha256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [repo, releasesDir, commit, dependencies, npmCli] = process.argv.slice(2);
    if (process.argv.length !== 7) refuse();
    console.log(JSON.stringify(prepareImmutableRelease({ repo, releasesDir, commit, dependencies, npmCli })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

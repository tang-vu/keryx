// Manually invoked, keyless preparation only. Never deploy or alter writer holds.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { preparationEnvironment } from './prepare-immutable-release.mjs';

const here = fileURLToPath(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const regularDirectory = file => {
  assert(path.isAbsolute(file) && path.resolve(file) === file);
  assert(fs.lstatSync(file).isDirectory() && !fs.lstatSync(file).isSymbolicLink());
  assert.equal(fs.realpathSync(file), file);
};

export function assertMainSource(commit, head, main) {
  assert(typeof commit === 'string' && commit.length === 40 && /^[a-f0-9]{40}$/.test(commit), 'FULL_SOURCE_COMMIT_REQUIRED');
  assert.equal(head, commit, 'CHECKOUT_MUST_MATCH_SOURCE');
  assert.equal(main, commit, 'SOURCE_MUST_BE_CURRENT_MAIN');
}

export function assertNetworkIsolation() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  const interfaces = fs.readFileSync('/proc/self/net/dev', 'utf8').split('\n').slice(2)
    .filter(line => line.includes(':')).map(line => line.split(':')[0].trim()).sort();
  assert.deepEqual(interfaces, ['lo'], 'LOOPBACK_ONLY_NAMESPACE_REQUIRED');
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  assert(/^NoNewPrivs:\s+1$/m.test(status) && /^CapBnd:\s+0+$/m.test(status), 'DROPPED_CAPABILITIES_REQUIRED');
}

/** Whitelist public constants only. The official helper creates its own fresh
 * per-check environment and deliberately omits this control HOME and all tokens. */
export function hostedChildEnvironment({ commit, home, inherited }) {
  const checked = preparationEnvironment({ commit, scratch: home, inherited, publicNetwork: 'arc' });
  return Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'CI', 'NEXT_TELEMETRY_DISABLED',
    'NEXT_PUBLIC_CIRCLE_APP_ID', 'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
    'KERYX_REGISTRY_ADDRESS', 'NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS',
    'KERYX_REGISTRY_READ_ADDRESS', 'NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS'].map(key => [key, checked[key]]));
}

export function copyBrowserCache(input, candidate) {
  regularDirectory(input); regularDirectory(candidate);
  const scratch = path.join(candidate, 'preparation-scratch'); regularDirectory(scratch);
  const tests = path.join(candidate, 'tests.log');
  assert(!fs.existsSync(tests), 'TESTS_ALREADY_STARTED');
  const output = path.join(scratch, '.cache', 'ms-playwright');
  let entries = 0, measured = 0;
  const within = file => file === input || file.startsWith(input + path.sep);
  const inspect = file => {
    assert(++entries <= 30000, 'BROWSER_CACHE_ENTRY_BOUND');
    const actual = fs.realpathSync(file); assert(within(actual), 'BROWSER_CACHE_LINK_ESCAPE');
    const stat = fs.statSync(file);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) inspect(path.join(file, name));
    else { assert(stat.isFile()); measured += stat.size; assert(measured <= 2 * 1024 ** 3, 'BROWSER_CACHE_BYTE_BOUND'); }
  };
  inspect(input);
  fs.mkdirSync(path.dirname(output), { mode: 0o700 });
  fs.cpSync(input, output, { recursive: true, dereference: true, force: false, errorOnExist: true, mode: fs.constants.COPYFILE_EXCL });
  let files = 0, bytes = 0;
  const verify = directory => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      assert(!stat.isSymbolicLink());
      if (stat.isDirectory()) verify(file);
      else {
        const original = fs.statSync(path.join(input, path.relative(output, file)));
        assert(stat.isFile() && stat.nlink === 1 && original.isFile() && stat.size === original.size);
        assert(stat.dev !== original.dev || stat.ino !== original.ino);
        files++; bytes += stat.size;
      }
    }
  };
  verify(output); assert(files > 0 && bytes === measured);
  assert(!fs.existsSync(tests), 'CACHE_COPY_DID_NOT_FINISH_BEFORE_TESTS');
  return { beforeTests: true, independentFileCopy: true, files, bytes };
}

async function watchBrowserCache(input, candidate) {
  assert(!fs.existsSync(candidate), 'RETAIN_EXISTING_CANDIDATE'); regularDirectory(input);
  let officialClosed = false;
  const closed = new Promise(resolve => process.stdin.once('end', () => { officialClosed = true; resolve(); }));
  process.stdin.resume();
  console.log(JSON.stringify({ event: 'watching' }));
  while (!fs.existsSync(path.join(candidate, 'preparation-scratch')) && !officialClosed)
    await new Promise(resolve => setTimeout(resolve, 100));
  assert(!officialClosed, 'OFFICIAL_CLOSED_BEFORE_CACHE_COPY');
  const result = copyBrowserCache(input, candidate);
  console.log(JSON.stringify({ event: 'cache-copied', ...result }));
  await closed; // Only original official close ends this watcher. No synthetic EOF.
}

/** Drain both streams even after the retention bound. Never signal/retry a child. */
export function captureProcess(command, args, { cwd, env, directory, name, input = false, onLine = () => {}, limit = 32 * 1024 ** 2 }) {
  const state = { exitCode: null, signal: null, exitObserved: false, closeObserved: false, stdoutEOF: false, stderrEOF: false, errors: [], overflow: false };
  let retained = 0, partial = '';
  const logs = Object.fromEntries(['stdout', 'stderr'].map(channel => [channel, {
    fd: fs.openSync(path.join(directory, `${name}.${channel}.log`), 'wx', 0o600),
    observedBytes: 0, retainedBytes: 0, observed: createHash('sha256'), retained: createHash('sha256'),
  }]));
  const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  for (const channel of ['stdout', 'stderr']) {
    child[channel].on('data', chunk => {
      const bytes = Buffer.from(chunk), log = logs[channel]; log.observedBytes += bytes.length; log.observed.update(bytes);
      const keep = Math.min(bytes.length, limit - retained);
      if (keep && !log.failed) {
        let offset = 0;
        try { while (offset < keep) { const count = fs.writeSync(log.fd, bytes, offset, keep - offset); assert(count > 0); offset += count; } }
        catch { log.failed = true; state.errors.push('LOG_WRITE'); }
        log.retained.update(bytes.subarray(0, offset)); log.retainedBytes += offset; retained += offset;
      }
      if (keep < bytes.length) state.overflow = true;
      if (input && channel === 'stdout') {
        partial += bytes.toString('utf8');
        let at;
        while ((at = partial.indexOf('\n')) !== -1) {
          const line = partial.slice(0, at); partial = partial.slice(at + 1);
          try { onLine(JSON.parse(line)); } catch { state.errors.push('WATCHER_PROTOCOL'); }
        }
        if (partial.length > 8192) { partial = ''; state.errors.push('WATCHER_LINE_BOUND'); }
      }
    });
    child[channel].once('end', () => { state[`${channel}EOF`] = true; });
    child[channel].on('error', () => state.errors.push(`${channel.toUpperCase()}_STREAM`));
  }
  child.on('error', () => state.errors.push('SPAWN'));
  child.stdin?.on('error', () => state.errors.push('STDIN'));
  child.once('exit', (code, signal) => { state.exitCode = code; state.signal = signal; state.exitObserved = true; });
  const done = new Promise(resolve => child.once('close', () => {
    state.closeObserved = true; state.fullEOF = state.stdoutEOF && state.stderrEOF;
    state.logs = Object.fromEntries(Object.entries(logs).map(([channel, log]) => {
      try { fs.fsyncSync(log.fd); } catch { state.errors.push('LOG_SYNC'); }
      fs.closeSync(log.fd);
      return [channel, { observedBytes: log.observedBytes, retainedBytes: log.retainedBytes,
        observedSha256: log.observed.digest('hex'), retainedSha256: log.retained.digest('hex') }];
    }));
    save(path.join(directory, `${name}.capture.json`), state); resolve(state);
  }));
  return { child, done };
}
export const completeCapture = r => Boolean(r && r.exitObserved && r.closeObserved && r.exitCode === 0 && r.signal === null && r.fullEOF && !r.overflow && r.errors.length === 0);

export function archiveEntries(commit) {
  assertMainSource(commit, commit, commit);
  return ['source', 'source-manifest.json', 'artifact-inspection.json', 'preparation.json'].map(name => `${commit}/${name}`);
}

export function packageCohort({ releases, commit, archive, env }) {
  const fd = fs.openSync(archive, 'wx', 0o600);
  let result;
  try {
    result = spawnSync('tar', ['-czf', '-', '-C', releases, '--', ...archiveEntries(commit)], {
      env, stdio: ['ignore', fd, 'pipe'], timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024,
    });
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  assert(!result.error && result.status === 0 && !result.signal, 'ARCHIVE_FAILED_RETAIN_PARTIAL');
  const digest = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024), read = fs.openSync(archive, 'r');
  try { let n; while ((n = fs.readSync(read, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(read); }
  return { sha256: digest.digest('hex'), bytes: fs.statSync(archive).size, entries: archiveEntries(commit) };
}

async function main() {
  assertNetworkIsolation(); assert.equal(process.versions.node, '24.21.0');
  const { SOURCE_COMMIT: commit, HOSTED_REPO: repo, HOSTED_ROOT: root, HOSTED_BROWSER_CACHE: cache, HOSTED_NPM_CLI: npmCli } = process.env;
  regularDirectory(repo); regularDirectory(cache);
  assert(path.isAbsolute(root) && path.resolve(root) === root && !fs.existsSync(root));
  assert(path.isAbsolute(npmCli) && fs.statSync(npmCli).isFile());
  const gitEnv = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' };
  const git = ref => execFileSync('git', ['-C', repo, 'rev-parse', '--verify', ref], { env: gitEnv, encoding: 'utf8', timeout: 60000 }).trim();
  assertMainSource(commit, git('HEAD'), git('refs/remotes/origin/main'));
  fs.mkdirSync(root, { mode: 0o700 });
  const output = path.join(root, 'artifacts'), releases = path.join(root, 'releases'), home = path.join(root, 'control-home');
  for (const dir of [output, releases, home]) fs.mkdirSync(dir, { mode: 0o700 });
  const env = hostedChildEnvironment({ commit, home, inherited: process.env });
  const args = [npmCli, 'run', 'redeploy', '--', '--prepare-release', repo, releases, commit, path.join(repo, 'node_modules'), npmCli, '--mainnet-public-build'];
  save(path.join(output, 'intent.json'), { commit, command: [process.execPath, ...args],
    maximumOfficialPrepareInvocations: 1, automaticRetry: false, loopbackOnly: true, productionAdmitted: false });
  let ready, copied = null;
  const announced = new Promise(resolve => { ready = resolve; });
  const watcher = captureProcess(process.execPath, [here, '--watch', cache, path.join(releases, commit)], {
    cwd: repo, env, directory: output, name: 'browser-cache', input: true,
    onLine(event) { if (event.event === 'watching') ready(true); if (event.event === 'cache-copied') copied = event; },
  });
  watcher.done.then(() => ready(false));
  let official = null;
  if (await announced) official = await captureProcess(process.execPath, args, { cwd: repo, env, directory: output, name: 'official-prepare' }).done;
  if (watcher.child.stdin && !watcher.child.stdin.destroyed) watcher.child.stdin.end();
  const browser = await watcher.done;
  const accepted = completeCapture(official) && completeCapture(browser) && copied?.beforeTests === true && copied?.independentFileCopy === true;
  save(path.join(output, 'capture-result.json'), { commit, actualOfficialPrepareInvocations: official ? 1 : 0,
    officialPrepareCaptureAccepted: accepted, officialExitCode: official?.exitCode ?? null, officialSignal: official?.signal ?? null,
    officialFullEOF: official?.fullEOF ?? false, browserCache: copied, automaticRetry: false, cleanupPerformed: false, productionAdmitted: false });
  const candidate = path.join(releases, commit);
  for (const name of ['npm-version', 'typecheck', 'tests', 'build']) for (const suffix of ['json', 'log']) {
    const file = path.join(candidate, `${name}.${suffix}`);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(output, `${name}.${suffix}`), fs.constants.COPYFILE_EXCL);
  }
  assert(accepted, 'ORIGINAL_PREPARATION_NOT_ACCEPTED');
  const receiptNames = ['source-manifest', 'artifact-inspection', 'preparation'];
  const receipts = Object.fromEntries(receiptNames.map(name => {
    const bytes = fs.readFileSync(path.join(candidate, `${name}.json`));
    return [name, { sha256: sha(bytes), value: JSON.parse(bytes) }];
  }));
  const prep = receipts.preparation.value, artifact = receipts['artifact-inspection'].value;
  for (const receipt of Object.values(receipts)) assert(receipt.value.commit === commit && receipt.value.productionAdmitted === false);
  assert.equal(prep.sourceManifestSha256, receipts['source-manifest'].sha256);
  assert.equal(prep.artifactInspectionSha256, receipts['artifact-inspection'].sha256);
  assert.equal(prep.artifactDigest, artifact.artifactDigest); assert.equal(prep.buildId, artifact.buildId);
  const archive = packageCohort({ releases, commit, archive: path.join(output, `cohort-${commit}.tar.gz`), env });
  save(path.join(output, 'cohort.json'), { commit, ...archive,
    sourceManifestSha256: receipts['source-manifest'].sha256, artifactInspectionSha256: receipts['artifact-inspection'].sha256,
    preparationSha256: receipts.preparation.sha256, artifactDigest: prep.artifactDigest, buildId: prep.buildId,
    originalReceiptBytes: true, publicBuildSettings: prep.checks.publicBuildSettings,
    buildRegistrySettings: prep.checks.buildRegistrySettings, productionAdmitted: false });
  console.log(JSON.stringify({ sourceCommit: commit, archiveSha256: archive.sha256, archiveBytes: archive.bytes, productionAdmitted: false }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  const args = process.argv.slice(2);
  (args.length === 3 && args[0] === '--watch' ? watchBrowserCache(args[1], args[2]) : args.length === 0 ? main() : Promise.reject(Error('INVALID_ARGUMENTS')))
    .catch(() => { console.error('Hosted preparation refused; retain original logs and partial artifacts.'); process.exitCode = 1; });
}

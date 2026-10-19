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
export function preparationEnvironment({ commit, scratch, inherited = process.env, publicNetwork = 'arcTestnet' }) {
  if (!/^[a-f0-9]{40}$/.test(commit) || !path.isAbsolute(scratch) || path.resolve(scratch) !== scratch ||
      !['arcTestnet', 'arc'].includes(publicNetwork)) refuse();
  const env = {
    PATH: inherited.PATH ?? '',
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', CI: '1',
    KERYX_NETWORK: publicNetwork, NEXT_PUBLIC_KERYX_NETWORK: publicNetwork,
    KERYX_FORCE_OFFLINE: '1', KERYX_COMMIT: commit,
    SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '',
    NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    HOME: scratch, USERPROFILE: scratch, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
    npm_config_cache: path.join(scratch, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false',
  };
  // Next compiles these public connector identifiers into browser bundles. A
  // mainnet artifact must preserve the supported Google wallet connection.
  // Accept only this public pair; never load a runtime ENV file into the builder.
  if (publicNetwork === 'arc') {
    const appId = inherited.NEXT_PUBLIC_CIRCLE_APP_ID, clientId = inherited.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (typeof appId !== 'string' || !/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(appId) ||
        typeof clientId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.apps\.googleusercontent\.com$/.test(clientId)) refuse();
    env.NEXT_PUBLIC_CIRCLE_APP_ID = appId;
    env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = clientId;
  }
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

/** Only independently copied build/dependency trees are protected here. Never
 * chmod their installation/build inputs or relax the artifact inspector. */
export function protectPreparationCopy(directory) {
  if (!['node_modules', '.next'].includes(path.basename(directory))) refuse();
  let protectedEntries = 0;
  const visit = file => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return; // Inspector still proves link containment.
    if ((!stat.isDirectory() && !stat.isFile()) || stat.isFile() && stat.nlink !== 1 ||
        process.platform !== 'win32' && stat.uid !== process.getuid()) refuse();
    if (process.platform !== 'win32' && stat.mode & 0o022) {
      fs.chmodSync(file, stat.mode & 0o777 & ~0o022); protectedEntries++;
    }
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) visit(path.join(file, name));
  };
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) refuse();
  visit(directory);
  return protectedEntries;
}

/** Turbopack emits dependency aliases under .next/node_modules. Materialize
 * those aliases only from the candidate's independently copied dependencies,
 * never from the build checkout, runtime data or another serving cohort. */
export function materializePreparationBuildAliases({ source, dependencies }) {
  const copied = fs.realpathSync.native(path.join(source, 'node_modules'));
  const inputs = fs.realpathSync.native(dependencies);
  const aliases = [], next = path.join(source, '.next');
  const within = (root, file) => {
    const relative = path.relative(root, file);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  let bytes = 0, entries = 0;
  const measure = file => {
    const stat = fs.lstatSync(file);
    if (++entries > 250000 || stat.isSymbolicLink()) refuse();
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) measure(path.join(file, name));
    else {
      if (!stat.isFile() || stat.nlink !== 1) refuse();
      bytes += stat.size; if (bytes > 8 * 1024 ** 3) refuse();
    }
  };
  const visit = directory => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.isDirectory()) visit(file);
      else if (stat.isSymbolicLink()) {
        const relative = path.relative(next, file);
        // Other links remain subject to the unchanged artifact inspector.
        if (!relative.startsWith(`node_modules${path.sep}`)) continue;
        const target = fs.realpathSync.native(file);
        const root = within(copied, target) ? copied : within(inputs, target) ? inputs : null;
        if (!root || aliases.length >= 128) refuse();
        const dependency = path.relative(root, target);
        const independent = path.join(copied, dependency);
        if (!within(copied, fs.realpathSync.native(independent))) refuse();
        measure(independent);
        aliases.push({ file, independent, path: relative.split(path.sep).join('/'), dependency });
      }
    }
  };
  visit(next);
  const available = fs.statfsSync(source, { bigint: true });
  if (available.bavail * available.bsize < BigInt(bytes + 4 * 1024 ** 3)) refuse();
  for (const alias of aliases) {
    if (!fs.lstatSync(alias.file).isSymbolicLink()) refuse();
    fs.unlinkSync(alias.file); // Only the candidate's verified dependency alias.
    fs.cpSync(alias.independent, alias.file, { recursive: true, dereference: false, force: false, errorOnExist: true });
  }
  return { aliases: aliases.map(({ path, dependency }) => ({ path, dependency })), copiedEntries: entries, copiedBytes: bytes };
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
  // Refuse external dependency links before copying; a serving/root ENV or
  // data directory must never be imported as a candidate dependency.
  let files = 0, bytes = 0;
  const links = [];
  const checkedLink = file => {
    const target = fs.realpathSync.native(file), relative = path.relative(dependencies, target);
    const stat = fs.statSync(target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !stat.isFile()) refuse();
    return { stat, target: relative };
  };
  const check = directory => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (++files > 250000) refuse();
      if (stat.isSymbolicLink()) {
        const checked = checkedLink(file);
        bytes += checked.stat.size;
        links.push({ relative: path.relative(dependencies, file), target: checked.target });
      } else if (stat.isDirectory()) check(file);
      else if (!stat.isFile()) refuse();
      else bytes += stat.size;
      if (bytes > 8 * 1024 ** 3) refuse();
    }
  };
  check(dependencies);
  const available = fs.statfsSync(source, { bigint: true });
  if (available.bavail * available.bsize < BigInt(bytes + 4 * 1024 ** 3)) refuse();
  const copiedRoot = path.join(source, 'node_modules');
  const linkTargets = new Map(links.map(link => [link.relative, link.target]));
  fs.cpSync(dependencies, copiedRoot, {
    recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false,
    // Copy regular entries independently. Recreate only verified file links below,
    // so even an absolute installation link never points back to its input tree.
    filter: file => {
      if (!fs.lstatSync(file).isSymbolicLink()) return true;
      if (checkedLink(file).target !== linkTargets.get(path.relative(dependencies, file))) refuse();
      return false;
    },
  });
  for (const { relative, target } of links) {
    const copied = path.join(copiedRoot, relative), copiedTarget = path.join(copiedRoot, target);
    fs.symlinkSync(path.relative(path.dirname(copied), copiedTarget), copied, 'file');
    if (!fs.lstatSync(copied).isSymbolicLink() || fs.realpathSync.native(copied) !== copiedTarget ||
        !fs.lstatSync(copiedTarget).isFile() || fs.lstatSync(copiedTarget).nlink !== 1) refuse();
  }
  const protectedEntries = protectPreparationCopy(path.join(source, 'node_modules'));
  if (hash(fs.readFileSync(path.join(source, 'node_modules', '.package-lock.json'))) !== hash(installed) ||
      hash(fs.readFileSync(path.join(dependencies, '.package-lock.json'))) !== hash(installed)) refuse();
  return { lockSha256: hash(lock), installedLockSha256: hash(installed),
    copiedFiles: files, copiedBytes: bytes, preservedFileLinks: links.length, protectedEntries, method: 'independent-file-copy' };
}

/** Commands are fixed and run sequentially, before artifact recording and any hold.
 * The process seam lets tests prove failure ordering without pretending a build passed. */
export function runPreparationChecks({ staged, scratch, npmCli, mainnetPublicBuild = false, inherited = process.env, run = spawnSync }) {
  if (process.versions.node !== pinnedNode || !path.isAbsolute(npmCli) ||
      !fs.lstatSync(npmCli).isFile() || typeof mainnetPublicBuild !== 'boolean') refuse();
  const env = preparationEnvironment({ commit: staged.commit, scratch, inherited });
  const publicNetwork = mainnetPublicBuild ? 'arc' : 'arcTestnet';
  const buildEnv = preparationEnvironment({ commit: staged.commit, scratch, publicNetwork, inherited });
  const toolchain = { nodeSha256: hash(fs.readFileSync(process.execPath)), npmCliSha256: hash(fs.readFileSync(npmCli)) };
  const call = (args, heap, outputFd, nodeEnv = 'production', publicBuild = false) => run(process.execPath, [npmCli, ...args], {
    cwd: staged.source, env: { ...(publicBuild ? buildEnv : env), NODE_ENV: nodeEnv, NODE_OPTIONS: `--max-old-space-size=${heap}` },
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
    // Vitest preserves an existing NODE_ENV; tests need its normal test runtime,
    // while compilation/runtime retain production. Financial isolation is equal.
    const nodeEnv = name === 'tests' ? 'test' : 'production';
    const startedAt = new Date().toISOString(), started = performance.now();
    const logFile = path.join(staged.candidate, `${name}.log`), fd = fs.openSync(logFile, 'wx', 0o600);
    let result;
    try {
      result = call(args, name === 'typecheck' ? 2560 : 1536, fd, nodeEnv, name === 'build');
      // Injectable processes may return captured output; native processes write
      // directly to the retained log even if the controller exits mid-check.
      fs.writeSync(fd, (result.stdout ?? '') + (result.stderr ?? ''));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    if (fs.statSync(logFile).size > 32 * 1024 * 1024) refuse();
    const output = fs.readFileSync(logFile);
    const receipt = { name, command: [process.execPath, npmCli, ...args], nodeEnv, startedAt,
      elapsedMs: Math.round(performance.now() - started), exitCode: result.status,
      signal: result.signal ?? null, outputSha256: hash(output), processError: result.error?.code ?? null };
    exclusiveReceipt(path.join(staged.candidate, `${name}.json`), receipt);
    results.push(receipt);
    if (result.error || result.signal || result.status !== 0) refuse();
  }
  if (hash(fs.readFileSync(process.execPath)) !== toolchain.nodeSha256 || hash(fs.readFileSync(npmCli)) !== toolchain.npmCliSha256) refuse();
  return { node: process.versions.node, npm: pinnedNpm, platform: process.platform, ...toolchain,
    arch: process.arch, publicBuildSettings: { network: publicNetwork, forceOffline: true,
      ...(mainnetPublicBuild ? { circleGooglePublicConfigSha256: hash(serial({
        NEXT_PUBLIC_CIRCLE_APP_ID: buildEnv.NEXT_PUBLIC_CIRCLE_APP_ID,
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: buildEnv.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
      })) } : {}),
    }, results };
}

export function prepareImmutableRelease({ repo, releasesDir, commit, dependencies, npmCli, mainnetPublicBuild = false }) {
  if (process.versions.node !== pinnedNode || typeof mainnetPublicBuild !== 'boolean') refuse();
  const startedAt = new Date().toISOString(), started = performance.now();
  const staged = stageImmutableSource({ repo, releasesDir, commit });
  // Scratch is deliberately outside source. Keep it on failure; never erase storage evidence.
  const scratch = path.join(staged.candidate, 'preparation-scratch');
  fs.mkdirSync(scratch, { mode: 0o700 });
  const inputs = copyPreparationDependencies({ source: staged.source, dependencies });
  const checks = runPreparationChecks({ staged, scratch, npmCli, mainnetPublicBuild });
  const buildAliases = materializePreparationBuildAliases({ source: staged.source, dependencies: path.join(staged.source, 'node_modules') });
  const protectedBuildEntries = protectPreparationCopy(path.join(staged.source, '.next'));
  if (process.platform !== 'win32') for (const file of ['next-env.d.ts', 'tsconfig.tsbuildinfo', 'tsconfig.ops-scripts.tsbuildinfo']) {
    const generated = path.join(staged.source, file);
    if (fs.existsSync(generated)) {
      const stat = fs.lstatSync(generated);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid()) refuse();
      fs.chmodSync(generated, 0o600);
    }
  }
  const artifact = recordImmutableArtifact(staged);
  verifyImmutableArtifact({ ...staged, artifactInspectionSha256: artifact.artifactInspectionSha256 });
  const receipt = { format: 'keryx-immutable-preparation-v1', productionAdmitted: false,
    startedAt, elapsedMs: Math.round(performance.now() - started), commit: staged.commit,
    tree: artifact.tree, sourceManifestSha256: staged.sourceManifestSha256,
    artifactInspectionSha256: artifact.artifactInspectionSha256,
    artifactDigest: artifact.artifactDigest, buildId: artifact.buildId, inputs, checks, buildAliases, protectedBuildEntries,
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

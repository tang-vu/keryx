import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const names = ['keryx', 'keryx-a2a-worker'];
const prefix = ['-i', 'PATH=/usr/bin:/bin', 'NODE_ENV=production', '/usr/bin/node', '--env-file=/root/keryx/.env.local'];
const tails = {
  keryx: ['/root/keryx/scripts/next-public-server.mjs', '--port', '3939'],
  'keryx-a2a-worker': ['--import', '/root/keryx/node_modules/tsx/dist/loader.mjs', '/root/keryx/scripts/a2a-research-worker.mts'],
};
const refuse = () => { throw Error('Reviewed role deployment refused; preserve processes and retained builds.'); };
const digest = b => createHash('sha256').update(b).digest('hex');
// This stdin authority stays self-contained. Regression tests keep its public
// digest vocabulary equal to the separately imported keyless builder's policy.
export const REVIEWED_PUBLIC_BUILD_KEYS = Object.freeze([
  'NEXT_PUBLIC_CIRCLE_APP_ID', 'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
  'KERYX_REGISTRY_ADDRESS', 'NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS',
  'KERYX_REGISTRY_READ_ADDRESS', 'NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS',
  'KERYX_RUN_PRIVACY_ENABLED', 'NEXT_PUBLIC_WC_PROJECT_ID',
  'KERYX_REGISTRY_VERSION', 'NEXT_PUBLIC_KERYX_REGISTRY_VERSION',
  'KERYX_REGISTRY_ORIGINS', 'NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS',
  'KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS', 'NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS',
]);
export function reviewedPublicBuildProfileSha256(bytes) {
  const env = parseEnv(bytes.toString('utf8'));
  const profile = Object.fromEntries(REVIEWED_PUBLIC_BUILD_KEYS.map(key =>
    [key, env[key] ?? (key === 'NEXT_PUBLIC_WC_PROJECT_ID' ? '' : undefined)]));
  if (env.KERYX_NETWORK !== 'arc' || env.NEXT_PUBLIC_KERYX_NETWORK !== 'arc' ||
      env.KERYX_RUN_PRIVACY_ENABLED !== 'true' || Object.values(profile).some(value => typeof value !== 'string') ||
      ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
        .some(key => ![undefined, ''].includes(env[key]))) refuse();
  return digest(JSON.stringify(profile) + '\n');
}
export function reviewedPrivateHeaderDigest(source) {
  const file = path.join(source, '.next', 'routes-manifest.json'), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024) refuse();
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(value.headers) || value.headers.length > 1024) refuse();
  const expected = [['Cache-Control', 'no-store'], ['Referrer-Policy', 'no-referrer'], ['X-Robots-Tag', 'noindex, nofollow']];
  const rows = ['/dispatch/:path*', '/api/dispatch/:path*'].map(sourcePath => {
    const found = value.headers.filter(row => row.source === sourcePath);
    if (found.length !== 1 || !Array.isArray(found[0].headers) || found[0].headers.length !== expected.length) refuse();
    const headers = found[0].headers.map(header => [header.key, header.value]);
    if (JSON.stringify(headers) !== JSON.stringify(expected)) refuse();
    return { source: sourcePath, headers };
  });
  return digest(JSON.stringify(rows) + '\n');
}
export function releaseSource(commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) refuse();
  return `/root/.local/share/keryx-releases/${commit}/source`;
}
export function validateReleaseBinding(value) {
  const fields = ['commit', 'sourceManifestSha256', 'artifactInspectionSha256',
    'preparationSha256', 'runtimeEnvironmentSha256', 'compatibilityReviewFile', 'compatibilityReviewSha256'];
  if (!value || Object.keys(value).sort().join('|') !== [...fields].sort().join('|')) refuse();
  releaseSource(value.commit);
  for (const name of fields.filter(name => name.endsWith('Sha256')))
    if (!/^[a-f0-9]{64}$/.test(value[name])) refuse();
  if (!/^\/root\/\.local\/share\/[a-zA-Z0-9_./-]+\.json$/.test(value.compatibilityReviewFile) ||
      path.posix.resolve(value.compatibilityReviewFile) !== value.compatibilityReviewFile) refuse();
  return value;
}

/** This protected operator review binds existing acceptance/native evidence, not
 * new payment/storage authority. No automatic migration or rollback is provided. */
export function verifyReleaseReview(binding, read, artifact, inspectHeaders = reviewedPrivateHeaderDigest) {
  validateReleaseBinding(binding);
  const preparation = read(`${path.posix.dirname(releaseSource(binding.commit))}/preparation.json`, binding.preparationSha256);
  if (!preparation || preparation.format !== 'keryx-immutable-preparation-v1' ||
      preparation.productionAdmitted !== false || preparation.commit !== binding.commit ||
      preparation.sourceManifestSha256 !== binding.sourceManifestSha256 ||
      preparation.artifactInspectionSha256 !== binding.artifactInspectionSha256 ||
      preparation.writerHoldStarted !== false || preparation.runtimeEnvironmentLoaded !== false ||
      preparation.checks?.publicBuildSettings?.network !== 'arc' || preparation.checks.publicBuildSettings.forceOffline !== false || preparation.checks?.platform !== 'linux' ||
      preparation.checks?.node !== '24.22.1' || preparation.checks?.npm !== '11.19.0' ||
      !Array.isArray(preparation.checks.results) || preparation.checks.results.length !== 3 ||
      preparation.checks.results.some((result, index) => result.name !== ['typecheck', 'tests', 'build'][index] ||
        result.exitCode !== 0 || result.signal !== null || result.processError !== null || !/^[a-f0-9]{64}$/.test(result.outputSha256))) refuse();
  const runtimePublic = read('/root/keryx/.env.local', binding.runtimeEnvironmentSha256, true);
  if (!runtimePublic || runtimePublic.mainnetPublicConfigSha256 !== preparation.checks.publicBuildSettings.mainnetPublicConfigSha256 ||
      !/^[a-f0-9]{64}$/.test(preparation.checks.publicBuildSettings.mainnetPublicConfigSha256) ||
      !/^[a-f0-9]{64}$/.test(preparation.checks.publicBuildSettings.privateRunHeadersSha256)) refuse();
  const review = read(binding.compatibilityReviewFile, binding.compatibilityReviewSha256);
  const fields = ['format', 'commit', 'tree', 'sourceManifestSha256', 'artifactInspectionSha256',
    'artifactDigest', 'buildId', 'runtimeEnvironmentSha256', 'acceptanceEvidenceSha256',
    'storageIdentityDigest', 'economicSchemaDigest', 'retainedEconomicStateSha256',
    'sourceAndArtifactAccepted', 'mainnetPublicSettingsAccepted', 'previouslyActiveRoles',
    'heldSchedulers', 'rollback'];
  if (!review || Object.keys(review).sort().join('|') !== [...fields].sort().join('|') ||
      review.format !== 'keryx-reviewed-release-compatibility-v1' || review.commit !== binding.commit ||
      !/^[a-f0-9]{40}$/.test(review.tree) || !/^[a-zA-Z0-9_-]{1,128}$/.test(review.buildId) ||
      review.sourceManifestSha256 !== binding.sourceManifestSha256 ||
      review.artifactInspectionSha256 !== binding.artifactInspectionSha256 ||
      review.runtimeEnvironmentSha256 !== binding.runtimeEnvironmentSha256 ||
      review.sourceAndArtifactAccepted !== true || review.mainnetPublicSettingsAccepted !== true ||
      !Array.isArray(review.previouslyActiveRoles) || review.previouslyActiveRoles.length !== names.length ||
      JSON.stringify([...review.previouslyActiveRoles].sort()) !== JSON.stringify([...names].sort()) ||
      review.heldSchedulers !== true || review.rollback !== 'hold-for-review') refuse();
  for (const name of ['artifactDigest', 'acceptanceEvidenceSha256', 'storageIdentityDigest',
    'economicSchemaDigest', 'retainedEconomicStateSha256']) if (!/^[a-f0-9]{64}$/.test(review[name])) refuse();
  if (artifact && ['commit', 'tree', 'buildId', 'artifactDigest', 'sourceManifestSha256'].some(name =>
    artifact[name] !== review[name] || artifact[name] !== preparation[name])) refuse();
  if (artifact && inspectHeaders(releaseSource(binding.commit)) !== preparation.checks.publicBuildSettings.privateRunHeadersSha256) refuse();
  return review;
}

export function verifyReleaseSourcePaths(source) {
  // These existing subprocess call sites select code through operational cwd.
  // Until the source owner closes that observed trace gap, a cohort-local web
  // launcher cannot establish that every extraction worker uses the cohort.
  // No ENV/working-directory rebasing may silently change financial data paths.
  for (const file of ['lib/web-research/pdf-reader.ts', 'lib/web-research/html-reader.ts',
    'lib/research/arxiv-bibliography-page.ts']) {
    const bytes = fs.readFileSync(path.join(source, file));
    if (bytes.length > 1024 * 1024 || /\bprocess\s*\.\s*cwd\s*\(/u.test(bytes.toString('utf8'))) refuse();
  }
}
// Recognize the earlier clean launcher only when retaining a stopped definition;
// new reviewed configurations always require the fixed public-origin server.
const previousWebTail = ['/root/keryx/node_modules/next/dist/bin/next', 'start', '-p', '3939'];
const previousLoopbackWebTail = [...previousWebTail,
  '--hostname', '127.0.0.1', '--keepAliveTimeout', '100000'];

// Only these non-secret operator controls may precede the fixed Node command. Node's
// --env-file still owns every financial/custody setting; no arbitrary PM2 env is accepted.
// The model runtime independently verifies the protected, nonsymlink policy file and digest.
function reviewedControls(args, tail, commit) {
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string') ||
      JSON.stringify(args.slice(0, 3)) !== JSON.stringify(prefix.slice(0, 3))) return null;
  const binary = args.indexOf('/usr/bin/node');
  if (binary < 3 || binary > (commit ? 7 : 6) ||
      JSON.stringify(args.slice(binary)) !== JSON.stringify([...prefix.slice(3), ...tail])) return null;
  const controls = new Map();
  for (const assignment of args.slice(3, binary)) {
    const split = assignment.indexOf('=');
    if (split < 1) return null;
    const key = assignment.slice(0, split), value = assignment.slice(split + 1);
    if (controls.has(key)) return null;
    if (key === 'KERYX_DECISION_BRIEF') { if (!/^[01]$/.test(value)) return null; }
    else if (key === 'KERYX_COMMIT') { if (!commit || value !== commit) return null; }
    else if (key === 'KERYX_MODEL_ALLOWANCE_FILE') {
      if (!/^\/root\/\.local\/share\/[a-zA-Z0-9_./-]+\.json$/.test(value) ||
          value.includes('..') || path.posix.resolve(value) !== value) return null;
    } else if (key === 'KERYX_MODEL_ALLOWANCE_SHA256') { if (!/^[a-f0-9]{64}$/.test(value)) return null; }
    else return null;
    controls.set(key, value);
  }
  if (controls.has('KERYX_MODEL_ALLOWANCE_FILE') !== controls.has('KERYX_MODEL_ALLOWANCE_SHA256')) return null;
  if (commit && !controls.has('KERYX_COMMIT')) return null;
  return ['KERYX_DECISION_BRIEF', 'KERYX_MODEL_ALLOWANCE_FILE', 'KERYX_MODEL_ALLOWANCE_SHA256']
    .map(key => controls.get(key) ?? null);
}

function releaseTail(name, commit) {
  const source = releaseSource(commit);
  return name === 'keryx' ? [`${source}/scripts/next-immutable-server.mjs`, '--port', '3939'] :
    ['--import', `${source}/node_modules/tsx/dist/loader.mjs`, `${source}/scripts/a2a-research-worker.mts`];
}

function stoppedDefinition(rows, name) {
  if (!Array.isArray(rows)) refuse();
  const found = rows.filter(r => r.name === name);
  if (found.length > 1) refuse();
  if (!found.length) return null;
  const r = found[0], e = r.pm2_env;
  if (r.pid !== 0 || !e || !['stopped', 'errored'].includes(e.status)) refuse();
  // Retain only recognized executable arguments. PM2's environment may contain
  // secrets; it is never copied, serialized, or printed by this helper.
  const previousRelease = Array.isArray(e.args) ? e.args.find(a => typeof a === 'string' && /^KERYX_COMMIT=[a-f0-9]{40}$/.test(a))?.slice(13) : undefined;
  const clean = e.pm_exec_path === '/usr/bin/env' && e.exec_interpreter === 'none' &&
    (reviewedControls(e.args, tails[name]) !== null ||
      previousRelease && reviewedControls(e.args, releaseTail(name, previousRelease), previousRelease) !== null ||
      name === 'keryx' && [previousWebTail, previousLoopbackWebTail].some(tail =>
        reviewedControls(e.args, tail) !== null));
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
  if (!value || !['apps', 'apps|release'].includes(Object.keys(value).sort().join('|')) || !Array.isArray(value.apps) || value.apps.length !== 2) refuse();
  if (Object.hasOwn(value, 'release') && !value.release) refuse();
  if (value.release) validateReleaseBinding(value.release);
  const allowed = new Set(['name', 'script', 'interpreter', 'cwd', 'args', 'autorestart', 'kill_timeout', 'out_file', 'error_file', 'exec_mode', 'instances', 'merge_logs', 'time']);
  const controls = [];
  for (const name of names) {
    const matches = value.apps.filter(a => a?.name === name);
    if (matches.length !== 1) refuse();
    const a = matches[0];
    if (Object.keys(a).some(k => !allowed.has(k)) || a.script !== '/usr/bin/env' || a.interpreter !== 'none' ||
        a.cwd !== '/root/keryx' || typeof a.autorestart !== 'boolean' ||
        !Number.isSafeInteger(a.kill_timeout) || a.kill_timeout < 330000 || a.kill_timeout > 900000 ||
        reviewedControls(a.args, value.release ? releaseTail(name, value.release.commit) : tails[name], value.release?.commit) === null ||
        a.exec_mode !== undefined && a.exec_mode !== 'fork' || a.instances !== undefined && a.instances !== 1) refuse();
    for (const k of ['out_file', 'error_file']) if (a[k] !== undefined &&
      (typeof a[k] !== 'string' || !/^\/root\/\.pm2\/logs\/[a-zA-Z0-9_-]+\.log$/.test(a[k]))) refuse();
    for (const k of ['merge_logs', 'time']) if (a[k] !== undefined && typeof a[k] !== 'boolean') refuse();
    controls.push(JSON.stringify(reviewedControls(a.args,
      value.release ? releaseTail(name, value.release.commit) : tails[name], value.release?.commit)));
  }
  // Both public processes share the same allowance/feature scope. A worker without the
  // reviewed pair must not become an alternate provider path outside the web's budget.
  if (controls[0] !== controls[1]) refuse();
  return value;
}

export function readProtectedDeploymentJson(file, expectedSha256, environmentFile = false) {
  if (process.platform !== 'linux' || process.getuid() !== 0 || !/^[a-f0-9]{64}$/.test(expectedSha256) ||
      !(environmentFile ? file === '/root/keryx/.env.local' : /^\/root\/\.local\/share\/[a-zA-Z0-9_./-]+\.json$/.test(file)) || path.resolve(file) !== file) refuse();
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
    return environmentFile ? { mainnetPublicConfigSha256: reviewedPublicBuildProfileSha256(bytes) } : JSON.parse(bytes);
  } finally { fs.closeSync(fd); }
}
export function readReviewedRoles(file, expected) {
  return validateReviewedRoles(readProtectedDeploymentJson(file, expected));
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
    if (![5, 7].includes(process.argv.length)) refuse();
    const [file, expected, mode, staged = '0', expectedCommit = ''] = process.argv.slice(2);
    const config = readReviewedRoles(file, expected);
    if (!['0', '1'].includes(staged) || Boolean(config.release) !== (staged === '1') ||
        config.release && config.release.commit !== expectedCommit) refuse();
    const recheck = () => {
      readReviewedRoles(file, expected);
      if (config.release) verifyReleaseReview(config.release, readProtectedDeploymentJson);
    };
    recheck();
    if (mode === 'artifact') {
      if (!config.release) refuse();
      // stdin executes at /root/keryx; the already deployed built-in inspector is
      // authoritative; its accepted deployed version must cover this artifact.
      // No candidate inspector or serving source/dependencies are loaded/mutated.
      const { verifyImmutableArtifact } = await import('file:///root/keryx/scripts/immutable-release-staging.mjs');
      const artifact = verifyImmutableArtifact({ candidate: path.dirname(releaseSource(config.release.commit)), ...config.release });
      verifyReleaseSourcePaths(releaseSource(config.release.commit));
      verifyReleaseReview(config.release, readProtectedDeploymentJson, artifact);
      console.log('Reviewed immutable source/artifact and compatibility binding passed.');
      process.exit(0);
    }
    const call = args => execFileSync('/usr/bin/pm2', args, { encoding: 'utf8', maxBuffer: 4194304,
      env: { PATH: '/usr/bin:/bin', HOME: '/root', PM2_HOME: '/root/.pm2' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const manager = { list: () => JSON.parse(call(['jlist'])), run: args => { call(args); } };
    deployReviewedRole(mode, file, config, manager, recheck,
      (name, previous) => retainDefinition(file, name, previous, expected));
    console.log('Reviewed PM2 role boundary passed.');
  } catch { console.error('Reviewed role deployment refused; preserve processes and retained builds.'); process.exitCode = 1; }
}

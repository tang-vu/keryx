// Preparation/inspection only. This module never loads application code, runtime
// ENV, storage, signers or process managers, and cannot admit a production release.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MiB = 1024 * 1024;
const limits = { sourceBytes: 256 * MiB, blobBytes: 32 * MiB, sourceFiles: 10000,
  artifactBytes: 8 * 1024 * MiB, artifactFiles: 250000, manifestBytes: 4 * MiB };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const refuse = () => { throw Error('Immutable staging refused; retain candidate and existing releases for inspection.'); };
const signature = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join('|');
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const serial = value => JSON.stringify(value) + '\n';

function relativeName(name) {
  if (typeof name !== 'string' || name.length < 1 || name.length > 512 ||
      /[\x00-\x1f\x7f\\:*?"<>|\ufffd]/u.test(name) || path.posix.isAbsolute(name) ||
      name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) refuse();
  return name;
}

function sourceName(name) {
  relativeName(name);
  if (name.split('/').some(part => part === '.git' || part === 'wallets.json' ||
      part.startsWith('.env') && part !== '.env.example' || /\.(?:key|pem|sqlite3?|db)$/.test(part)) ||
      ['data', 'node_modules', '.next'].includes(name.split('/')[0])) refuse();
  return name;
}

function noSymlinkParents(directory) {
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) refuse();
    if (path.dirname(current) === current) break;
  }
}

function absoluteDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory) refuse();
  noSymlinkParents(directory);
  return directory;
}

function git(repo, argv, input, maxBuffer = limits.sourceBytes + 8 * MiB) {
  // Exact local objects only: no fetch, checkout, config export, hooks or shell.
  const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_OPTIONAL_LOCKS: '0' };
  if (process.platform === 'win32') env.SystemRoot = process.env.SystemRoot;
  return execFileSync('git', ['--no-replace-objects', '-C', repo, ...argv],
    { env, input, maxBuffer, timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] });
}

function readExactTree(repo, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit) ||
      git(repo, ['rev-parse', '--verify', `${commit}^{commit}`]).toString().trim() !== commit) refuse();
  const tree = git(repo, ['rev-parse', `${commit}^{tree}`]).toString().trim();
  const lines = git(repo, ['ls-tree', '-r', '-l', '-z', '--full-tree', commit]).toString('utf8').split('\0');
  if (lines.pop() !== '' || lines.length < 1 || lines.length > limits.sourceFiles) refuse();
  let bytes = 0;
  const nonRuntimeGitlinks = [];
  const folded = new Map();
  const files = lines.map(line => {
    const gitlink = /^160000 commit ([a-f0-9]{40})\s+-\t([\s\S]+)$/.exec(line);
    if (gitlink) {
      // The standalone Showcase is not imported by the Keryx runtime. Preserve
      // its exact public pointer without fetching/copying another repository.
      if (gitlink[2] !== 'arc-primitives' || nonRuntimeGitlinks.length !== 0) refuse();
      nonRuntimeGitlinks.push({ path: gitlink[2], commit: gitlink[1], materialization: 'empty-non-runtime-directory' });
      return null;
    }
    const match = /^(100644|100755) blob ([a-f0-9]{40})\s+(\d+)\t([\s\S]+)$/.exec(line);
    if (!match) refuse(); // Other gitlinks and symlinks need a reviewed materializer.
    const [, mode, object, length, name] = match;
    sourceName(name);
    const size = Number(length);
    bytes += size;
    if (!Number.isSafeInteger(size) || size > limits.blobBytes || bytes > limits.sourceBytes || folded.has(name.toLowerCase())) refuse();
    let part = '';
    for (const component of name.split('/')) {
      part = part ? part + '/' + component : component;
      const previous = folded.get(part.toLowerCase());
      if (previous !== undefined && previous !== part) refuse();
      folded.set(part.toLowerCase(), part);
    }
    return { path: name, object, size, executable: mode === '100755' };
  }).filter(Boolean);
  if (nonRuntimeGitlinks.length) {
    const modules = git(repo, ['show', `${commit}:.gitmodules`], undefined, 8192).toString().split('\n')
      .map(line => line.trim()).filter(Boolean);
    if (JSON.stringify(modules) !== JSON.stringify(['[submodule "arc-primitives"]', 'path = arc-primitives',
      'url = https://github.com/tang-vu/keryx-arc-primitives.git'])) refuse();
  }
  return { tree, files, bytes, nonRuntimeGitlinks };
}

function readBlobs(repo, files) {
  const objects = [...new Map(files.map(file => [file.object, file])).values()];
  const output = git(repo, ['cat-file', '--batch'], objects.map(file => file.object + '\n').join(''));
  let offset = 0;
  const blobs = new Map();
  for (const file of objects) {
    const end = output.indexOf(10, offset);
    if (end < 0 || output.subarray(offset, end).toString() !== `${file.object} blob ${file.size}`) refuse();
    offset = end + 1;
    const bytes = output.subarray(offset, offset + file.size);
    const objectHash = createHash('sha1').update(`blob ${file.size}\0`).update(bytes).digest('hex');
    if (bytes.length !== file.size || objectHash !== file.object || output[offset + file.size] !== 10) refuse();
    blobs.set(file.object, bytes);
    offset += file.size + 1;
  }
  if (offset !== output.length) refuse();
  return blobs;
}

function writeExclusive(file, bytes, mode = 0o600) {
  const fd = fs.openSync(file, 'wx', mode);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function readStable(file, maxBytes) {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(maxBytes) ||
      process.platform !== 'win32' && (before.uid !== BigInt(process.getuid()) || before.mode & 0o022n)) refuse();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | fs.constants.O_NONBLOCK);
  try {
    if (signature(before) !== signature(fs.fstatSync(fd, { bigint: true }))) refuse();
    const size = Number(before.size), bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const count = fs.readSync(fd, bytes, offset, size - offset, null);
      if (!count) refuse(); offset += count;
    }
    // A growing file cannot cause an unbounded allocation before the metadata check.
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0 ||
        signature(before) !== signature(fs.fstatSync(fd, { bigint: true })) ||
        signature(before) !== signature(fs.lstatSync(file, { bigint: true }))) refuse();
    return bytes;
  } finally { fs.closeSync(fd); }
}

/** Materialize accepted local Git bytes into a new exclusive directory, never a
 * mutable checkout or a linked dependency tree shared with the serving process. */
export function stageImmutableSource({ repo, releasesDir, commit, reserveBytes = 4 * 1024 * MiB }) {
  absoluteDirectory(repo); absoluteDirectory(releasesDir);
  if (inside(repo, releasesDir) || inside(releasesDir, repo) ||
      !Number.isSafeInteger(reserveBytes) || reserveBytes < 0 || reserveBytes > 64 * 1024 * MiB) refuse();
  const { tree, files, bytes, nonRuntimeGitlinks } = readExactTree(repo, commit);
  const disk = fs.statfsSync(releasesDir, { bigint: true });
  if (disk.bavail * disk.bsize < BigInt(reserveBytes + bytes)) refuse();
  const blobs = readBlobs(repo, files);
  const candidate = path.join(releasesDir, commit);
  fs.mkdirSync(candidate, { mode: 0o700 }); // Existing/partial evidence always refuses.
  const source = path.join(candidate, 'source');
  fs.mkdirSync(source, { mode: 0o700 });
  for (const link of nonRuntimeGitlinks) fs.mkdirSync(path.join(source, link.path), { mode: 0o700 });
  const inventory = [];
  for (const file of files) {
    const destination = path.join(source, ...file.path.split('/'));
    if (!inside(source, destination)) refuse();
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const content = blobs.get(file.object);
    writeExclusive(destination, content, file.executable ? 0o500 : 0o400);
    inventory.push({ ...file, sha256: sha(content) });
  }
  const manifest = { format: 'keryx-immutable-source-v1', productionAdmitted: false,
    commit, tree, sourceBytes: bytes, sourceDigest: sha(serial(inventory)), nonRuntimeGitlinks, files: inventory };
  const encoded = serial(manifest);
  if (Buffer.byteLength(encoded) > limits.manifestBytes) refuse();
  writeExclusive(path.join(candidate, 'source-manifest.json'), encoded);
  return { candidate, source, sourceManifestSha256: sha(encoded), commit };
}

function readSourceManifest(candidate, expected) {
  absoluteDirectory(candidate);
  if (!/^[a-f0-9]{64}$/.test(expected)) refuse();
  const bytes = readStable(path.join(candidate, 'source-manifest.json'), limits.manifestBytes);
  if (sha(bytes) !== expected) refuse();
  const value = JSON.parse(bytes);
  if (value.format !== 'keryx-immutable-source-v1' || value.productionAdmitted !== false ||
      !/^[a-f0-9]{40}$/.test(value.commit) || !/^[a-f0-9]{40}$/.test(value.tree) ||
      path.basename(candidate) !== value.commit || !Array.isArray(value.files) ||
      value.files.length < 1 || value.files.length > limits.sourceFiles || sha(serial(value.files)) !== value.sourceDigest) refuse();
  if (!Array.isArray(value.nonRuntimeGitlinks) || value.nonRuntimeGitlinks.length > 1 ||
      value.nonRuntimeGitlinks.some(link => link.path !== 'arc-primitives' || !/^[a-f0-9]{40}$/.test(link.commit) ||
        link.materialization !== 'empty-non-runtime-directory')) refuse();
  let total = 0;
  const names = new Set();
  for (const file of value.files) {
    sourceName(file.path);
    if (!/^[a-f0-9]{40}$/.test(file.object) || !/^[a-f0-9]{64}$/.test(file.sha256) ||
        typeof file.executable !== 'boolean' || !Number.isSafeInteger(file.size) || file.size < 0 ||
        file.size > limits.blobBytes || names.has(file.path.toLowerCase())) refuse();
    names.add(file.path.toLowerCase()); total += file.size;
  }
  if (total !== value.sourceBytes || total > limits.sourceBytes) refuse();
  return value;
}

function snapshotTree(root) {
  const entries = [], buffer = Buffer.alloc(65536);
  const deadline = performance.now() + 120000;
  const check = stat => {
    if (performance.now() > deadline || process.platform !== 'win32' &&
        !stat.isSymbolicLink() && (stat.uid !== BigInt(process.getuid()) || stat.mode & 0o022n)) refuse();
  };
  let total = 0;
  function visit(directory) {
    const before = fs.lstatSync(directory, { bigint: true });
    check(before);
    if (!before.isDirectory() || before.isSymbolicLink()) refuse();
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), relative = path.relative(root, file).split(path.sep).join('/');
      relativeName(relative);
      const stat = fs.lstatSync(file, { bigint: true });
      check(stat);
      if (entries.length >= limits.artifactFiles) refuse();
      if (stat.isDirectory()) {
        entries.push({ path: relative, type: 'directory' }); visit(file);
      } else if (stat.isSymbolicLink()) {
        const link = fs.readlinkSync(file), target = fs.realpathSync(file);
        if (path.isAbsolute(link) || !inside(root, target) || !fs.statSync(target).isFile() ||
            signature(stat) !== signature(fs.lstatSync(file, { bigint: true }))) refuse();
        entries.push({ path: relative, type: 'symlink', link });
      } else {
        if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(limits.artifactBytes)) refuse();
        total += Number(stat.size);
        if (total > limits.artifactBytes) refuse();
        const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | fs.constants.O_NONBLOCK);
        const hash = createHash('sha256'); let size = 0;
        try {
          if (signature(stat) !== signature(fs.fstatSync(fd, { bigint: true }))) refuse();
          for (let count; (count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) {
            size += count; check(stat); if (size > Number(stat.size)) refuse(); hash.update(buffer.subarray(0, count));
          }
          if (size !== Number(stat.size) || signature(stat) !== signature(fs.fstatSync(fd, { bigint: true })) ||
              signature(stat) !== signature(fs.lstatSync(file, { bigint: true }))) refuse();
        } finally { fs.closeSync(fd); }
        entries.push({ path: relative, type: 'file', size, executable: Boolean(stat.mode & 0o111n), sha256: hash.digest('hex') });
      }
    }
    if (signature(before) !== signature(fs.lstatSync(directory, { bigint: true }))) refuse();
  }
  visit(root);
  return { entries, digest: sha(serial(entries)), bytes: total };
}

/** Inspect a separately prepared candidate. A digest binds bytes; it does not
 * attest successful tests, build environment, DB compatibility or spend authority. */
export function inspectImmutableArtifact({ candidate, sourceManifestSha256 }) {
  const manifest = readSourceManifest(candidate, sourceManifestSha256);
  const source = path.join(candidate, 'source'); noSymlinkParents(source);
  const snapshot = snapshotTree(source), byName = new Map(snapshot.entries.map(entry => [entry.path, entry]));
  const permitted = new Set(manifest.files.map(file => file.path));
  const directories = new Set();
  for (const link of manifest.nonRuntimeGitlinks) {
    if (byName.get(link.path)?.type !== 'directory') refuse();
    directories.add(link.path);
  }
  for (const file of manifest.files) {
    let directory = path.posix.dirname(file.path);
    while (directory !== '.') { directories.add(directory); directory = path.posix.dirname(directory); }
    const actual = byName.get(file.path);
    if (!actual || actual.type !== 'file' || actual.size !== file.size || actual.sha256 !== file.sha256 ||
        process.platform !== 'win32' && actual.executable !== file.executable) refuse();
  }
  for (const entry of snapshot.entries) {
    if (permitted.has(entry.path) || directories.has(entry.path)) continue;
    const top = entry.path.split('/')[0];
    if (!['.next', 'node_modules'].includes(top) &&
        !['next-env.d.ts', 'tsconfig.tsbuildinfo', 'tsconfig.ops-scripts.tsbuildinfo'].includes(entry.path)) refuse();
  }
  const buildId = readStable(path.join(source, '.next', 'BUILD_ID'), 1024).toString().trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(buildId) || !byName.has('node_modules') ||
      !byName.has('.next/next-server.js.nft.json')) refuse();
  let tracedFiles = 0;
  for (const entry of snapshot.entries.filter(entry => entry.path.startsWith('.next/') && entry.path.endsWith('.nft.json'))) {
    if (entry.type !== 'file') refuse();
    const tracePath = path.join(source, ...entry.path.split('/'));
    const trace = JSON.parse(readStable(tracePath, 4 * MiB));
    if (trace.version !== 1 || !Array.isArray(trace.files) || trace.files.length > 100000) refuse();
    for (const name of trace.files) {
      if (typeof name !== 'string' || name.length > 1024 || path.isAbsolute(name) || /[\x00-\x1f\\]/.test(name)) refuse();
      const target = path.resolve(path.dirname(tracePath), name);
      if (!inside(source, target) || !inside(source, fs.realpathSync(target)) || !fs.statSync(target).isFile()) refuse();
      if (++tracedFiles > 500000) refuse();
    }
  }
  // Recheck after trace inspection; publication accepts only a stable cohort.
  const after = snapshotTree(source);
  if (after.digest !== snapshot.digest || serial(readSourceManifest(candidate, sourceManifestSha256)) !== serial(manifest)) refuse();
  return { format: 'keryx-immutable-artifact-inspection-v1', productionAdmitted: false,
    commit: manifest.commit, tree: manifest.tree, sourceManifestSha256, buildId,
    artifactDigest: snapshot.digest, artifactBytes: snapshot.bytes, artifactEntries: snapshot.entries.length, tracedFiles };
}

export function recordImmutableArtifact(options) {
  const inspection = inspectImmutableArtifact(options);
  const bytes = serial(inspection);
  writeExclusive(path.join(options.candidate, 'artifact-inspection.json'), bytes);
  return { ...inspection, artifactInspectionSha256: sha(bytes) };
}

export function verifyImmutableArtifact(options) {
  const { artifactInspectionSha256 } = options;
  if (!/^[a-f0-9]{64}$/.test(artifactInspectionSha256)) refuse();
  const bytes = readStable(path.join(options.candidate, 'artifact-inspection.json'), 16384);
  if (sha(bytes) !== artifactInspectionSha256 || serial(inspectImmutableArtifact(options)) !== bytes.toString()) refuse();
  return JSON.parse(bytes);
}

function protectedCliRoot() {
  const root = '/root/.local/share/keryx-releases';
  if (process.platform !== 'linux' || process.getuid() !== 0) refuse();
  absoluteDirectory(root);
  for (let directory = root; ; directory = path.dirname(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.uid !== 0 || stat.gid !== 0 || stat.mode & 0o022) refuse();
    if (directory === '/') break;
  }
  if ((fs.statSync(root).mode & 0o777) !== 0o700) refuse();
  return root;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, commit, sourceManifestSha256, artifactInspectionSha256] = process.argv.slice(2);
    if (mode === '--help' && process.argv.length === 3) {
      console.log('Keyless staging only; no production admission. stage COMMIT | inspect COMMIT SOURCE_SHA256 | verify COMMIT SOURCE_SHA256 ARTIFACT_SHA256');
    } else {
      if (!/^[a-f0-9]{40}$/.test(commit)) refuse();
      const root = protectedCliRoot(), candidate = path.join(root, commit);
      let result;
      if (mode === 'stage' && process.argv.length === 4) result = stageImmutableSource({ repo: '/root/keryx', releasesDir: root, commit });
      else if (mode === 'inspect' && process.argv.length === 5) result = recordImmutableArtifact({ candidate, sourceManifestSha256 });
      else if (mode === 'verify' && process.argv.length === 6) result = verifyImmutableArtifact({ candidate, sourceManifestSha256, artifactInspectionSha256 });
      else refuse();
      console.log(JSON.stringify(result));
    }
  } catch { console.error('Immutable staging refused; retain candidate and existing releases for inspection.'); process.exitCode = 1; }
}

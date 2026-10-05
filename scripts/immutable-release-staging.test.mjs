import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { stageImmutableSource, inspectImmutableArtifact, recordImmutableArtifact, verifyImmutableArtifact } from './immutable-release-staging.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-immutable-test-'));
  // Only this exclusively created, checked temporary directory is cleaned up.
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.match(path.basename(root), /^keryx-immutable-test-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const repo = path.join(root, 'repo'), releasesDir = path.join(root, 'releases');
  fs.mkdirSync(repo, { mode: 0o700 }); fs.mkdirSync(releasesDir, { mode: 0o700 });
  const git = (args, input) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  }).trim();
  git(['init', '-q']); git(['config', 'user.name', 'Synthetic Fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  fs.writeFileSync(path.join(repo, 'runtime.txt'), 'accepted source bytes\n');
  fs.writeFileSync(path.join(repo, 'same-blob.txt'), 'accepted source bytes\n');
  fs.writeFileSync(path.join(repo, '.env.example'), '# public example only\n');
  git(['add', '.']); git(['commit', '-qm', 'synthetic accepted commit']);
  const commit = git(['rev-parse', 'HEAD']);
  const stage = () => stageImmutableSource({ repo, releasesDir, commit, reserveBytes: 0 });
  return { root, repo, releasesDir, commit, git, stage };
}

// Build an exact tree spelling without creating that working-tree path. This
// also permits Windows device/case-alias fixtures without opening their handles.
function commitWithPath(git, name) {
  let object = git(['hash-object', 'runtime.txt']), kind = 'blob', mode = '100644';
  for (const part of name.split('/').reverse()) {
    object = git(['mktree', '-z'], `${mode} ${kind} ${object}\t${part}\0`);
    kind = 'tree'; mode = '040000';
  }
  return git(['commit-tree', object, '-m', 'synthetic forbidden path']);
}

function addSyntheticArtifact(staged) {
  const next = path.join(staged.source, '.next'), dependencies = path.join(staged.source, 'node_modules');
  fs.mkdirSync(next); fs.mkdirSync(dependencies);
  fs.mkdirSync(path.join(dependencies, 'fixture'));
  fs.writeFileSync(path.join(dependencies, 'fixture', 'index.js'), 'export default "synthetic, no network";\n');
  fs.writeFileSync(path.join(next, 'BUILD_ID'), 'synthetic-no-spend-build\n');
  fs.writeFileSync(path.join(next, 'next-server.js.nft.json'), JSON.stringify({ version: 1,
    files: ['../runtime.txt', '../node_modules/fixture/index.js'] }));
}

test('materializes only exact Git objects without changing the serving checkout or copying secrets', t => {
  const fixtureState = fixture(t);
  const { repo, git, stage } = fixtureState;
  fs.writeFileSync(path.join(repo, '.env.local'), 'SYNTHETIC_SECRET=must-not-copy');
  fs.writeFileSync(path.join(repo, 'runtime.txt'), 'mutable serving source\n');
  const status = git(['status', '--porcelain']);
  const staged = stage();
  assert.equal(fs.readFileSync(path.join(staged.source, 'runtime.txt'), 'utf8'), 'accepted source bytes\n');
  assert.equal(fs.readFileSync(path.join(staged.source, 'same-blob.txt'), 'utf8'), 'accepted source bytes\n');
  assert.equal(fs.existsSync(path.join(staged.source, '.env.local')), false);
  assert.equal(git(['status', '--porcelain']), status);
  const source = JSON.parse(fs.readFileSync(path.join(staged.candidate, 'source-manifest.json')));
  assert.equal(source.productionAdmitted, false);
  assert.equal(source.commit, fixtureState.commit);
  assert.throws(stage); // Never overwrite existing or partial release evidence.
});

test('refuses moving refs, malformed hashes and source/artifact directories inside the serving tree', t => {
  const { repo, releasesDir, commit } = fixture(t);
  for (const value of ['HEAD', commit.slice(0, 7), 'x'.repeat(40)]) {
    assert.throws(() => stageImmutableSource({ repo, releasesDir, commit: value, reserveBytes: 0 }));
  }
  const nested = path.join(repo, 'releases'); fs.mkdirSync(nested);
  assert.throws(() => stageImmutableSource({ repo, releasesDir: nested, commit, reserveBytes: 0 }));
  assert.throws(() => stageImmutableSource({ repo, releasesDir: path.parse(repo).root, commit, reserveBytes: 0 }));
  assert.throws(() => stageImmutableSource({ repo, releasesDir, commit, reserveBytes: -1 }));
  assert.deepEqual(fs.readdirSync(releasesDir), []);
});

test('disk headroom refusal happens before creating a candidate', t => {
  const { repo, releasesDir, commit } = fixture(t), original = fs.statfsSync;
  try {
    fs.statfsSync = () => ({ bavail: 0n, bsize: 4096n });
    assert.throws(() => stageImmutableSource({ repo, releasesDir, commit }));
  } finally { fs.statfsSync = original; }
  assert.deepEqual(fs.readdirSync(releasesDir), []);
});

test('Windows case aliases cannot place releases inside the serving tree or its ancestor', { skip: process.platform !== 'win32' }, t => {
  const { root, repo, git, commit } = fixture(t), nested = path.join(repo, 'nested-releases');
  fs.mkdirSync(nested);
  const alias = path.join(root, 'REPO'), status = git(['status', '--porcelain']);
  for (const [source, releasesDir] of [[alias, nested], [repo, alias], [alias, root]]) {
    assert.throws(() => stageImmutableSource({ repo: source, releasesDir, commit, reserveBytes: 0 }));
  }
  assert.deepEqual(fs.readdirSync(nested), []);
  assert.equal(git(['status', '--porcelain']), status);
  assert.equal(fs.existsSync(path.join(root, commit)), false);
});

test('missing promisor objects refuse without invoking even a local fetch transport', t => {
  const { root, repo, releasesDir, git, commit } = fixture(t);
  const remote = path.join(root, 'local-only-remote'), witness = path.join(root, 'fetch-witness.mjs');
  const marker = path.join(root, 'fetch-invoked');
  fs.mkdirSync(remote);
  execFileSync('git', ['init', '--bare', '-q', remote], { stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync(witness, `import fs from 'node:fs';import {fileURLToPath} from 'node:url';\nfs.writeFileSync(fileURLToPath(new URL('./fetch-invoked',import.meta.url)),'local transport invoked');process.exit(1);\n`);
  git(['config', 'extensions.partialClone', 'origin']);
  git(['config', 'remote.origin.url', remote]);
  git(['config', 'remote.origin.promisor', 'true']);
  git(['config', 'remote.origin.partialclonefilter', 'blob:none']);
  git(['config', 'protocol.file.allow', 'always']);
  // This exclusively local upload-pack witness never reads application state or
  // opens a socket. It proves the malformed fixture would otherwise auto-fetch.
  const quoted = value => `'${value.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;
  git(['config', 'remote.origin.uploadpack', `${quoted(process.execPath)} ${quoted(witness)}`]);
  const object = git(['hash-object', 'runtime.txt']);
  fs.unlinkSync(path.join(repo, '.git', 'objects', object.slice(0, 2), object.slice(2)));
  assert.throws(() => git(['cat-file', '-e', object]));
  assert.equal(fs.readFileSync(marker, 'utf8'), 'local transport invoked');
  fs.unlinkSync(marker);
  assert.throws(() => stageImmutableSource({ repo, releasesDir, commit, reserveBytes: 0 }));
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual(fs.readdirSync(releasesDir), []);
});

test('private/runtime case variants refuse before materialization', async t => {
  for (const name of ['.ENV.LOCAL', '.ENV.EXAMPLE', 'WALLETS.JSON', 'NODE_MODULES/dependency.js']) {
    await t.test(name, t => {
      const { repo, releasesDir, git } = fixture(t), commit = commitWithPath(git, name);
      assert.throws(() => stageImmutableSource({ repo, releasesDir, commit, reserveBytes: 0 }));
      assert.deepEqual(fs.readdirSync(releasesDir), []);
    });
  }
});

test('device and console basenames refuse from raw Git trees without opening their paths', t => {
  const { repo, releasesDir, git } = fixture(t);
  for (const name of ['CON', 'nul.txt', 'AUX.json', 'PRN', 'COM1', 'LPT1.log', 'CONIN$', 'CONOUT$.txt', 'COM\u00b9.txt', 'LPT\u00b2', 'CON .log']) {
    // mktree/commit-tree manipulate only Git objects. The fixture never creates
    // a Windows device path, even on a host that cannot check out that tree.
    const commit = commitWithPath(git, name);
    assert.throws(() => stageImmutableSource({ repo, releasesDir, commit, reserveBytes: 0 }));
    assert.deepEqual(fs.readdirSync(releasesDir), []);
  }
});

test('source/release root symlink ancestors refuse even if they point at a valid directory', t => {
  const { root, repo, releasesDir, commit } = fixture(t), alias = path.join(root, 'release-alias');
  fs.symlinkSync(releasesDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => stageImmutableSource({ repo, releasesDir: alias, commit, reserveBytes: 0 }));
  assert.deepEqual(fs.readdirSync(releasesDir), []);
});

test('refuses tracked private runtime material before creating a candidate', t => {
  const { repo, releasesDir, git } = fixture(t);
  for (const filename of ['.env.production', 'custody.key', 'funded.sqlite']) {
    fs.writeFileSync(path.join(repo, filename), 'synthetic forbidden runtime material');
    git(['add', filename]); git(['commit', '-qm', 'synthetic forbidden file']);
    assert.throws(() => stageImmutableSource({ repo, releasesDir, commit: git(['rev-parse', 'HEAD']), reserveBytes: 0 }));
  }
  assert.deepEqual(fs.readdirSync(releasesDir), []);
});

test('Git symlinks and submodule entries refuse rather than importing mutable external source', t => {
  const { repo, releasesDir, git } = fixture(t);
  const object = git(['hash-object', 'runtime.txt']);
  git(['update-index', '--add', '--cacheinfo', `120000,${object},external-link`]);
  git(['commit', '-qm', 'synthetic link']);
  assert.throws(() => stageImmutableSource({ repo, releasesDir, commit: git(['rev-parse', 'HEAD']), reserveBytes: 0 }));
  git(['update-index', '--force-remove', 'external-link']);
  git(['update-index', '--add', '--cacheinfo', `160000,${git(['rev-parse', 'HEAD'])},external-module`]);
  git(['commit', '-qm', 'synthetic gitlink']);
  assert.throws(() => stageImmutableSource({ repo, releasesDir, commit: git(['rev-parse', 'HEAD']), reserveBytes: 0 }));
});

test('keeps the exact non-runtime Showcase gitlink without copying/fetching its source', t => {
  const { repo, releasesDir, git, commit: pointer } = fixture(t);
  fs.writeFileSync(path.join(repo, '.gitmodules'), '[submodule "arc-primitives"]\n\tpath = arc-primitives\n\turl = https://github.com/tang-vu/keryx-arc-primitives.git\n');
  git(['add', '.gitmodules']); git(['update-index', '--add', '--cacheinfo', `160000,${pointer},arc-primitives`]);
  git(['commit', '-qm', 'synthetic public Showcase pointer']);
  const staged = stageImmutableSource({ repo, releasesDir, commit: git(['rev-parse', 'HEAD']), reserveBytes: 0 });
  const manifest = JSON.parse(fs.readFileSync(path.join(staged.candidate, 'source-manifest.json')));
  assert.deepEqual(manifest.nonRuntimeGitlinks, [{ path: 'arc-primitives', commit: pointer, materialization: 'empty-non-runtime-directory' }]);
  assert.deepEqual(fs.readdirSync(path.join(staged.source, 'arc-primitives')), []);
  addSyntheticArtifact(staged);
  assert.equal(inspectImmutableArtifact(staged).productionAdmitted, false);
  fs.writeFileSync(path.join(staged.source, 'arc-primitives', 'unreviewed-runtime.js'), 'not part of this cohort');
  assert.throws(() => recordImmutableArtifact(staged));
  assert.equal(fs.existsSync(path.join(staged.candidate, 'artifact-inspection.json')), false);
});

test('binds complete isolated source, dependencies, Next build ID and contained trace files', t => {
  const staged = fixture(t).stage(); addSyntheticArtifact(staged);
  const record = recordImmutableArtifact(staged);
  assert.equal(record.productionAdmitted, false);
  assert.equal(record.buildId, 'synthetic-no-spend-build');
  assert.equal(record.tracedFiles, 2);
  assert.equal(verifyImmutableArtifact({ ...staged, artifactInspectionSha256: record.artifactInspectionSha256 }).artifactDigest,
    record.artifactDigest);
  assert.throws(() => recordImmutableArtifact(staged)); // Retain the original inspection receipt.
});

test('fails verification after a built file changes even if source/build identity is unchanged', t => {
  const staged = fixture(t).stage(); addSyntheticArtifact(staged);
  const record = recordImmutableArtifact(staged);
  fs.writeFileSync(path.join(staged.source, 'node_modules', 'fixture', 'index.js'), 'changed dependency bytes\n');
  assert.throws(() => verifyImmutableArtifact({ ...staged, artifactInspectionSha256: record.artifactInspectionSha256 }));
});

test('source substitution, wrong manifest digest and untracked runtime environment refuse', t => {
  const staged = fixture(t).stage(); addSyntheticArtifact(staged);
  assert.throws(() => recordImmutableArtifact({ ...staged, sourceManifestSha256: 'a'.repeat(64) }));
  fs.writeFileSync(path.join(staged.source, '.env.local'), 'SYNTHETIC_KEY=forbidden');
  assert.throws(() => recordImmutableArtifact(staged));
  fs.unlinkSync(path.join(staged.source, '.env.local'));
  fs.chmodSync(path.join(staged.source, 'runtime.txt'), 0o600);
  fs.writeFileSync(path.join(staged.source, 'runtime.txt'), 'substituted source\n');
  assert.throws(() => recordImmutableArtifact(staged));
  assert.equal(fs.existsSync(path.join(staged.candidate, 'artifact-inspection.json')), false);
});

test('missing dependency and outside/dangling trace refuse without recording acceptance', t => {
  const staged = fixture(t).stage(); addSyntheticArtifact(staged);
  const tracePath = path.join(staged.source, '.next', 'next-server.js.nft.json');
  for (const name of ['../node_modules/missing.js', '../../source-manifest.json', '/etc/passwd']) {
    fs.writeFileSync(tracePath, JSON.stringify({ version: 1, files: [name] }));
    assert.throws(() => recordImmutableArtifact(staged));
  }
  fs.unlinkSync(tracePath); assert.throws(() => recordImmutableArtifact(staged));
  assert.equal(fs.existsSync(path.join(staged.candidate, 'artifact-inspection.json')), false);
});

test('hardlinked dependencies refuse shared mutable storage', t => {
  const staged = fixture(t).stage(); addSyntheticArtifact(staged);
  fs.linkSync(path.join(staged.source, 'node_modules', 'fixture', 'index.js'), path.join(staged.candidate, 'shared-dependency.js'));
  assert.throws(() => recordImmutableArtifact(staged));
});

test('internal npm executable links are contained; external directory symlinks refuse', t => {
  const staged = fixture(t).stage(); addSyntheticArtifact(staged);
  const dependency = path.join(staged.source, 'node_modules');
  fs.mkdirSync(path.join(dependency, '.bin'));
  try { fs.symlinkSync('../fixture/index.js', path.join(dependency, '.bin', 'fixture'), 'file'); }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows user cannot create file symlinks; Linux CI checks containment.'); return; }
    throw error;
  }
  assert.equal(recordImmutableArtifact(staged).productionAdmitted, false);
  fs.symlinkSync(staged.candidate, path.join(dependency, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => recordImmutableArtifact(staged));
});

test('inspection receipt cannot change or be substituted under a retained digest', t => {
  const staged = fixture(t).stage(); addSyntheticArtifact(staged);
  const record = recordImmutableArtifact(staged), file = path.join(staged.candidate, 'artifact-inspection.json');
  const receipt = JSON.parse(fs.readFileSync(file)); receipt.productionAdmitted = true;
  fs.writeFileSync(file, JSON.stringify(receipt) + '\n');
  const digest = hash(fs.readFileSync(file));
  assert.throws(() => verifyImmutableArtifact({ ...staged, artifactInspectionSha256: record.artifactInspectionSha256 }));
  assert.throws(() => verifyImmutableArtifact({ ...staged, artifactInspectionSha256: digest }));
});

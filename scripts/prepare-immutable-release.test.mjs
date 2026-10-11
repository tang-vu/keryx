import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { preparationEnvironment, runPreparationChecks, copyPreparationDependencies, materializePreparationBuildAliases } from './prepare-immutable-release.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-preparation-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir()); assert.match(path.basename(root), /^keryx-preparation-test-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const source = path.join(root, 'source'), dependencies = path.join(root, 'dependencies');
  fs.mkdirSync(source); fs.mkdirSync(dependencies);
  const npmCli = path.join(root, 'npm-cli.cjs'); fs.writeFileSync(npmCli, 'synthetic test seam');
  return { root, source, dependencies, npmCli,
    staged: { candidate: root, source, commit: 'a'.repeat(40) }, scratch: root };
}

test('fresh builder environment cannot inherit funded storage, keys, providers or Node injection', () => {
  const env = preparationEnvironment({ commit: 'a'.repeat(40), scratch: path.resolve(os.tmpdir()), inherited: {
    PATH: 'toolchain', OPENAI_API_KEY: 'synthetic', FUNDER_PRIVATE_KEY: 'synthetic',
    KERYX_STORAGE_MANIFEST: '/funded.json', KERYX_SQLITE_PATH: '/funded.sqlite',
    SUPABASE_URL: 'https://shared.invalid', NODE_OPTIONS: '--import=/unsafe.mjs',
    NEXT_PUBLIC_KERYX_NETWORK: 'arc', WSLENV: 'OPENAI_API_KEY',
  } });
  assert.equal(env.KERYX_NETWORK, 'arcTestnet'); assert.equal(env.KERYX_FORCE_OFFLINE, '1');
  assert.equal(env.SUPABASE_URL, ''); assert.equal(env.NEXT_PUBLIC_KERYX_NETWORK, 'arcTestnet');
  for (const name of ['OPENAI_API_KEY', 'FUNDER_PRIVATE_KEY', 'KERYX_STORAGE_MANIFEST', 'NODE_OPTIONS', 'WSLENV'])
    assert.equal(Object.hasOwn(env, name), false);
  assert.equal(Object.hasOwn(env, 'KERYX_SQLITE_PATH'), false);
});

test('failed typecheck/test/build retains the real failure and cannot reach later checks', t => {
  for (const failed of ['typecheck', 'test', 'build']) {
    const f = fixture(t), commands = [];
    // Separate receipt directories for each independent scenario.
    const candidate = path.join(f.root, failed); fs.mkdirSync(candidate); f.staged.candidate = candidate;
    const run = (_command, args, options) => {
      assert.equal(options.env.KERYX_FORCE_OFFLINE, '1'); assert.equal(options.cwd, f.source);
      const name = args.at(-1); commands.push(name);
      assert.equal(options.env.NODE_ENV, name === 'test' ? 'test' : 'production');
      return { status: name === failed ? 7 : 0, stdout: name === '--version' ? '11.19.0\n' : 'actual synthetic command output', stderr: '' };
    };
    assert.throws(() => runPreparationChecks({ ...f, run }));
    const expected = ['--version', 'typecheck', 'test', 'build'];
    assert.deepEqual(commands, expected.slice(0, expected.indexOf(failed) + 1));
    const receiptName = failed === 'test' ? 'tests' : failed;
    assert.equal(JSON.parse(fs.readFileSync(path.join(candidate, `${receiptName}.json`))).exitCode, 7);
    assert.equal(fs.existsSync(path.join(candidate, 'artifact-inspection.json')), false);
  }
});

test('wrong npm, timeout or terminated command cannot become successful preparation', t => {
  for (const result of [{ status: 0, stdout: '11.18.0\n' },
    { status: null, signal: 'SIGTERM', stdout: '11.19.0\n' },
    { status: null, error: { code: 'ETIMEDOUT' }, stdout: '11.19.0\n' }]) {
    const f = fixture(t); let calls = 0;
    assert.throws(() => runPreparationChecks({ ...f, run: () => { calls++; return result; } }));
    assert.equal(calls, 1);
  }
});

test('dependency copy has separate file identity and refuses substituted installation metadata', t => {
  const f = fixture(t), entry = { version: '1.0.0', resolved: 'https://registry.invalid/fixture.tgz', integrity: 'sha512-synthetic' };
  const packages = { 'node_modules/fixture': entry };
  fs.writeFileSync(path.join(f.source, 'package.json'), JSON.stringify({ dependencies: { fixture: '1.0.0' } }));
  fs.writeFileSync(path.join(f.source, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  fs.mkdirSync(path.join(f.dependencies, 'fixture'));
  const original = path.join(f.dependencies, 'fixture', 'index.js'); fs.writeFileSync(original, 'synthetic original');
  if (process.platform !== 'win32') fs.chmodSync(original, 0o777);
  const installed = path.join(f.dependencies, '.package-lock.json');
  fs.writeFileSync(installed, JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/fixture': { ...entry, integrity: 'changed' } } }));
  assert.throws(() => copyPreparationDependencies(f));
  assert.equal(fs.existsSync(path.join(f.source, 'node_modules')), false);
  fs.writeFileSync(installed, JSON.stringify({ lockfileVersion: 3, packages }));
  copyPreparationDependencies(f);
  const copied = path.join(f.source, 'node_modules', 'fixture', 'index.js');
  assert.equal(fs.lstatSync(copied).nlink, 1);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(copied).mode & 0o777, 0o755);
    assert.equal(fs.statSync(original).mode & 0o777, 0o777);
  }
  fs.writeFileSync(copied, 'candidate only');
  assert.equal(fs.readFileSync(original, 'utf8'), 'synthetic original');
  assert.throws(() => copyPreparationDependencies(f));
});
test('dependency directory links cannot copy external storage or ENV bytes', t => {
  const f = fixture(t), entry = { version: '1.0.0' }, packages = { 'node_modules/fixture': entry };
  fs.writeFileSync(path.join(f.source, 'package.json'), JSON.stringify({ dependencies: { fixture: '1.0.0' } }));
  fs.writeFileSync(path.join(f.source, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  fs.writeFileSync(path.join(f.dependencies, '.package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  const outside = path.join(f.root, 'external-runtime'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, '.env.local'), 'SYNTHETIC=must-not-copy');
  fs.symlinkSync(outside, path.join(f.dependencies, 'fixture'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => copyPreparationDependencies(f));
  assert.equal(fs.existsSync(path.join(f.source, 'node_modules')), false);
});

test('Turbopack aliases copy only independent candidate dependency bytes and retain build inputs', t => {
  const f = fixture(t);
  const original = path.join(f.dependencies, 'fixture'); fs.mkdirSync(original);
  const copied = path.join(f.source, 'node_modules', 'fixture'); fs.mkdirSync(copied, { recursive: true });
  fs.writeFileSync(path.join(original, 'index.js'), 'mutable build input');
  fs.writeFileSync(path.join(copied, 'index.js'), 'independent accepted bytes');
  const aliases = path.join(f.source, '.next', 'node_modules'); fs.mkdirSync(aliases, { recursive: true });
  const alias = path.join(aliases, 'fixture-hash');
  fs.symlinkSync(original, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const result = materializePreparationBuildAliases(f);
  assert.deepEqual(result.aliases, [{ path: 'node_modules/fixture-hash', dependency: 'fixture' }]);
  assert.equal(fs.lstatSync(alias).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(alias, 'index.js'), 'utf8'), 'independent accepted bytes');
  assert.equal(fs.lstatSync(path.join(alias, 'index.js')).nlink, 1);
  fs.writeFileSync(path.join(alias, 'index.js'), 'alias only');
  assert.equal(fs.readFileSync(path.join(copied, 'index.js'), 'utf8'), 'independent accepted bytes');
  assert.equal(fs.readFileSync(path.join(original, 'index.js'), 'utf8'), 'mutable build input');
});

test('build aliases cannot import external runtime paths and headroom failure preserves links', t => {
  const f = fixture(t), dependencies = path.join(f.source, 'node_modules'); fs.mkdirSync(dependencies);
  const aliases = path.join(f.source, '.next', 'node_modules'); fs.mkdirSync(aliases, { recursive: true });
  const outside = path.join(f.root, 'runtime'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, '.env.local'), 'synthetic forbidden input');
  const alias = path.join(aliases, 'fixture-hash');
  fs.symlinkSync(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => materializePreparationBuildAliases(f));
  assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
  fs.unlinkSync(alias);
  const copied = path.join(dependencies, 'fixture'); fs.mkdirSync(copied);
  fs.writeFileSync(path.join(copied, 'index.js'), 'independent accepted bytes');
  fs.symlinkSync(copied, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const original = fs.statfsSync;
  try {
    fs.statfsSync = () => ({ bavail: 0n, bsize: 4096n });
    assert.throws(() => materializePreparationBuildAliases(f));
  } finally { fs.statfsSync = original; }
  assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { preparationEnvironment, runPreparationChecks, copyPreparationDependencies, materializePreparationBuildAliases } from './prepare-immutable-release.mjs';

const publicCircle = Object.freeze({
  NEXT_PUBLIC_CIRCLE_APP_ID: '00000000-0000-4000-8000-000000000001',
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: '123456789-synthetic.apps.googleusercontent.com',
});
const publicRegistry = Object.freeze({
  KERYX_REGISTRY_ADDRESS: `0x${'1'.repeat(40)}`,
  NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: `0x${'1'.repeat(40)}`,
  KERYX_REGISTRY_READ_ADDRESS: `0x${'2'.repeat(40)}`,
  NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS: `0x${'2'.repeat(40)}`,
});
const mainnetPublic = { ...publicCircle, ...publicRegistry };

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
    NEXT_PUBLIC_KERYX_NETWORK: 'arc', WSLENV: 'OPENAI_API_KEY', ...mainnetPublic,
  } });
  assert.equal(env.KERYX_NETWORK, 'arcTestnet'); assert.equal(env.KERYX_FORCE_OFFLINE, '1');
  assert.equal(env.SUPABASE_URL, ''); assert.equal(env.NEXT_PUBLIC_KERYX_NETWORK, 'arcTestnet');
  for (const name of ['OPENAI_API_KEY', 'FUNDER_PRIVATE_KEY', 'KERYX_STORAGE_MANIFEST', 'NODE_OPTIONS', 'WSLENV'])
    assert.equal(Object.hasOwn(env, name), false);
  assert.equal(Object.hasOwn(env, 'KERYX_SQLITE_PATH'), false);
  for (const key of Object.keys(mainnetPublic)) assert.equal(Object.hasOwn(env, key), false);
});

test('explicit mainnet build uses strict mainnet config with only public constants', () => {
  const options = { commit: 'a'.repeat(40), scratch: path.resolve(os.tmpdir()), inherited: {
    PATH: 'toolchain', OPENAI_API_KEY: 'synthetic', KERYX_STORAGE_MANIFEST: '/funded.json',
    KERYX_SQLITE_PATH: '/funded.sqlite', FUNDER_PRIVATE_KEY: 'synthetic', NODE_OPTIONS: '--import=/unsafe', ...mainnetPublic,
  } };
  const previous = preparationEnvironment(options), mainnet = preparationEnvironment({ ...options, publicNetwork: 'arc' });
  assert.deepEqual(mainnet, { ...previous, KERYX_NETWORK: 'arc', NEXT_PUBLIC_KERYX_NETWORK: 'arc', KERYX_FORCE_OFFLINE: '0', ...mainnetPublic });
  for (const publicNetwork of ['mainnet', 'arc;echo', '', null, ['arc']])
    assert.throws(() => preparationEnvironment({ ...options, publicNetwork }));
});

test('mainnet build requires matching nonzero write and read registry twins before commands', t => {
  for (const key of Object.keys(publicRegistry)) for (const value of [undefined, '', `0x${'0'.repeat(40)}`, `0x${'3'.repeat(40)}`, `${publicRegistry[key]}\n`, 'not-an-address']) {
    const f = fixture(t);
    assert.throws(() => runPreparationChecks({ ...f, mainnetPublicBuild: true,
      inherited: { ...mainnetPublic, [key]: value }, run: () => assert.fail('invalid registry executed a command') }));
    assert.equal(fs.existsSync(path.join(f.root, 'npm-version.json')), false);
  }
});

test('mainnet public build refuses missing or malformed connector IDs before executing any command', t => {
  for (const inherited of [{}, { NEXT_PUBLIC_CIRCLE_APP_ID: publicCircle.NEXT_PUBLIC_CIRCLE_APP_ID },
    { NEXT_PUBLIC_GOOGLE_CLIENT_ID: publicCircle.NEXT_PUBLIC_GOOGLE_CLIENT_ID },
    { ...publicCircle, NEXT_PUBLIC_CIRCLE_APP_ID: 'synthetic-private-api-key' },
    { ...publicCircle, NEXT_PUBLIC_CIRCLE_APP_ID: `${publicCircle.NEXT_PUBLIC_CIRCLE_APP_ID}\n` },
    { ...publicCircle, NEXT_PUBLIC_CIRCLE_APP_ID: `${publicCircle.NEXT_PUBLIC_CIRCLE_APP_ID}\nUNSAFE=1` },
    { ...publicCircle, NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'synthetic-secret-or-wrong-domain' },
    { ...publicCircle, NEXT_PUBLIC_GOOGLE_CLIENT_ID: `${publicCircle.NEXT_PUBLIC_GOOGLE_CLIENT_ID}\n` },
    { ...publicCircle, NEXT_PUBLIC_GOOGLE_CLIENT_ID: `${publicCircle.NEXT_PUBLIC_GOOGLE_CLIENT_ID}\nUNSAFE=1` }]) {
    const f = fixture(t);
    assert.throws(() => runPreparationChecks({ ...f, inherited: { ...publicRegistry, ...inherited }, mainnetPublicBuild: true,
      run: () => assert.fail('invalid public config executed a command') }), /Release preparation refused/);
    assert.equal(fs.existsSync(path.join(f.root, 'npm-version.json')), false);
    assert.equal(fs.existsSync(path.join(f.root, 'preparation.json')), false);
  }
});

test('mainnet preparation changes only the public build profile; tests stay testnet and failures retain refusal', t => {
  const f = fixture(t), calls = [];
  const checks = runPreparationChecks({ ...f, mainnetPublicBuild: true, inherited: mainnetPublic, run(_command, args, options) {
    const name = args.at(-1); calls.push({ name, env: options.env });
    assert.equal(options.cwd, f.source);
    assert.equal(options.env.KERYX_FORCE_OFFLINE, name === 'build' ? '0' : '1');
    assert.equal(options.env.KERYX_NETWORK, name === 'build' ? 'arc' : 'arcTestnet');
    assert.equal(options.env.NEXT_PUBLIC_KERYX_NETWORK, name === 'build' ? 'arc' : 'arcTestnet');
    assert.equal(options.env.NODE_ENV, name === 'test' ? 'test' : 'production');
    assert.equal(options.env.SUPABASE_URL, '');
    for (const [key, value] of Object.entries(mainnetPublic))
      assert.equal(options.env[key], name === 'build' ? value : undefined);
    for (const key of ['KERYX_STORAGE_MANIFEST', 'KERYX_SQLITE_PATH', 'FUNDER_PRIVATE_KEY', 'OPENAI_API_KEY'])
      assert.equal(Object.hasOwn(options.env, key), false);
    return { status: 0, stdout: name === '--version' ? '11.19.0\n' : 'synthetic checked command output', stderr: '' };
  } });
  assert.deepEqual(calls.map(x => x.name), ['--version', 'typecheck', 'test', 'build']);
  const publicConfigSha256 = createHash('sha256').update(JSON.stringify(publicCircle) + '\n').digest('hex');
  assert.deepEqual(checks.publicBuildSettings, { network: 'arc', forceOffline: false, circleGooglePublicConfigSha256: publicConfigSha256 });
  assert.deepEqual(checks.buildRegistrySettings, { writeAddress: publicRegistry.KERYX_REGISTRY_ADDRESS, readAddress: publicRegistry.KERYX_REGISTRY_READ_ADDRESS });
  assert.equal(JSON.stringify(checks).includes(publicCircle.NEXT_PUBLIC_CIRCLE_APP_ID), false);
  assert.equal(JSON.stringify(checks).includes(publicCircle.NEXT_PUBLIC_GOOGLE_CLIENT_ID), false);
  assert.equal(checks.results.length, 3);
  for (const mainnetPublicBuild of ['true', 1, null])
    assert.throws(() => runPreparationChecks({ ...fixture(t), mainnetPublicBuild,
      run: () => assert.fail('invalid profile executed a command') }));
  const failed = fixture(t), seen = [];
  assert.throws(() => runPreparationChecks({ ...failed, mainnetPublicBuild: true, inherited: mainnetPublic, run(_command, args) {
    const name = args.at(-1); seen.push(name);
    return { status: name === 'test' ? 9 : 0, stdout: name === '--version' ? '11.19.0\n' : '', stderr: '' };
  } }));
  assert.deepEqual(seen, ['--version', 'typecheck', 'test']);
  assert.equal(fs.existsSync(path.join(failed.root, 'build.json')), false);
  assert.equal(fs.existsSync(path.join(failed.root, 'preparation.json')), false);
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

test('copied npm executables resolve sibling modules inside the independent candidate', t => {
  for (const absolute of [false, true]) {
  const f = fixture(t), packages = { 'node_modules/fixture': { version: '1.0.0' } };
  fs.writeFileSync(path.join(f.source, 'package.json'), JSON.stringify({ dependencies: { fixture: '1.0.0' } }));
  fs.writeFileSync(path.join(f.source, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  fs.writeFileSync(path.join(f.dependencies, '.package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  fs.mkdirSync(path.join(f.dependencies, '.bin')); fs.mkdirSync(path.join(f.dependencies, 'fixture'));
  const original = path.join(f.dependencies, 'fixture', 'cli.cjs');
  fs.writeFileSync(original, "process.stdout.write(require('./lib/result.cjs'));\n");
  fs.mkdirSync(path.join(f.dependencies, 'fixture', 'lib'));
  const result = path.join(f.dependencies, 'fixture', 'lib', 'result.cjs');
  fs.writeFileSync(result, "module.exports='independent executable';\n");
  const link = path.join(f.dependencies, '.bin', 'fixture');
  try { fs.symlinkSync(absolute ? original : '../fixture/cli.cjs', link, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Unprivileged Windows file links unavailable; Linux CI verifies the actual copy.'); return; }
    throw error;
  }
  const receipt = copyPreparationDependencies(f);
  const copied = path.join(f.source, 'node_modules', '.bin', 'fixture');
  assert.equal(execFileSync(process.execPath, [copied], { encoding: 'utf8' }), 'independent executable');
  assert.equal(receipt.preservedFileLinks, 1);
  assert.equal(fs.lstatSync(copied).isSymbolicLink(), true);
  assert.equal(path.isAbsolute(fs.readlinkSync(copied)), false);
  assert.equal(fs.realpathSync(copied), path.join(f.source, 'node_modules', 'fixture', 'cli.cjs'));
  // Changing the installation cannot affect execution from the copied package.
  fs.writeFileSync(result, "module.exports='changed input';\n");
  assert.equal(execFileSync(process.execPath, [copied], { encoding: 'utf8' }), 'independent executable');
  fs.writeFileSync(copied, 'candidate only');
  assert.equal(fs.readFileSync(original, 'utf8'), "process.stdout.write(require('./lib/result.cjs'));\n");
  assert.equal(fs.readFileSync(path.join(f.source, 'node_modules', 'fixture', 'cli.cjs'), 'utf8'), 'candidate only');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  }
});

test('npm file links cannot import external runtime bytes', t => {
  const f = fixture(t), packages = { 'node_modules/fixture': { version: '1.0.0' } };
  fs.writeFileSync(path.join(f.source, 'package.json'), JSON.stringify({ dependencies: { fixture: '1.0.0' } }));
  fs.writeFileSync(path.join(f.source, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  fs.writeFileSync(path.join(f.dependencies, '.package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  fs.mkdirSync(path.join(f.dependencies, 'fixture'));
  const outside = path.join(f.root, 'external-runtime.cjs'); fs.writeFileSync(outside, 'synthetic must-not-copy');
  try { fs.symlinkSync(outside, path.join(f.dependencies, 'fixture', 'cli.cjs'), 'file'); }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Linux CI verifies file-link containment.'); return; }
    throw error;
  }
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

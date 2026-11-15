import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ exec: vi.fn(), realpath: vi.fn(async () => { throw Error('synthetic-host-boundary'); }) }));
vi.mock('node:child_process', () => ({ execFile: boundary.exec }));
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, promises: { ...actual.promises, realpath: boundary.realpath } };
});
import { SERVER1_PG17, assertServer1PackageIndex, inspectServer1PreparedPostgres, parseServer1Pg17ApprovedPin, parseServer1Pg17Arguments, prepareServer1Postgres17 } from './prepare-server1-pg17.mts';

const sha = 'a'.repeat(64);
function candidate() {
  return {
    format: 'keryx-server1-postgres17-approved-pin-v1', serverVersionNum: 170012,
    installedPackagesSha256: sha,
    configHashes: { postgresql: sha, hba: sha, ident: sha, service: sha }, runtimeHbaTemplateSha256: sha,
    repositories: [{ kind: 'pgdg', inRelease: 'pgdg.InRelease', keyringSha256: sha, indexes: [{ file: 'pgdg.Packages', releasePath: 'main/binary-amd64/Packages', sha256: sha, size: 512 }] }],
    packages: ['postgresql-17', 'postgresql-client-17', 'postgresql-common', 'postgresql-client-common', 'libpq5'].map(name => ({ name, version: '17.12-1.pgdg24.04+1', file: `${name}.deb`, sha256: sha, size: 1000, repository: 0, index: 0 })),
  };
}
function parse(value: unknown) { return parseServer1Pg17ApprovedPin(Buffer.from(JSON.stringify(value))); }
function indexWire(overrides: Record<string, string> = {}) {
  return Object.entries({ Package: 'postgresql-17', Version: '17.12-1.pgdg24.04+1', Architecture: 'amd64', Filename: 'pool/main/p/postgresql-17/postgresql-17.deb', Size: '1000', SHA256: sha, ...overrides }).map(([key, value]) => `${key}: ${value}`).join('\n') + '\n';
}
const root = new URL('../../ops/keryx-postgres/', import.meta.url);
const literal = (name: string) => readFileSync(fileURLToPath(new URL(name, root)), 'utf8').replace(/\r\n/g, '\n');

describe('finite preparation input, no executable/capability escape', () => {
  it('imports without executing a command', () => { expect(boundary.exec).not.toHaveBeenCalled(); expect(boundary.realpath).not.toHaveBeenCalled(); });
  it('defaults to readonly preflight and requires an exact explicit apply pin', () => {
    expect(parseServer1Pg17Arguments([])).toEqual({ mode: 'preflight' });
    expect(parseServer1Pg17Arguments(['--preflight'])).toEqual({ mode: 'preflight' });
    expect(parseServer1Pg17Arguments(['--apply', '--pin-sha256', sha])).toEqual({ mode: 'apply', approvedPinSha256: sha });
    for (const args of [['--apply'], ['--apply', '--pin-sha256', 'latest'], ['--preflight', '--apply'], ['--apply', '--pin-sha256', sha, '--host', 'elsewhere'], ['--apply', '/tmp/pin.json', '--pin-sha256', sha]]) expect(() => parseServer1Pg17Arguments(args)).toThrow('arguments');
  });
  it('rejects foreign platforms/host boundaries before any command or mutation', async () => {
    await expect(inspectServer1PreparedPostgres()).rejects.toThrow(/operator_platform|synthetic-host-boundary/);
    // No options flag can bypass actual observation. Invalid keys refuse before
    // any filesystem lookup; these DTOs never become installer authority.
    await expect(prepareServer1Postgres17({ mode: 'apply', approvedPinSha256: sha, verified: true } as never)).rejects.toThrow('options');
    expect(boundary.exec).not.toHaveBeenCalled();
  });
  it('accepts and deeply freezes only the finite reviewed pin schema', () => {
    const pin = parse(candidate());
    expect(pin.serverVersionNum).toBe(170012);
    expect(Object.isFrozen(pin)).toBe(true);
    expect(Object.isFrozen(pin.packages[0])).toBe(true);
    expect(Object.isFrozen(pin.repositories[0].indexes)).toBe(true);
  });
  it.each([
    ['self-attested signature', (p: ReturnType<typeof candidate>) => Object.assign(p, { signatureVerified: true })],
    ['foreign version', (p: ReturnType<typeof candidate>) => { p.serverVersionNum = 180000; }],
    ['unknown config', (p: ReturnType<typeof candidate>) => Object.assign(p.configHashes, { sql: sha })],
    ['non-hash inventory', (p: ReturnType<typeof candidate>) => { p.installedPackagesSha256 = 'latest'; }],
    ['repository key path', (p: ReturnType<typeof candidate>) => Object.assign(p.repositories[0], { keyring: '/tmp/key' })],
    ['foreign distro', (p: ReturnType<typeof candidate>) => { p.repositories[0].indexes[0].releasePath = 'other/binary-amd64/Packages'; }],
    ['index traversal', (p: ReturnType<typeof candidate>) => { p.repositories[0].indexes[0].file = '../Packages'; }],
    ['package traversal', (p: ReturnType<typeof candidate>) => { p.packages[0].file = '../arbitrary.deb'; }],
    ['shell command', (p: ReturnType<typeof candidate>) => { p.packages[0].name = 'postgresql-17;touch'; }],
    ['unrelated signed service', (p: ReturnType<typeof candidate>) => { p.packages.push({ ...p.packages[0], name: 'nginx', file: 'nginx.deb' }); }],
    ['duplicate package', (p: ReturnType<typeof candidate>) => { p.packages[1] = { ...p.packages[0] }; }],
    ['missing required package', (p: ReturnType<typeof candidate>) => { p.packages.pop(); }],
    ['newer major/minor', (p: ReturnType<typeof candidate>) => { p.packages[0].version = '17.13-1.pgdg24.04+1'; }],
    ['unsigned index selector', (p: ReturnType<typeof candidate>) => { p.packages[0].repository = 2; }],
    ['oversized package', (p: ReturnType<typeof candidate>) => { p.packages[0].size = 256 * 1024 * 1024 + 1; }],
    ['oversized index', (p: ReturnType<typeof candidate>) => { p.repositories[0].indexes[0].size = 32 * 1024 * 1024 + 1; }],
  ])('refuses %s', (_name, change) => { const p = candidate(); change(p); expect(() => parse(p)).toThrow('server1_pg17_preparation_refused'); });
  it('refuses a whole bundle overflow without raising per-package bounds', () => {
    const p = candidate(); p.packages.forEach(v => { v.size = 256 * 1024 * 1024; });
    expect(() => parse(p)).toThrow('whole_package_bundle_bound');
    expect(() => parseServer1Pg17ApprovedPin(Buffer.alloc(128 * 1024 + 1))).toThrow('pin_bound');
  });
});

describe('exact package binding to signed Packages metadata', () => {
  const pin = parse(candidate()).packages[0];
  it('selects the exact version/architecture/filename/hash/size tuple', () => {
    expect(() => assertServer1PackageIndex(indexWire(), pin)).not.toThrow();
    expect(() => assertServer1PackageIndex(indexWire({ Architecture: 'all' }), pin)).not.toThrow();
    expect(() => assertServer1PackageIndex(indexWire() + '\n' + indexWire({ Version: '17.11-1' }), pin)).not.toThrow();
  });
  it.each([
    { SHA256: 'b'.repeat(64) }, { Size: '999' }, { Architecture: 'arm64' },
    { Filename: 'pool/malicious.deb' }, { Version: '17.13-1.pgdg24.04+1' },
  ])('refuses drift: %j', values => { expect(() => assertServer1PackageIndex(indexWire(values), pin)).toThrow('server1_pg17_preparation_refused'); });
  it('refuses duplicate matching stanzas and duplicate exact fields', () => {
    expect(() => assertServer1PackageIndex(indexWire() + '\n' + indexWire(), pin)).toThrow('ambiguous');
    expect(() => assertServer1PackageIndex(indexWire() + `SHA256: ${sha}\n`, pin)).toThrow('duplicate_field');
  });
});

describe('preparation service and initial-vs-runtime HBA boundaries', () => {
  const hba = literal('server1-pg17.pg_hba.conf');
  const finalHba = literal('server1-pg17.runtime.pg_hba.conf');
  it('rejects both finite app roles and both databases before any broad rule', () => {
    const rows = hba.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(/\s+/));
    for (const database of ['keryx_mainnet', 'keryx_source']) for (const role of ['keryx_app', 'keryx_reader']) {
      const selected = rows.find(r => r[0] === 'local' && (r[1] === 'all' || r[1].split(',').includes(database)) && (r[2] === 'all' || r[2].split(',').includes(role)));
      expect(selected?.[3]).toBe('reject');
    }
    expect(hba).not.toContain('scram-sha-256');
    expect(hba).not.toMatch(/\btrust\s*$/m);
    expect(finalHba).toContain('STAGED TEMPLATE ONLY');
    expect(finalHba).toContain('local keryx_mainnet keryx_app scram-sha-256');
    expect(SERVER1_PG17.runtimeHbaTemplate).not.toBe(`${SERVER1_PG17.configDirectory}/pg_hba.conf`);
  });
  it('permits only fixed OS root/postgres mapping to SQL postgres', () => {
    expect(hba).toContain('local all postgres peer map=keryx_root_admin');
    const ident = literal('server1-pg17.pg_ident.conf').split('\n').filter(line => line && !line.startsWith('#'));
    expect(ident).toEqual(['keryx_root_admin root postgres', 'keryx_root_admin postgres postgres']);
  });
  it('uses private Unix sockets and synchronous durable settings', () => {
    const conf = literal('server1-pg17.conf');
    for (const setting of ["listen_addresses = ''", "unix_socket_group = 'root'", 'unix_socket_permissions = 0770', 'fsync = on', 'synchronous_commit = on', 'full_page_writes = on']) expect(conf).toContain(setting);
    expect(conf).not.toContain('include');
  });
  it('scopes direct postmaster/root socket access and bounded recovery to its own service', () => {
    const service = literal('server1-pg17.service.conf');
    for (const line of ['User=postgres', 'Group=root', 'RuntimeDirectoryMode=0750', 'MemoryMax=1073741824', 'MemorySwapMax=0', 'CPUQuota=75%', 'TasksMax=64', 'NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'RestrictAddressFamilies=AF_UNIX', 'SendSIGKILL=no']) expect(service).toContain(line);
    expect(service).not.toMatch(/PM2|keryx-public|ExecStartPre|pg_ctlcluster/);
    expect(service).toContain('ExecStart=/usr/lib/postgresql/17/bin/postgres -D /var/lib/postgresql/17/keryx');
    expect(SERVER1_PG17.serviceDropIn).toBe('/etc/systemd/system/postgresql@17-keryx.service.d/20-keryx-preparation.conf');
  });
});

describe('actual CJS import and zero-argument inspector refusal', () => {
  const source = fileURLToPath(new URL('./prepare-server1-pg17.mts', import.meta.url));
  const builtin = createRequire(import.meta.url);
  let cjs: string | undefined;
  function load(platform: 'win32' | 'linux') {
    // The operator children compile this same module as CJS. Transform only in
    // memory: no bundle/artifact or real host/private control is created/read.
    cjs ??= transformSync(readFileSync(source, 'utf8'), { loader: 'ts', format: 'cjs', platform: 'node', target: 'es2017', logLevel: 'silent' }).code;
    const commands = vi.fn(() => { throw Error('CJS test forbids commands'); });
    const paths: string[] = [];
    const os = Buffer.from('ID=ubuntu\nVERSION_ID="24.04"\n');
    const close = vi.fn(async () => undefined);
    const readonlyFs = {
      realpath: vi.fn(async (path: string) => { paths.push(path); if (path !== '/etc/os-release') throw Error('CJS test forbids host/private access'); return path; }),
      open: vi.fn(async (path: string, flags: number) => {
        paths.push(path);
        expect(path).toBe('/etc/os-release');
        // O_RDONLY is zero; no create/truncate/append/write access is allowed.
        expect(flags & (0o1 | 0o2 | 0o100 | 0o1000 | 0o2000)).toBe(0);
        return { stat: async () => ({ isFile: () => true, nlink: 1, uid: 0, mode: 0o100644, size: os.length, mtimeMs: 1, ctimeMs: 1 }), readFile: async () => os, close };
      }),
      readFile: vi.fn(async (path: string) => { paths.push(path); if (path !== '/proc/sys/kernel/osrelease') throw Error('CJS test forbids host/private access'); return 'isolated-non-WSL-Linux\n'; }),
    };
    const isolatedProcess = {
      platform, arch: 'x64', getuid: () => 0, getgid: () => 0, versions: { node: '24.22.1' },
      // Even a matching entry name cannot turn a CJS import into CLI invocation.
      argv: ['node', source], stdout: { write: vi.fn() }, stderr: { write: vi.fn() }, exitCode: undefined,
    };
    const module = { exports: {} as { inspectServer1PreparedPostgres: typeof inspectServer1PreparedPostgres } };
    const requires = new Map<string, unknown>([
      ['node:crypto', builtin('node:crypto')], ['node:path', builtin('node:path')], ['node:url', builtin('node:url')],
      ['node:child_process', { execFile: commands }], ['node:fs', { constants: builtin('node:fs').constants, promises: readonlyFs }],
    ]);
    new Script(cjs, { filename: 'server1-inspector-import.test.cjs' }).runInNewContext({
      module, exports: module.exports, Buffer, process: isolatedProcess,
      require: (name: string) => { if (!requires.has(name)) throw Error('CJS test refuses unknown module'); return requires.get(name); },
    });
    expect(commands).not.toHaveBeenCalled();
    expect(paths).toEqual([]);
    expect(isolatedProcess.stdout.write).not.toHaveBeenCalled();
    expect(isolatedProcess.stderr.write).not.toHaveBeenCalled();
    expect(isolatedProcess.exitCode).toBeUndefined();
    return { module, paths, commands, readonlyFs, close };
  }
  it('imports CJS without invoking CLI, then refuses Windows before any I/O', async () => {
    const loaded = load('win32');
    await expect(loaded.module.exports.inspectServer1PreparedPostgres()).rejects.toThrow('operator_platform');
    expect(loaded.paths).toEqual([]);
    expect(loaded.commands).not.toHaveBeenCalled();
  });
  it('refuses an isolated Linux OS observation using readonly access only', async () => {
    const loaded = load('linux');
    await expect(loaded.module.exports.inspectServer1PreparedPostgres()).rejects.toThrow('server1_os');
    expect(loaded.paths).toEqual(['/etc/os-release', '/etc/os-release', '/etc/os-release', '/proc/sys/kernel/osrelease']);
    expect(loaded.close).toHaveBeenCalledOnce();
    expect(loaded.commands).not.toHaveBeenCalled();
  });
});

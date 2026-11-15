import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Persistent PG-only preparation. This module never enrolls or activates storage.
 * No executable/SQL/path callback is accepted. Imports perform no I/O or CLI work.
 * The inspector returns observations, not a reusable admission capability.
 */
export const SERVER1_PG17 = Object.freeze({
  cluster: '17/keryx', service: 'postgresql@17-keryx.service',
  socketDirectory: '/run/postgresql-keryx', port: 5432, serverVersionNum: 170012,
  dataDirectory: '/var/lib/postgresql/17/keryx', configDirectory: '/etc/postgresql/17/keryx',
  serviceDropIn: '/etc/systemd/system/postgresql@17-keryx.service.d/20-keryx-preparation.conf',
  receipt: '/root/keryx-migration/postgres17-server1-preparation.json',
  journal: '/root/keryx-migration/postgres17-server1-preparation.in-progress.json',
  pin: '/root/keryx-migration/postgres17-server1-approved-pin.json',
  bundle: '/root/keryx-migration/pg17-packages',
  runtimeHbaTemplate: '/root/keryx-migration/postgres17-server1-runtime.pg_hba.conf',
  pgdgFingerprint: 'B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8',
  sshFingerprint: 'SHA256:Gx7lw6/Bin9ZfrZjPflhOCeW03jGSDexlcb/byEaa/I',
});
const CONTROL_HASHES = Object.freeze({
  '/root/keryx/.env.local': '831c5228f3275698d311f89f6f80dcc84d9dc1d5005b942d64172a66a5e6da77',
  '/root/keryx-migration/bootstrap.mjs': '54cc1f65bff697ec0ba90aab02fb1b2547c200a014195b11cc1e052ca9e48dbb',
  '/root/keryx-migration/authority-transfer.json': 'e9212277066c6774ea5959914823ce59125892ed1da9706725a50597e56ddb68',
  '/root/keryx-migration/source-machine-id': 'a9baadf374fdfbacaa7ac7d7562109b32111821b583170a94d423de4ef4e65eb',
  '/root/.local/share/keryx-mainnet-runtime/production-v2/storage.json': 'da14670bbc660608ec772623f6d3e41cdd930927e2ebd927c3a4d752779aaef4',
});
const CONFIG_PATHS = Object.freeze({
  postgresql: `${SERVER1_PG17.configDirectory}/postgresql.conf`,
  hba: `${SERVER1_PG17.configDirectory}/pg_hba.conf`,
  ident: `${SERVER1_PG17.configDirectory}/pg_ident.conf`,
  service: SERVER1_PG17.serviceDropIn,
});
const TEMPLATE_NAMES = Object.freeze({ postgresql: 'server1-pg17.conf', hba: 'server1-pg17.pg_hba.conf', ident: 'server1-pg17.pg_ident.conf', service: 'server1-pg17.service.conf' });
const COMMON_CONFIG = '/etc/postgresql-common/createcluster.conf';
const COMMON_WIRE = '# Keryx preparation: package scripts must not create a default cluster.\ncreate_main_cluster = false\n';
const POLICY_PATH = '/usr/sbin/policy-rc.d';
// During this exclusive package transaction, deny all service starts/restarts.
// No unrelated package is upgraded/configured; the owned guard is removed only
// after the package operation and identity/hash checks have completed.
const POLICY_WIRE = '#!/bin/sh\n# keryx-pg17-preparation-only\nexit 101\n';
const SHA = /^[a-f0-9]{64}$/;
const PACKAGE_NAME = /^[a-z0-9][a-z0-9+.-]{0,95}$/;
// Closed PG17/Ubuntu24.04 dependency vocabulary. A signed repository alone does
// not authorize installing an unrelated service. Existing packages cannot be
// upgraded; an unlisted missing dependency requires a separately reviewed change.
const PACKAGE_NAMES = new Set([
  'postgresql-17', 'postgresql-client-17', 'postgresql-common', 'postgresql-client-common', 'libpq5',
  'libllvm19', 'libicu74', 'libc6', 'libcom-err2', 'libcrypt1', 'libgssapi-krb5-2', 'libk5crypto3',
  'libkrb5-3', 'libldap2', 'liblz4-1', 'libpam0g', 'libselinux1', 'libssl3t64', 'libsystemd0',
  'libuuid1', 'libxml2', 'libxslt1.1', 'libzstd1', 'zlib1g', 'perl', 'perl-base', 'perl-modules-5.38',
  'libperl5.38t64', 'libjson-perl', 'libjson-xs-perl', 'libtypes-serialiser-perl', 'libcommon-sense-perl',
  'ssl-cert', 'locales', 'tzdata', 'libreadline8t64', 'sensible-utils', 'ucf', 'lsb-release', 'adduser',
  'procps', 'libcurl4t64', 'liblzma5', 'libedit2', 'libbsd0', 'libmd0', 'libtinfo6', 'libexpat1',
  'libcap2', 'libpcre2-8-0', 'libffi8',
]);
const VERSION = /^[A-Za-z0-9.+:~_-]{1,128}$/;
const BUNDLE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._+%~-]{0,180}$/;
const LIMITS = Object.freeze({ pin: 128 * 1024, receipt: 128 * 1024, release: 4 * 1024 * 1024, index: 32 * 1024 * 1024, package: 256 * 1024 * 1024, packages: 64, command: 4 * 1024 * 1024, timeoutMs: 15 * 60 * 1000 });

export type ConfigHashes = Readonly<Record<keyof typeof CONFIG_PATHS, string>>;
type Repository = Readonly<{ kind: 'pgdg' | 'ubuntu'; inRelease: string; keyringSha256: string; indexes: readonly { file: string; releasePath: string; sha256: string; size: number }[] }>;
type PackagePin = Readonly<{ name: string; version: string; file: string; sha256: string; size: number; repository: number; index: number }>;
export type Server1Pg17ApprovedPin = Readonly<{
  format: 'keryx-server1-postgres17-approved-pin-v1';
  serverVersionNum: 170012;
  installedPackagesSha256: string;
  configHashes: ConfigHashes;
  runtimeHbaTemplateSha256: string;
  repositories: readonly Repository[];
  packages: readonly PackagePin[];
}>;
export type Server1PreparationReceipt = Readonly<{
  format: 'keryx-server1-postgres17-preparation-v1'; phase: 'prepared-unenrolled';
  cluster: '17/keryx'; service: 'postgresql@17-keryx.service'; socketDirectory: '/run/postgresql-keryx'; port: 5432;
  serverVersionNum: 170012; dataDirectory: '/var/lib/postgresql/17/keryx'; systemIdentifier: string;
  approvedPinSha256: string; packageInventorySha256: string; configHashes: ConfigHashes;
  vendorUnitSha256: string; runtimeHbaTemplateSha256: string; preparedAt: string;
  observations: Readonly<{
    listenAddresses: ''; unixSocketGroup: 'root'; unixSocketPermissions: '0770';
    socketDirectoryMode: '0750'; socketDirectoryUid: number; socketDirectoryGid: 0;
    fsync: 'on'; synchronousCommit: 'on'; fullPageWrites: 'on'; dataChecksums: 'on'; serviceActiveState: 'active';
  }>;
}>;
export type Server1PreparedPostgres = Readonly<{
  receipt: Server1PreparationReceipt;
  fingerprints: Readonly<{ receiptSha256: string; approvedPinSha256: string; packageInventorySha256: string; configHashes: ConfigHashes; vendorUnitSha256: string; controlSha256: string; sshHostKeyFingerprint: string }>;
  observations: Server1PreparationReceipt['observations'];
  targetVerified: false; applicationAuthority: false;
}>;

function refuse(stage: string): never { throw new Error(`server1_pg17_preparation_refused:${stage}`); }
function exactKeys(value: unknown, expected: readonly string[], stage: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) refuse(stage);
}
function digest(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function frozen<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}
function hashRecord(value: unknown): string { return digest(JSON.stringify(value)); }
function sameConfigHashes(a: ConfigHashes, b: ConfigHashes): boolean { return (Object.keys(CONFIG_PATHS) as (keyof ConfigHashes)[]).every(key => a[key] === b[key]); }
function boundedJson(wire: Buffer, stage: string): unknown { try { return JSON.parse(wire.toString('utf8')); } catch { return refuse(stage); } }
function checkHashes(value: unknown): asserts value is ConfigHashes {
  exactKeys(value, ['postgresql', 'hba', 'ident', 'service'], 'config_hash_shape');
  if (!Object.values(value).every(item => typeof item === 'string' && SHA.test(item))) refuse('config_hash');
}

/** Pure bounded parsing only; this does not verify a host, signature or package. */
export function parseServer1Pg17ApprovedPin(wire: Uint8Array): Server1Pg17ApprovedPin {
  if (wire.byteLength > LIMITS.pin) refuse('pin_bound');
  const p = boundedJson(Buffer.from(wire), 'pin_json');
  exactKeys(p, ['format', 'serverVersionNum', 'installedPackagesSha256', 'configHashes', 'runtimeHbaTemplateSha256', 'repositories', 'packages'], 'pin_shape');
  if (p.format !== 'keryx-server1-postgres17-approved-pin-v1' || p.serverVersionNum !== SERVER1_PG17.serverVersionNum || typeof p.installedPackagesSha256 !== 'string' || !SHA.test(p.installedPackagesSha256)) refuse('pin_identity');
  checkHashes(p.configHashes);
  if (typeof p.runtimeHbaTemplateSha256 !== 'string' || !SHA.test(p.runtimeHbaTemplateSha256)) refuse('runtime_hba_template_pin');
  if (!Array.isArray(p.repositories) || p.repositories.length < 1 || p.repositories.length > 4 || !Array.isArray(p.packages) || p.packages.length < 5 || p.packages.length > LIMITS.packages) refuse('pin_collections');
  const files = new Set<string>(); const names = new Set<string>();
  for (const r of p.repositories) {
    exactKeys(r, ['kind', 'inRelease', 'keyringSha256', 'indexes'], 'repository_shape');
    if (!['pgdg', 'ubuntu'].includes(String(r.kind)) || typeof r.inRelease !== 'string' || !BUNDLE_NAME.test(r.inRelease) || typeof r.keyringSha256 !== 'string' || !SHA.test(r.keyringSha256) || !Array.isArray(r.indexes) || r.indexes.length < 1 || r.indexes.length > 4) refuse('repository');
    if (files.has(r.inRelease)) refuse('duplicate_bundle_file'); files.add(r.inRelease);
    for (const i of r.indexes) {
      exactKeys(i, ['file', 'releasePath', 'sha256', 'size'], 'index_shape');
      if (typeof i.file !== 'string' || !BUNDLE_NAME.test(i.file) || typeof i.releasePath !== 'string' || !/^(main|universe)\/binary-amd64\/Packages$/.test(i.releasePath) || typeof i.sha256 !== 'string' || !SHA.test(i.sha256) || !Number.isSafeInteger(i.size) || Number(i.size) < 1 || Number(i.size) > LIMITS.index || files.has(i.file)) refuse('index');
      files.add(i.file);
    }
  }
  for (const v of p.packages) {
    exactKeys(v, ['name', 'version', 'file', 'sha256', 'size', 'repository', 'index'], 'package_shape');
    if (typeof v.name !== 'string' || !PACKAGE_NAME.test(v.name) || !PACKAGE_NAMES.has(v.name) || names.has(v.name) || typeof v.version !== 'string' || !VERSION.test(v.version) || typeof v.file !== 'string' || !BUNDLE_NAME.test(v.file) || !v.file.endsWith('.deb') || files.has(v.file) || typeof v.sha256 !== 'string' || !SHA.test(v.sha256) || !Number.isSafeInteger(v.size) || Number(v.size) < 1 || Number(v.size) > LIMITS.package || !Number.isInteger(v.repository) || !Number.isInteger(v.index)) refuse('package');
    const r = p.repositories[Number(v.repository)] as Repository | undefined;
    if (!r || !r.indexes[Number(v.index)]) refuse('package_repository');
    if ((v.name === 'postgresql-17' || v.name === 'postgresql-client-17') && (r.kind !== 'pgdg' || !/^17\.12-[A-Za-z0-9.+~_-]+$/.test(v.version))) refuse('package_major');
    names.add(v.name); files.add(v.file);
  }
  if (p.packages.reduce((sum, item) => sum + Number(item.size), 0) > 1024 * 1024 * 1024) refuse('whole_package_bundle_bound');
  if (!['postgresql-17', 'postgresql-client-17', 'postgresql-common', 'postgresql-client-common', 'libpq5'].every(n => names.has(n))) refuse('required_packages');
  return frozen(p as unknown as Server1Pg17ApprovedPin);
}

/** Exact signed-index lookup; no nearest-version/latest/repository fallback. */
export function assertServer1PackageIndex(indexWire: string, pin: PackagePin): void {
  if (Buffer.byteLength(indexWire) > LIMITS.index) refuse('index_bound');
  let matches = 0;
  for (const paragraph of indexWire.replace(/\r\n/g, '\n').split('\n\n')) {
    const fields = new Map<string, string>();
    for (const line of paragraph.split('\n')) {
      if (!line || /^\s/.test(line)) continue;
      const colon = line.indexOf(':'); if (colon < 1) refuse('index_line');
      const key = line.slice(0, colon); if (fields.has(key)) refuse('index_duplicate_field');
      fields.set(key, line.slice(colon + 1).trim());
    }
    if (fields.get('Package') !== pin.name || fields.get('Version') !== pin.version) continue;
    if (fields.get('Architecture') !== 'amd64' && fields.get('Architecture') !== 'all') refuse('package_architecture');
    if (fields.get('SHA256') !== pin.sha256 || fields.get('Size') !== String(pin.size) || fields.get('Filename')?.split('/').pop() !== pin.file) refuse('signed_package_mismatch');
    matches++;
  }
  if (matches !== 1) refuse('signed_package_missing_or_ambiguous');
}

function run(command: string, args: readonly string[], maxBuffer = LIMITS.command, allowedExitCodes: readonly number[] = [0]): Promise<string> {
  return new Promise((resolveRun, reject) => {
    execFile(command, [...args], { encoding: 'utf8', timeout: LIMITS.timeoutMs, maxBuffer, env: {
      PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', LC_ALL: 'C', HOME: '/root',
      DEBIAN_FRONTEND: 'noninteractive', PGPASSWORD: '', PGPASSFILE: '/dev/null', PGSERVICEFILE: '/dev/null',
      PGCONNECT_TIMEOUT: '5', PGSSLMODE: 'disable',
    } }, (error, stdout, stderr) => {
      // Command stderr can contain private paths/SQL. Never include it in errors.
      if ((error && !allowedExitCodes.includes(Number(error.code))) || Buffer.byteLength(stdout) > maxBuffer || Buffer.byteLength(stderr) > maxBuffer) reject(new Error('server1_pg17_preparation_refused:command_failed'));
      else resolveRun(stdout);
    });
  });
}
async function exists(path: string): Promise<boolean> { try { await fs.lstat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
async function checkedDirectory(path: string, uid: number, gid: number, mode: number): Promise<void> {
  const s = await fs.lstat(path); if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== uid || s.gid !== gid || (s.mode & 0o7777) !== mode || await fs.realpath(path) !== path) refuse('directory_binding');
}
async function readFile(path: string, maxBytes: number, mode?: number, uid = 0): Promise<Buffer> {
  const handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const s = await handle.stat();
    if (!s.isFile() || s.nlink !== 1 || s.uid !== uid || (mode !== undefined && (s.mode & 0o7777) !== mode) || s.size < 1 || s.size > maxBytes || await fs.realpath(path) !== path) refuse('protected_file');
    const result = await handle.readFile(); const after = await handle.stat();
    if (result.length !== s.size || after.size !== s.size || after.mtimeMs !== s.mtimeMs || after.ctimeMs !== s.ctimeMs) refuse('file_changed');
    return result;
  } finally { await handle.close(); }
}
async function hashFile(path: string, maxBytes = LIMITS.package, mode?: number): Promise<string> {
  const handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.uid !== 0 || before.nlink !== 1 || before.size < 1 || before.size > maxBytes || (mode !== undefined && (before.mode & 0o7777) !== mode) || await fs.realpath(path) !== path) refuse('hash_file_binding');
    const h = createHash('sha256'); const chunk = Buffer.alloc(256 * 1024); let read = 0;
    while (read < before.size) { const result = await handle.read(chunk, 0, Math.min(chunk.length, before.size - read), read); if (!result.bytesRead) refuse('hash_short_read'); h.update(chunk.subarray(0, result.bytesRead)); read += result.bytesRead; }
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) refuse('hash_file_changed');
    return h.digest('hex');
  } finally { await handle.close(); }
}
async function syncDirectory(path: string): Promise<void> { const h = await fs.open(path, constants.O_RDONLY | constants.O_DIRECTORY); try { await h.sync(); } finally { await h.close(); } }
async function writeExclusive(path: string, wire: string | Buffer, mode: number): Promise<void> {
  const h = await fs.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), mode);
  try { await h.chmod(mode); await h.writeFile(wire); await h.sync(); } finally { await h.close(); }
  await syncDirectory(dirname(path));
}
async function removeOwned(path: string, expected: string): Promise<void> {
  if (digest(await readFile(path, LIMITS.receipt)) !== expected) refuse('cleanup_ownership');
  await fs.unlink(path); await syncDirectory(dirname(path));
}
async function directoryNew(path: string, mode: number, uid = 0, gid = 0): Promise<void> { await fs.mkdir(path, { mode }); await fs.chown(path, uid, gid); await fs.chmod(path, mode); await syncDirectory(dirname(path)); }
async function noPostgresProcess(): Promise<void> {
  for (const entry of await fs.readdir('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9]+$/.test(entry.name)) continue;
    try { if ((await fs.readFile(`/proc/${entry.name}/comm`, 'utf8')).trim() === 'postgres') refuse('existing_postgres_process'); }
    catch (error) { if (!['ENOENT', 'ESRCH'].includes(String((error as NodeJS.ErrnoException).code))) throw error; }
  }
}

async function hostGuard(): Promise<Readonly<{ controlSha256: string; sshHostKeyFingerprint: string }>> {
  if (process.platform !== 'linux' || process.getuid?.() !== 0 || process.getgid?.() !== 0 || process.versions.node !== '24.22.1' || process.arch !== 'x64') refuse('operator_platform');
  const osPath = await fs.realpath('/etc/os-release');
  if (!['/etc/os-release', '/usr/lib/os-release'].includes(osPath)) refuse('os_release_binding');
  const os = (await readFile(osPath, 16 * 1024)).toString('utf8');
  if (!/^ID=ubuntu$/m.test(os) || !/^VERSION_ID="24\.04"$/m.test(os) || !/microsoft.*wsl/i.test((await fs.readFile('/proc/sys/kernel/osrelease', 'utf8')))) refuse('server1_os');
  await checkedDirectory('/root/keryx-migration', 0, 0, 0o700);
  const controls: [string, string][] = [];
  for (const [path, expected] of Object.entries(CONTROL_HASHES)) {
    const actual = digest(await readFile(path, 4 * 1024 * 1024, 0o600));
    if (actual !== expected) refuse('server1_protected_controls'); controls.push([path, actual]);
  }
  const machine = await fs.readFile('/etc/machine-id');
  if (digest(machine) !== CONTROL_HASHES['/root/keryx-migration/source-machine-id']) refuse('logical_machine_binding');
  const fingerprint = (await run('/usr/bin/ssh-keygen', ['-lf', '/etc/ssh/ssh_host_ed25519_key.pub', '-E', 'sha256'])).trim().split(/\s+/)[1];
  if (fingerprint !== SERVER1_PG17.sshFingerprint) refuse('server1_ssh_host_key');
  return frozen({ controlSha256: hashRecord(controls), sshHostKeyFingerprint: fingerprint });
}
async function installedInventory(): Promise<{ wire: string; sha256: string; entries: Map<string, string> }> {
  const wire = await run('/usr/bin/dpkg-query', ['-W', '-f=${binary:Package}\t${Version}\t${db:Status-Status}\n']);
  const entries = new Map<string, string>();
  for (const line of wire.trimEnd().split('\n')) {
    const [name, version, status] = line.split('\t');
    if (status !== 'installed') refuse('dpkg_not_fully_configured'); entries.set(name.replace(/:amd64$/, ''), version);
  }
  return { wire, sha256: digest(wire), entries };
}
async function templates(): Promise<{ wires: Record<keyof ConfigHashes, Buffer>; hashes: ConfigHashes; runtimeHba: Buffer }> {
  if (typeof import.meta.url !== 'string') refuse('apply_requires_source_entry');
  const folder = resolve(dirname(fileURLToPath(import.meta.url)), '../../ops/keryx-postgres');
  const wires = {} as Record<keyof ConfigHashes, Buffer>; const hashes = {} as Record<keyof ConfigHashes, string>;
  for (const key of Object.keys(TEMPLATE_NAMES) as (keyof ConfigHashes)[]) {
    // Normalize tracked CRLF once; installed bytes and receipt hashes are LF.
    const wire = (await fs.readFile(resolve(folder, TEMPLATE_NAMES[key]), 'utf8')).replace(/\r\n/g, '\n');
    if (wire.includes('\r') || Buffer.byteLength(wire) > 32768) refuse('literal_template');
    wires[key] = Buffer.from(wire); hashes[key] = digest(wires[key]);
  }
  const runtimeHba = Buffer.from((await fs.readFile(resolve(folder, 'server1-pg17.runtime.pg_hba.conf'), 'utf8')).replace(/\r\n/g, '\n'));
  if (runtimeHba.includes(13) || runtimeHba.length > 32768) refuse('runtime_hba_template');
  return { wires, hashes: frozen(hashes), runtimeHba };
}
function parseProperties(wire: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const line of wire.trimEnd().split('\n')) { const split = line.indexOf('='); if (split < 1 || Object.hasOwn(properties, line.slice(0, split))) refuse('systemd_properties'); properties[line.slice(0, split)] = line.slice(split + 1); }
  return properties;
}
const SERVICE_PROPERTIES = ['LoadState', 'ActiveState', 'SubState', 'UnitFileState', 'FragmentPath', 'DropInPaths', 'User', 'Group', 'Type', 'ExecStart', 'RuntimeDirectory', 'RuntimeDirectoryMode', 'MemoryMax', 'MemorySwapMax', 'CPUQuotaPerSecUSec', 'TasksMax', 'NoNewPrivileges', 'CapabilityBoundingSet', 'ControlGroup', 'MainPID'];
async function serviceProperties(): Promise<Record<string, string>> { return parseProperties(await run('/usr/bin/systemctl', ['show', SERVER1_PG17.service, ...SERVICE_PROPERTIES.map(p => `--property=${p}`)])); }
async function postgresUid(): Promise<number> { const value = (await run('/usr/bin/id', ['-u', 'postgres'])).trim(); if (!/^[1-9][0-9]{0,8}$/.test(value)) refuse('postgres_uid'); return Number(value); }
async function fixedSql(): Promise<Record<string, unknown>> {
  const result = await run('/usr/lib/postgresql/17/bin/psql', ['--no-psqlrc', '--no-password', '--host', SERVER1_PG17.socketDirectory, '--port', '5432', '--username', 'postgres', '--dbname', 'postgres', '-A', '-t', '--set=ON_ERROR_STOP=1', '-c',
    `SELECT json_build_object('sessionUser',session_user,'serverVersionNum',current_setting('server_version_num')::integer,'dataDirectory',current_setting('data_directory'),'configFile',current_setting('config_file'),'hbaFile',current_setting('hba_file'),'identFile',current_setting('ident_file'),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'listenAddresses',current_setting('listen_addresses'),'socketDirectory',current_setting('unix_socket_directories'),'unixSocketGroup',current_setting('unix_socket_group'),'unixSocketPermissions',current_setting('unix_socket_permissions'),'fsync',current_setting('fsync'),'synchronousCommit',current_setting('synchronous_commit'),'fullPageWrites',current_setting('full_page_writes'),'dataChecksums',current_setting('data_checksums'),'passwordEncryption',current_setting('password_encryption'),'port',current_setting('port')::integer,'hbaErrors',(SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL),'identErrors',(SELECT count(*) FROM pg_ident_file_mappings WHERE error IS NOT NULL),'applicationDatabases',(SELECT count(*) FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')),'customRoles',(SELECT count(*) FROM pg_roles WHERE rolname<>'postgres' AND rolname NOT LIKE 'pg\\_%' ESCAPE '\\'))`]);
  const data = boundedJson(Buffer.from(result.trim()), 'sql_observations'); if (!data || typeof data !== 'object' || Array.isArray(data)) refuse('sql_shape'); return data as Record<string, unknown>;
}
async function verifyPreparedState(expected: { configHashes: ConfigHashes; packageInventorySha256: string; systemIdentifier?: string; vendorUnitSha256?: string }, fresh = false): Promise<{ observations: Server1PreparationReceipt['observations']; systemIdentifier: string; vendorUnitSha256: string }> {
  const properties = await serviceProperties();
  if (properties.LoadState !== 'loaded' || properties.ActiveState !== 'active' || properties.SubState !== 'running' || properties.UnitFileState !== 'enabled' || properties.User !== 'postgres' || properties.Group !== 'root' || properties.Type !== 'simple' || properties.DropInPaths !== SERVER1_PG17.serviceDropIn || properties.RuntimeDirectory !== 'postgresql-keryx' || properties.RuntimeDirectoryMode !== '0750' || properties.MemoryMax !== '1073741824' || properties.MemorySwapMax !== '0' || properties.CPUQuotaPerSecUSec !== '750ms' || properties.TasksMax !== '64' || properties.NoNewPrivileges !== 'yes' || properties.CapabilityBoundingSet !== '' || !/^[1-9][0-9]*$/.test(properties.MainPID)) refuse('effective_service');
  if (!['/lib/systemd/system/postgresql@.service', '/usr/lib/systemd/system/postgresql@.service'].includes(properties.FragmentPath) || !properties.ExecStart.includes('path=/usr/lib/postgresql/17/bin/postgres ; argv[]=/usr/lib/postgresql/17/bin/postgres -D /var/lib/postgresql/17/keryx -c config_file=/etc/postgresql/17/keryx/postgresql.conf ;')) refuse('service_command');
  const fragment = await fs.realpath(properties.FragmentPath);
  const vendorUnitSha256 = await hashFile(fragment, 64 * 1024);
  if (expected.vendorUnitSha256 && vendorUnitSha256 !== expected.vendorUnitSha256) refuse('vendor_unit_changed');
  const uid = await postgresUid();
  await checkedDirectory(SERVER1_PG17.dataDirectory, uid, 0, 0o700);
  await checkedDirectory(SERVER1_PG17.configDirectory, 0, 0, 0o750);
  await checkedDirectory(SERVER1_PG17.socketDirectory, uid, 0, 0o750);
  for (const key of Object.keys(CONFIG_PATHS) as (keyof ConfigHashes)[]) {
    if (digest(await readFile(CONFIG_PATHS[key], 32768, 0o640)) !== expected.configHashes[key]) refuse('installed_config_changed');
  }
  const socket = await fs.lstat(`${SERVER1_PG17.socketDirectory}/.s.PGSQL.5432`);
  if (!socket.isSocket() || socket.uid !== uid || socket.gid !== 0 || (socket.mode & 0o7777) !== 0o770) refuse('socket_binding');
  if ((await installedInventory()).sha256 !== expected.packageInventorySha256) refuse('installed_package_drift');
  const sql = await fixedSql();
  if (sql.sessionUser !== 'postgres' || sql.serverVersionNum !== SERVER1_PG17.serverVersionNum || sql.dataDirectory !== SERVER1_PG17.dataDirectory || sql.configFile !== CONFIG_PATHS.postgresql || sql.hbaFile !== CONFIG_PATHS.hba || sql.identFile !== CONFIG_PATHS.ident || sql.listenAddresses !== '' || sql.socketDirectory !== SERVER1_PG17.socketDirectory || sql.unixSocketGroup !== 'root' || sql.unixSocketPermissions !== '0770' || sql.port !== 5432 || sql.passwordEncryption !== 'scram-sha-256' || sql.hbaErrors !== 0 || sql.identErrors !== 0 || !['fsync', 'synchronousCommit', 'fullPageWrites', 'dataChecksums'].every(k => sql[k] === 'on') || typeof sql.systemIdentifier !== 'string' || !/^[0-9]{10,24}$/.test(sql.systemIdentifier) || (expected.systemIdentifier && expected.systemIdentifier !== sql.systemIdentifier)) refuse('actual_postgres_binding');
  if (fresh && (sql.applicationDatabases !== 0 || sql.customRoles !== 0)) refuse('already_enrolled');
  const tcp = await run('/usr/bin/ss', ['-H', '-ltnp']);
  if (/postgres|:5432(?:\s|$)/i.test(tcp)) refuse('postgres_tcp_listener');
  if (await exists('/etc/postgresql/17/main') || await exists('/var/lib/postgresql/17/main')) refuse('unexpected_default_cluster');
  const procStatus = await fs.readFile(`/proc/${properties.MainPID}/status`, 'utf8');
  if (!/^NoNewPrivs:\s+1$/m.test(procStatus) || !/^CapEff:\s+0+$/m.test(procStatus)) refuse('service_process_privileges');
  if (!new RegExp(`^Uid:\\s+${uid}\\s+${uid}\\s+${uid}\\s+${uid}$`, 'm').test(procStatus) || !/^Gid:\s+0\s+0\s+0\s+0$/m.test(procStatus) || await fs.realpath(`/proc/${properties.MainPID}/exe`) !== '/usr/lib/postgresql/17/bin/postgres') refuse('actual_postmaster_identity');
  const group = properties.ControlGroup;
  if (!/^\/system\.slice\/system-postgresql\.slice\/postgresql@17-keryx\.service$/.test(group)) refuse('service_cgroup');
  const cg = `/sys/fs/cgroup${group}`;
  if ((await fs.readFile(`${cg}/memory.max`, 'utf8')).trim() !== '1073741824' || (await fs.readFile(`${cg}/memory.swap.max`, 'utf8')).trim() !== '0' || (await fs.readFile(`${cg}/pids.max`, 'utf8')).trim() !== '64') refuse('actual_service_limits');
  const [quota, period] = (await fs.readFile(`${cg}/cpu.max`, 'utf8')).trim().split(/\s+/).map(Number);
  if (!Number.isFinite(quota) || !Number.isFinite(period) || quota / period !== 0.75) refuse('actual_cpu_limit');
  return { systemIdentifier: sql.systemIdentifier, vendorUnitSha256, observations: frozen({ listenAddresses: '', unixSocketGroup: 'root', unixSocketPermissions: '0770', socketDirectoryMode: '0750', socketDirectoryUid: uid, socketDirectoryGid: 0, fsync: 'on', synchronousCommit: 'on', fullPageWrites: 'on', dataChecksums: 'on', serviceActiveState: 'active' }) };
}

/** Fixed readonly inspection, safe to import from a compiled CJS operator child.
 * Later enrollment/intake still rechecks actual SQL under its own transaction.
 */
export async function inspectServer1PreparedPostgres(): Promise<Server1PreparedPostgres> {
  const host = await hostGuard();
  if (await exists(SERVER1_PG17.journal)) refuse('unfinished_or_unknown_apply');
  const receiptWire = await readFile(SERVER1_PG17.receipt, LIMITS.receipt, 0o600);
  const r = boundedJson(receiptWire, 'preparation_receipt') as Server1PreparationReceipt;
  exactKeys(r, ['format', 'phase', 'cluster', 'service', 'socketDirectory', 'port', 'serverVersionNum', 'dataDirectory', 'systemIdentifier', 'approvedPinSha256', 'packageInventorySha256', 'configHashes', 'vendorUnitSha256', 'runtimeHbaTemplateSha256', 'preparedAt', 'observations'], 'receipt_shape');
  if (r.format !== 'keryx-server1-postgres17-preparation-v1' || r.phase !== 'prepared-unenrolled' || r.cluster !== SERVER1_PG17.cluster || r.service !== SERVER1_PG17.service || r.socketDirectory !== SERVER1_PG17.socketDirectory || r.port !== 5432 || r.serverVersionNum !== SERVER1_PG17.serverVersionNum || r.dataDirectory !== SERVER1_PG17.dataDirectory || typeof r.systemIdentifier !== 'string' || !/^[0-9]{10,24}$/.test(r.systemIdentifier) || !SHA.test(r.approvedPinSha256) || !SHA.test(r.packageInventorySha256) || !SHA.test(r.vendorUnitSha256) || !SHA.test(r.runtimeHbaTemplateSha256) || typeof r.preparedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.preparedAt)) refuse('preparation_receipt_binding');
  exactKeys(r.observations, ['listenAddresses', 'unixSocketGroup', 'unixSocketPermissions', 'socketDirectoryMode', 'socketDirectoryUid', 'socketDirectoryGid', 'fsync', 'synchronousCommit', 'fullPageWrites', 'dataChecksums', 'serviceActiveState'], 'receipt_observations_shape');
  checkHashes(r.configHashes);
  const pinWire = await readFile(SERVER1_PG17.pin, LIMITS.pin, 0o600);
  if (digest(pinWire) !== r.approvedPinSha256) refuse('approved_pin_changed');
  const pin = parseServer1Pg17ApprovedPin(pinWire);
  if (!sameConfigHashes(pin.configHashes, r.configHashes) || r.runtimeHbaTemplateSha256 !== pin.runtimeHbaTemplateSha256 || await hashFile(SERVER1_PG17.runtimeHbaTemplate, 32768, 0o600) !== r.runtimeHbaTemplateSha256) refuse('receipt_pin_configs');
  const actual = await verifyPreparedState(r);
  if (hashRecord(actual.observations) !== hashRecord(r.observations)) refuse('receipt_observations_changed');
  if (digest(await readFile(SERVER1_PG17.receipt, LIMITS.receipt, 0o600)) !== digest(receiptWire) || (await hostGuard()).controlSha256 !== host.controlSha256 || await exists(SERVER1_PG17.journal)) refuse('inspection_changed');
  return frozen({ receipt: r, fingerprints: { receiptSha256: digest(receiptWire), approvedPinSha256: r.approvedPinSha256, packageInventorySha256: r.packageInventorySha256, configHashes: r.configHashes, vendorUnitSha256: actual.vendorUnitSha256, ...host }, observations: actual.observations, targetVerified: false, applicationAuthority: false });
}

async function initialPreflight(): Promise<{ host: Awaited<ReturnType<typeof hostGuard>>; inventory: Awaited<ReturnType<typeof installedInventory>> }> {
  const host = await hostGuard();
  for (const path of [SERVER1_PG17.receipt, SERVER1_PG17.journal, SERVER1_PG17.runtimeHbaTemplate, SERVER1_PG17.dataDirectory, SERVER1_PG17.configDirectory, SERVER1_PG17.socketDirectory, dirname(SERVER1_PG17.serviceDropIn), COMMON_CONFIG, POLICY_PATH]) if (await exists(path)) refuse('existing_or_partial_preparation');
  const inventory = await installedInventory();
  if ((await run('/usr/bin/dpkg', ['--print-architecture'])).trim() !== 'amd64' || (await run('/usr/bin/dpkg', ['--print-foreign-architectures'])).trim()) refuse('package_architecture');
  if ([...inventory.entries.keys()].some(name => /^(postgresql(?:-|$)|libpq)/.test(name))) refuse('existing_postgres_packages');
  if ((await run('/usr/bin/dpkg', ['--audit'])).trim()) refuse('dpkg_audit');
  await noPostgresProcess();
  if (await exists('/etc/postgresql') && (await fs.readdir('/etc/postgresql')).length) refuse('existing_cluster_configuration');
  const tcp = await run('/usr/bin/ss', ['-H', '-ltnp']); if (/postgres|:5432(?:\s|$)/i.test(tcp)) refuse('existing_postgres_listener');
  for (const unit of ['postgresql.service', 'postgresql@17-main.service', SERVER1_PG17.service]) {
    const result = await run('/usr/bin/systemctl', ['show', unit, '--property=LoadState', '--property=ActiveState'], LIMITS.command, [0, 1]);
    const p = parseProperties(result); if (p.LoadState !== 'not-found' || p.ActiveState !== 'inactive') refuse('existing_postgres_unit');
  }
  return { host, inventory };
}
function assertReleaseIndex(release: string, index: Repository['indexes'][number]): void {
  const block = release.match(/^SHA256:\n((?:[ \t]+[^\n]+\n?)+)/m)?.[1]; if (!block) refuse('release_sha256');
  const matches = block.split('\n').filter(Boolean).map(line => line.trim().split(/\s+/)).filter(v => v[2] === index.releasePath);
  if (matches.length !== 1 || matches[0][0] !== index.sha256 || matches[0][1] !== String(index.size)) refuse('release_index_binding');
}
async function verifyBundle(pin: Server1Pg17ApprovedPin, work: string): Promise<void> {
  await checkedDirectory(SERVER1_PG17.bundle, 0, 0, 0o700);
  for (let n = 0; n < pin.repositories.length; n++) {
    const repository = pin.repositories[n];
    const key = repository.kind === 'pgdg' ? `${SERVER1_PG17.bundle}/pgdg.gpg` : '/usr/share/keyrings/ubuntu-archive-keyring.gpg';
    if (await hashFile(await fs.realpath(key), 4 * 1024 * 1024) !== repository.keyringSha256) refuse('repository_keyring');
    const signedPath = `${SERVER1_PG17.bundle}/${repository.inRelease}`;
    await readFile(signedPath, LIMITS.release, 0o600);
    const releasePath = `${work}/release-${n}`;
    const status = await run('/usr/bin/gpgv', ['--keyring', key, '--status-fd', '1', '--output', releasePath, signedPath]);
    const signatures = status.split('\n').filter(line => line.startsWith('[GNUPG:] VALIDSIG '));
    if (signatures.length !== 1 || (repository.kind === 'pgdg' && !signatures[0].split(/\s+/).includes(SERVER1_PG17.pgdgFingerprint))) refuse('repository_signature');
    const release = (await readFile(releasePath, LIMITS.release)).toString('utf8');
    if (!/^Codename: noble(?:-pgdg|-updates|-security)?$/m.test(release) || (repository.kind === 'pgdg' && !/^Origin: apt.postgresql.org$/m.test(release)) || (repository.kind === 'ubuntu' && !/^Origin: Ubuntu$/m.test(release))) refuse('repository_distribution');
    for (const index of repository.indexes) {
      assertReleaseIndex(release, index);
      const wire = await readFile(`${SERVER1_PG17.bundle}/${index.file}`, LIMITS.index, 0o600);
      if (wire.length !== index.size || digest(wire) !== index.sha256) refuse('package_index_hash');
      for (const p of pin.packages.filter(p => p.repository === n && repository.indexes[p.index] === index)) assertServer1PackageIndex(wire.toString('utf8'), p);
    }
  }
  for (const p of pin.packages) {
    const file = `${SERVER1_PG17.bundle}/${p.file}`;
    const size = (await fs.lstat(file)).size;
    if (size !== p.size || await hashFile(file, LIMITS.package, 0o600) !== p.sha256) refuse('package_file_hash');
    const meta = (await run('/usr/bin/dpkg-deb', ['--field', file, 'Package', 'Version', 'Architecture'])).trim();
    if (meta !== `Package: ${p.name}\nVersion: ${p.version}\nArchitecture: amd64` && meta !== `Package: ${p.name}\nVersion: ${p.version}\nArchitecture: all`) refuse('package_control');
  }
}

/** Explicit mutation entry. Pin/path/executable choices are finite and fixed.
 * Failure after the exclusive journal leaves it in place: inspect and reconcile,
 * never automatically retry/adopt a partially installed or unknown outcome.
 */
export async function prepareServer1Postgres17(options: Readonly<{ mode: 'preflight' | 'apply'; approvedPinSha256?: string }>): Promise<unknown> {
  exactKeys(options, options.mode === 'preflight' ? ['mode'] : ['mode', 'approvedPinSha256'], 'options');
  if (options.mode === 'preflight') {
    if (await exists(SERVER1_PG17.receipt)) return inspectServer1PreparedPostgres();
    const initial = await initialPreflight();
    return frozen({ format: 'keryx-server1-postgres17-preflight-v1', phase: 'fresh-unprepared', ...initial.host, installedPackagesSha256: initial.inventory.sha256, targetVerified: false, applicationAuthority: false, mutated: false });
  }
  if (options.mode !== 'apply' || typeof options.approvedPinSha256 !== 'string' || !SHA.test(options.approvedPinSha256)) refuse('apply_pin_sha256');
  // A completed repeat is verification-only. Never reinstall a known instance.
  if (await exists(SERVER1_PG17.receipt)) {
    const inspected = await inspectServer1PreparedPostgres();
    if (inspected.receipt.approvedPinSha256 !== options.approvedPinSha256) refuse('different_prepared_pin');
    return inspected;
  }
  const initial = await initialPreflight();
  const pinWire = await readFile(SERVER1_PG17.pin, LIMITS.pin, 0o600);
  if (digest(pinWire) !== options.approvedPinSha256) refuse('reviewed_pin_sha256');
  const pin = parseServer1Pg17ApprovedPin(pinWire); const literal = await templates();
  if (!sameConfigHashes(pin.configHashes, literal.hashes) || pin.runtimeHbaTemplateSha256 !== digest(literal.runtimeHba) || pin.installedPackagesSha256 !== initial.inventory.sha256) refuse('reviewed_preflight_drift');
  for (const p of pin.packages) if (initial.inventory.entries.has(p.name) && initial.inventory.entries.get(p.name) !== p.version) refuse('installed_package_upgrade_refused');
  let journalWire = `${JSON.stringify({ format: 'keryx-server1-postgres17-apply-in-progress-v1', approvedPinSha256: options.approvedPinSha256, startedAt: new Date().toISOString(), outcome: 'UNKNOWN_UNTIL_PREPARED_RECEIPT', automaticRetry: false })}\n`;
  await writeExclusive(SERVER1_PG17.journal, journalWire, 0o600);
  async function phase(stage: string): Promise<void> {
    if (digest(await readFile(SERVER1_PG17.journal, LIMITS.receipt, 0o600)) !== digest(journalWire)) refuse('phase_journal_changed');
    const next = `${JSON.stringify({ stage, observedAt: new Date().toISOString() })}\n`;
    const h = await fs.open(SERVER1_PG17.journal, constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0));
    try { await h.writeFile(next); await h.sync(); } finally { await h.close(); }
    journalWire += next;
  }
  const work = '/root/keryx-migration/pg17-verification-work';
  try {
    await directoryNew(work, 0o700); await phase('signed_bundle_verification_started'); await verifyBundle(pin, work); await phase('signed_bundle_verified');
    if ((await hostGuard()).controlSha256 !== initial.host.controlSha256 || (await installedInventory()).sha256 !== initial.inventory.sha256 || digest(await readFile(SERVER1_PG17.pin, LIMITS.pin, 0o600)) !== options.approvedPinSha256) refuse('preinstall_changed');
    if (!await exists('/etc/postgresql-common')) await directoryNew('/etc/postgresql-common', 0o755);
    await writeExclusive(COMMON_CONFIG, COMMON_WIRE, 0o644);
    await writeExclusive(POLICY_PATH, POLICY_WIRE, 0o755);
    await run('/usr/bin/systemctl', ['mask', '--runtime', 'postgresql.service', 'postgresql@17-main.service']);
    await phase('package_startup_guards_installed');
    // Signed exact local files only; no apt repositories, downloads, upgrade-all,
    // or configuration of unrelated pending packages.
    const freshPackages = pin.packages.filter(p => !initial.inventory.entries.has(p.name));
    await run('/usr/bin/dpkg', ['--force-confold', '--unpack', ...freshPackages.map(p => `${SERVER1_PG17.bundle}/${p.file}`)]);
    await run('/usr/bin/dpkg', ['--configure', ...freshPackages.map(p => p.name)]);
    await phase('package_configuration_acknowledged');
    for (const p of pin.packages) {
      const v = (await run('/usr/bin/dpkg-query', ['-W', '-f=${Version}\t${db:Status-Status}', p.name])).trim();
      if (v !== `${p.version}\tinstalled`) refuse('installed_package_version');
    }
    const packageVerification = await run('/usr/bin/dpkg', ['--verify', ...pin.packages.map(p => p.name)], LIMITS.command, [0, 1]);
    if (packageVerification.split('\n').filter(Boolean).some(line => !/^\?\?5\?\?\?\?\?\? c \/etc\/postgresql-common\/createcluster\.conf$/.test(line))) refuse('installed_package_payload');
    if (digest(await readFile(COMMON_CONFIG, 4096, 0o644)) !== digest(COMMON_WIRE) || await exists('/etc/postgresql/17/main') || await exists('/var/lib/postgresql/17/main') || (await run('/usr/bin/ss', ['-H', '-ltnp'])).match(/postgres|:5432(?:\s|$)/i)) refuse('package_startup_suppression');
    const uid = await postgresUid();
    for (const parent of ['/var/lib/postgresql', '/var/lib/postgresql/17', '/etc/postgresql', '/etc/postgresql/17']) if (!await exists(parent)) await directoryNew(parent, 0o755);
    await directoryNew(SERVER1_PG17.dataDirectory, 0o700, uid, 0);
    await run('/usr/sbin/runuser', ['--user', 'postgres', '--group', 'root', '--', '/usr/lib/postgresql/17/bin/initdb', '--pgdata', SERVER1_PG17.dataDirectory, '--encoding=UTF8', '--locale=C', '--data-checksums', '--auth-local=peer', '--auth-host=scram-sha-256']);
    await phase('fresh_checksummed_cluster_initialized');
    await directoryNew(SERVER1_PG17.configDirectory, 0o750);
    await directoryNew(dirname(SERVER1_PG17.serviceDropIn), 0o755);
    for (const key of Object.keys(CONFIG_PATHS) as (keyof ConfigHashes)[]) await writeExclusive(CONFIG_PATHS[key], literal.wires[key], 0o640);
    await writeExclusive(SERVER1_PG17.runtimeHbaTemplate, literal.runtimeHba, 0o600);
    await writeExclusive(`${SERVER1_PG17.configDirectory}/start.conf`, 'manual\n', 0o640);
    await removeOwned(POLICY_PATH, digest(POLICY_WIRE));
    await run('/usr/bin/systemctl', ['daemon-reload']);
    for (const mask of ['/run/systemd/system/postgresql.service', '/run/systemd/system/postgresql@17-main.service']) {
      const stat = await fs.lstat(mask); if (!stat.isSymbolicLink() || stat.uid !== 0 || await fs.readlink(mask) !== '/dev/null') refuse('runtime_mask_ownership');
    }
    await run('/usr/bin/systemctl', ['unmask', '--runtime', 'postgresql.service', 'postgresql@17-main.service']);
    await phase('dedicated_service_start_submitted');
    await run('/usr/bin/systemctl', ['enable', '--now', SERVER1_PG17.service]);
    const inventory = await installedInventory();
    const expectedPackages = new Map(initial.inventory.entries);
    for (const p of pin.packages) expectedPackages.set(p.name, p.version);
    if (inventory.entries.size !== expectedPackages.size || [...expectedPackages].some(([name, version]) => inventory.entries.get(name) !== version)) refuse('unreviewed_package_change');
    const actual = await verifyPreparedState({ configHashes: literal.hashes, packageInventorySha256: inventory.sha256 }, true);
    await phase('actual_persistent_service_verified');
    if ((await hostGuard()).controlSha256 !== initial.host.controlSha256 || digest(await readFile(SERVER1_PG17.pin, LIMITS.pin, 0o600)) !== options.approvedPinSha256) refuse('postinstall_application_controls_changed');
    const receipt: Server1PreparationReceipt = { format: 'keryx-server1-postgres17-preparation-v1', phase: 'prepared-unenrolled', cluster: '17/keryx', service: 'postgresql@17-keryx.service', socketDirectory: '/run/postgresql-keryx', port: 5432, serverVersionNum: 170012, dataDirectory: '/var/lib/postgresql/17/keryx', systemIdentifier: actual.systemIdentifier, approvedPinSha256: options.approvedPinSha256, packageInventorySha256: inventory.sha256, configHashes: literal.hashes, vendorUnitSha256: actual.vendorUnitSha256, runtimeHbaTemplateSha256: digest(literal.runtimeHba), observations: actual.observations, preparedAt: new Date().toISOString() };
    await writeExclusive(SERVER1_PG17.receipt, `${JSON.stringify(receipt)}\n`, 0o600);
    await phase('prepared_unenrolled_receipt_fsynced');
    for (let n = 0; n < pin.repositories.length; n++) { const path = `${work}/release-${n}`; await removeOwned(path, await hashFile(path, LIMITS.release)); }
    await checkedDirectory(work, 0, 0, 0o700); await fs.rmdir(work); await syncDirectory(dirname(work));
    // The journal is removed last. A lost receipt/journal ACK stays held until
    // read-only inspection resolves it; no retry occurs inside this function.
    await removeOwned(SERVER1_PG17.journal, digest(journalWire));
    return inspectServer1PreparedPostgres();
  } catch {
    // Preserve the exact phase journal and owned outputs for operator review.
    refuse('apply_unknown_or_incomplete_hold');
  }
}

export function parseServer1Pg17Arguments(args: readonly string[]): Readonly<{ mode: 'preflight' | 'apply'; approvedPinSha256?: string }> {
  if (!args.length || (args.length === 1 && args[0] === '--preflight')) return frozen({ mode: 'preflight' });
  if (args.length === 3 && args[0] === '--apply' && args[1] === '--pin-sha256' && SHA.test(args[2])) return frozen({ mode: 'apply', approvedPinSha256: args[2] });
  return refuse('arguments');
}
if (typeof import.meta.url === 'string' && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareServer1Postgres17(parseServer1Pg17Arguments(process.argv.slice(2))).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'server1_pg17_preparation_refused'}\n`); process.exitCode = 1; });
}

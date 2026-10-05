import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const registry = 'https://registry.modelcontextprotocol.io';
const officialMetadata = 'io.modelcontextprotocol.registry/official';

export function validateRelease(manifest, pkg, { version, repository, ref }) {
  assert.equal(repository, 'tang-vu/keryx', 'Publication requires the approved repository');
  assert.equal(ref, 'refs/heads/main', 'Publication requires main');
  assert.match(version ?? '', /^\d+\.\d+\.\d+$/, 'Expected a committed release version');
  assert.equal(pkg.name, 'keryx-mcp');
  assert.equal(pkg.version, version);
  assert.notEqual(pkg.private, true);
  assert.deepEqual(pkg.repository, { type: 'git', url: 'git+https://github.com/tang-vu/keryx.git', directory: 'mcp' });
  const namespace = `io.github.${repository.split('/')[0]}/keryx`;
  assert.equal(pkg.mcpName, namespace);
  assert.equal(manifest.name, namespace, 'Manifest namespace must belong to the OIDC repository owner');
  assert.equal(manifest.version, version);
  assert.deepEqual(Object.keys(manifest).sort(), ['$schema', 'description', 'name', 'packages', 'remotes', 'repository', 'version', 'websiteUrl'].sort());
  assert.equal(manifest.$schema, 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
  assert.ok(typeof manifest.description === 'string' && manifest.description.trim().length > 0);
  assert.equal(manifest.websiteUrl, 'https://keryx.cc');
  assert.deepEqual(manifest.repository, { url: 'https://github.com/tang-vu/keryx', source: 'github', subfolder: 'mcp' });
  assert.deepEqual(manifest.remotes, [{ type: 'streamable-http', url: 'https://keryx.cc/mcp' }]);
  assert.deepEqual(manifest.packages, [{
    registryType: 'npm', registryBaseUrl: 'https://registry.npmjs.org', identifier: pkg.name,
    version, transport: { type: 'stdio' },
  }]);
}

export function validateNpmReadback(published, packs, pkg) {
  assert.ok(Array.isArray(packs) && packs.length === 1, 'Expected one verified npm archive');
  const [pack] = packs;
  assert.equal(pack.name, pkg.name);
  assert.equal(pack.version, pkg.version);
  assert.equal(pack.filename, `${pkg.name}-${pkg.version}.tgz`);
  assert.match(pack.integrity ?? '', /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(published.name, pkg.name);
  assert.equal(published.version, pkg.version);
  assert.equal(published.mcpName, pkg.mcpName, 'Published npm package must prove the same MCP namespace');
  assert.deepEqual(published.repository, pkg.repository);
  assert.equal(published.dist?.integrity, pack.integrity, 'Published npm bytes must match the verified archive');
  assert.equal(published.dist?.tarball, `https://registry.npmjs.org/${pkg.name}/-/${pack.filename}`);
}

export function registryVersionUrl(manifest, version = manifest.version) {
  return `${registry}/v0.1/servers/${encodeURIComponent(manifest.name)}/versions/${encodeURIComponent(version)}`;
}

export function validateRegistryReadback(manifest, entry, requireLatest = false) {
  assert.deepEqual(entry?.server, manifest, 'Registry manifest must match the committed manifest exactly');
  assert.equal(entry._meta?.[officialMetadata]?.status, 'active', 'Registry entry must be active');
  if (requireLatest) assert.equal(entry._meta[officialMetadata].isLatest, true, 'Registry entry must be latest');
}

// Fixed public endpoints, finite response size and per-request deadline. No auth is
// sent on readback; a failed/unknown read never authorizes another publication.
async function readPublicJson(url, fetchImpl, label) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json' }, redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Read refused');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 262_144) throw new Error('Read too large');
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    // Only HTTP 404 means absent. A successful response containing null or an
    // unexpected JSON shape must never authorize an immutable publication.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Unexpected readback');
    return parsed;
  } catch {
    throw new Error(`${label} readback unavailable; do not republish`);
  }
}

export async function readOfficialEntry(url, fetchImpl = fetch) {
  assert.ok(url.startsWith(`${registry}/v0.1/servers/`));
  return readPublicJson(url, fetchImpl, 'Official MCP Registry');
}

export async function readNpmPackage(pkg, fetchImpl = fetch) {
  assert.equal(pkg.name, 'keryx-mcp');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  return readPublicJson(`https://registry.npmjs.org/${pkg.name}/${pkg.version}`, fetchImpl, 'Public npm registry');
}

export async function preflightNpm(pkg, packs, read = readNpmPackage) {
  const published = await read(pkg);
  if (published === null) return 'absent';
  validateNpmReadback(published, packs, pkg);
  return 'already-published';
}

export async function preflightRegistry(manifest, read = readOfficialEntry) {
  // Deleted versions still occupy an immutable version; include them so their
  // default public 404 can never be mistaken for permission to publish again.
  const entry = await read(`${registryVersionUrl(manifest)}?include_deleted=true`);
  if (entry === null) return 'absent';
  validateRegistryReadback(manifest, entry);
  return 'already-published';
}

export async function verifyRegistry(manifest, {
  read = readOfficialEntry,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 12,
} = {}) {
  assert.ok(Number.isInteger(attempts) && attempts >= 1 && attempts <= 12);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Retry public reads only. Publication is a separate, single workflow step.
    const [exact, latest] = await Promise.allSettled([
      read(registryVersionUrl(manifest)), read(registryVersionUrl(manifest, 'latest')),
    ]);
    if (exact.status === 'fulfilled' && exact.value !== null) {
      validateRegistryReadback(manifest, exact.value);
      if (latest.status === 'fulfilled' && latest.value?.server?.version === manifest.version) {
        validateRegistryReadback(manifest, latest.value, true);
        return;
      }
    }
    if (attempt < attempts) await sleep(5_000);
  }
  throw new Error('MCP Registry publication/readback remains unverified; inspect exact version before any further action. Do not republish.');
}

async function main() {
  const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const manifest = json('mcp/server.json');
  const pkg = json('mcp/package.json');
  validateRelease(manifest, pkg, {
    version: process.env.EXPECTED_VERSION,
    repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF,
  });
  switch (process.argv[2]) {
    case 'validate': break;
    case 'verify-npm': validateNpmReadback(json('published.json'), json('release/pack.json'), pkg); break;
    case 'preflight-npm': {
      const state = await preflightNpm(pkg, json('release/pack.json'));
      assert.ok(process.env.GITHUB_OUTPUT, 'Expected workflow output file');
      appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);
      break;
    }
    case 'preflight': {
      const state = await preflightRegistry(manifest);
      assert.ok(process.env.GITHUB_OUTPUT, 'Expected workflow output file');
      appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);
      break;
    }
    case 'verify': await verifyRegistry(manifest); break;
    default: throw new Error('Expected validate, preflight-npm, verify-npm, preflight or verify');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

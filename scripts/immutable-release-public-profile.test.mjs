import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAINNET_PUBLIC_BUILD_KEYS, MAINNET_ADDITIONAL_BUILD_KEYS, DISABLED_PUBLIC_BUILD_KEYS,
  mainnetPublicBuildProfile, mainnetPublicBuildProfileSha256, parseMainnetPublicBuildControls, mainnetPrivateHeaderDigest } from './immutable-release-public-profile.mjs';
import { REVIEWED_PUBLIC_BUILD_KEYS, reviewedPublicBuildProfileSha256, reviewedPrivateHeaderDigest } from './redeploy-reviewed-roles.mjs';

const origins = [
  { address: `0x${'2'.repeat(40)}`, codeHash: `0x${'b'.repeat(64)}`, deployBlock: '0', network: 'eip155:5042', version: 1 },
  { address: `0x${'1'.repeat(40)}`, codeHash: `0x${'a'.repeat(64)}`, deployBlock: '100', network: 'eip155:5042', version: 3 },
];
const profile = {
  NEXT_PUBLIC_CIRCLE_APP_ID: '00000000-0000-4000-8000-000000000001',
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: '123456789-synthetic.apps.googleusercontent.com',
  KERYX_REGISTRY_ADDRESS: `0x${'1'.repeat(40)}`, NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: `0x${'1'.repeat(40)}`,
  KERYX_REGISTRY_READ_ADDRESS: `0x${'1'.repeat(40)}`, NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS: `0x${'1'.repeat(40)}`,
  KERYX_RUN_PRIVACY_ENABLED: 'true', NEXT_PUBLIC_WC_PROJECT_ID: 'f'.repeat(32),
  KERYX_REGISTRY_VERSION: '3', NEXT_PUBLIC_KERYX_REGISTRY_VERSION: '3',
  KERYX_REGISTRY_ORIGINS: JSON.stringify(origins), NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS: JSON.stringify(origins),
  KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS: '1500000', NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS: '1500000',
};
const envBytes = (values = profile) => Buffer.from(Object.entries({ KERYX_NETWORK: 'arc', NEXT_PUBLIC_KERYX_NETWORK: 'arc', ...values })
  .map(([key, value]) => `${key}='${value}'`).join('\n') + '\n');

test('builder and standalone stdin authority bind identical public settings without exporting secrets', () => {
  assert.deepEqual(MAINNET_PUBLIC_BUILD_KEYS, REVIEWED_PUBLIC_BUILD_KEYS);
  const selected = mainnetPublicBuildProfile({ ...profile, PRIVATE_KEY: 'synthetic-secret', NODE_OPTIONS: '--import=unsafe' });
  assert.deepEqual(selected, profile);
  assert.equal(reviewedPublicBuildProfileSha256(envBytes()), mainnetPublicBuildProfileSha256(profile));
  assert.equal(reviewedPublicBuildProfileSha256(Buffer.concat([envBytes(), Buffer.from('PRIVATE_KEY=synthetic-secret\n')])), mainnetPublicBuildProfileSha256(profile));
  for (const key of MAINNET_PUBLIC_BUILD_KEYS) {
    const altered = { ...profile, [key]: profile[key] + 'changed' };
    if (key === 'KERYX_RUN_PRIVACY_ENABLED') assert.throws(() => reviewedPublicBuildProfileSha256(envBytes(altered)));
    else assert.notEqual(reviewedPublicBuildProfileSha256(envBytes(altered)), mainnetPublicBuildProfileSha256(profile));
  }
});

test('missing/mismatched authority, block window, wallet and privacy controls refuse before preparation', () => {
  for (const key of MAINNET_PUBLIC_BUILD_KEYS.filter(key => key !== 'NEXT_PUBLIC_WC_PROJECT_ID'))
    assert.throws(() => mainnetPublicBuildProfile({ ...profile, [key]: undefined }));
  for (const changes of [
    { KERYX_RUN_PRIVACY_ENABLED: 'false' }, { NEXT_PUBLIC_WC_PROJECT_ID: 'invalid' },
    { NEXT_PUBLIC_KERYX_REGISTRY_VERSION: '1' }, { KERYX_REGISTRY_VERSION: '4', NEXT_PUBLIC_KERYX_REGISTRY_VERSION: '4' },
    { NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS: '[]' }, { KERYX_REGISTRY_ORIGINS: '[]', NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS: '[]' },
    { NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS: '1500001' },
    { KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS: '9007199254740992', NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS: '9007199254740992' },
    { KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS: '0', NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS: '0' },
    ...DISABLED_PUBLIC_BUILD_KEYS.map(key => ({ [key]: 'unsupported-profile' })),
  ]) assert.throws(() => mainnetPublicBuildProfile({ ...profile, ...changes }));
  assert.equal(mainnetPublicBuildProfile({ ...profile, NEXT_PUBLIC_WC_PROJECT_ID: undefined }).NEXT_PUBLIC_WC_PROJECT_ID, '');
  for (const mutate of [a => a.push(a[0]), a => a[1].network = 'eip155:5042002', a => a[1].version = 1,
    a => a[1].extra = 'unreviewed', a => a[1].deployBlock = '-1', a => a[1].codeHash = 'invalid']) {
    const value = structuredClone(origins); mutate(value); const text = JSON.stringify(value);
    assert.throws(() => mainnetPublicBuildProfile({ ...profile, KERYX_REGISTRY_ORIGINS: text, NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS: text }));
  }
});

test('workflow JSON admits only the explicit public control keys', () => {
  const controls = Object.fromEntries(MAINNET_ADDITIONAL_BUILD_KEYS.map(key => [key, profile[key]]));
  assert.deepEqual(parseMainnetPublicBuildControls(JSON.stringify(controls)), controls);
  for (const value of [undefined, '', '{}', '[]', '{', 'x'.repeat(20001),
    JSON.stringify({ ...controls, NODE_OPTIONS: '--import=unsafe' }), JSON.stringify({ ...controls, PRIVATE_KEY: 'synthetic' }),
    JSON.stringify({ ...controls, KERYX_RUN_PRIVACY_ENABLED: true })]) assert.throws(() => parseMainnetPublicBuildControls(value));
});

test('actual compiled dispatch headers must match the private response policy in both inspectors', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-private-header-profile-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true }); });
  fs.mkdirSync(path.join(root, '.next'));
  const file = path.join(root, '.next', 'routes-manifest.json');
  const headers = [
    { key: 'Cache-Control', value: 'no-store' }, { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  ];
  const manifest = { headers: ['/dispatch/:path*', '/api/dispatch/:path*'].map(source => ({ source, headers })) };
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.equal(mainnetPrivateHeaderDigest(root), reviewedPrivateHeaderDigest(root));
  for (const mutate of [m => m.headers.pop(), m => m.headers.push(m.headers[0]),
    m => m.headers[0].headers[1].value = 'strict-origin-when-cross-origin', m => m.headers[1].headers.pop()]) {
    const altered = structuredClone(manifest); mutate(altered); fs.writeFileSync(file, JSON.stringify(altered));
    assert.throws(() => mainnetPrivateHeaderDigest(root)); assert.throws(() => reviewedPrivateHeaderDigest(root));
  }
});

test('literal public application configuration cannot silently escape build-profile classification', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const classified = new Set([...MAINNET_PUBLIC_BUILD_KEYS, ...DISABLED_PUBLIC_BUILD_KEYS, 'NEXT_PUBLIC_KERYX_NETWORK']);
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(file);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.test\./.test(entry.name))
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g))
          assert(classified.has(match[1]), `${path.relative(root, file)}: unclassified ${match[1]}`);
    }
  }
  for (const directory of ['app', 'components', 'lib']) inspect(path.join(root, directory));
});

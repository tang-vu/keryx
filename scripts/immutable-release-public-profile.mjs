import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const MAINNET_PUBLIC_BUILD_KEYS = Object.freeze([
  'NEXT_PUBLIC_CIRCLE_APP_ID', 'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
  'KERYX_REGISTRY_ADDRESS', 'NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS',
  'KERYX_REGISTRY_READ_ADDRESS', 'NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS',
  'KERYX_RUN_PRIVACY_ENABLED', 'NEXT_PUBLIC_WC_PROJECT_ID',
  'KERYX_REGISTRY_VERSION', 'NEXT_PUBLIC_KERYX_REGISTRY_VERSION',
  'KERYX_REGISTRY_ORIGINS', 'NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS',
  'KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS', 'NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS',
]);
export const MAINNET_ADDITIONAL_BUILD_KEYS = Object.freeze(MAINNET_PUBLIC_BUILD_KEYS.slice(6));
export const DISABLED_PUBLIC_BUILD_KEYS = Object.freeze([
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
]);
const refuse = () => { throw Error('Mainnet public build profile refused; no runtime authority granted.'); };
const digest = value => createHash('sha256').update(JSON.stringify(value) + '\n').digest('hex');

/** Explicit public compilation inputs; never forward the inherited environment. */
export function mainnetPublicBuildProfile(environment) {
  const profile = Object.fromEntries(MAINNET_PUBLIC_BUILD_KEYS.map(key =>
    [key, environment[key] ?? (key === 'NEXT_PUBLIC_WC_PROJECT_ID' ? '' : undefined)]));
  if (Object.values(profile).some(value => typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) ||
      DISABLED_PUBLIC_BUILD_KEYS.some(key => ![undefined, ''].includes(environment[key]))) refuse();
  if (!/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(profile.NEXT_PUBLIC_CIRCLE_APP_ID) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.apps\.googleusercontent\.com$/.test(profile.NEXT_PUBLIC_GOOGLE_CLIENT_ID) ||
      profile.KERYX_RUN_PRIVACY_ENABLED !== 'true' ||
      !/^(?:[a-fA-F0-9]{32})?$/.test(profile.NEXT_PUBLIC_WC_PROJECT_ID)) refuse();
  for (const key of ['KERYX_REGISTRY_ADDRESS', 'KERYX_REGISTRY_READ_ADDRESS']) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(profile[key]) || /^0x0{40}$/i.test(profile[key]) ||
        profile[key].toLowerCase() !== profile[`NEXT_PUBLIC_${key}`].toLowerCase()) refuse();
  }
  if (!/^[123]$/.test(profile.KERYX_REGISTRY_VERSION) ||
      profile.KERYX_REGISTRY_VERSION !== profile.NEXT_PUBLIC_KERYX_REGISTRY_VERSION ||
      !/^[1-9]\d{0,15}$/.test(profile.KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS) ||
      BigInt(profile.KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS) > BigInt(Number.MAX_SAFE_INTEGER) ||
      profile.KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS !== profile.NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS ||
      profile.KERYX_REGISTRY_ORIGINS.length > 8192 ||
      profile.KERYX_REGISTRY_ORIGINS !== profile.NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS) refuse();
  let origins;
  try { origins = JSON.parse(profile.KERYX_REGISTRY_ORIGINS); } catch { refuse(); }
  if (!Array.isArray(origins) || origins.length < 1 || origins.length > 4 ||
      JSON.stringify(origins) !== profile.KERYX_REGISTRY_ORIGINS) refuse();
  const seen = new Set();
  for (const origin of origins) {
    if (!origin || Object.keys(origin).sort().join('|') !== 'address|codeHash|deployBlock|network|version' ||
        origin.network !== 'eip155:5042' || ![1, 2, 3].includes(origin.version) ||
        typeof origin.address !== 'string' || origin.address.length !== 42 || !/^0x[0-9a-fA-F]{40}$/.test(origin.address) || /^0x0{40}$/i.test(origin.address) ||
        typeof origin.codeHash !== 'string' || origin.codeHash.length !== 66 || !/^0x[0-9a-fA-F]{64}$/.test(origin.codeHash) ||
        typeof origin.deployBlock !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(origin.deployBlock) || /\D/.test(origin.deployBlock) ||
        seen.has(origin.address.toLowerCase())) refuse();
    seen.add(origin.address.toLowerCase());
  }
  if (!origins.some(origin => origin.address.toLowerCase() === profile.KERYX_REGISTRY_ADDRESS.toLowerCase() &&
        origin.version === Number(profile.KERYX_REGISTRY_VERSION)) ||
      !seen.has(profile.KERYX_REGISTRY_READ_ADDRESS.toLowerCase())) refuse();
  return profile;
}
export function mainnetPublicBuildProfileSha256(environment) {
  return digest(mainnetPublicBuildProfile(environment));
}
/** A bounded JSON workflow input, never shell assignments or arbitrary ENV. */
export function parseMainnetPublicBuildControls(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 20000) refuse();
  let value;
  try { value = JSON.parse(text); } catch { refuse(); }
  if (!value || Array.isArray(value) ||
      Object.keys(value).sort().join('|') !== [...MAINNET_ADDITIONAL_BUILD_KEYS].sort().join('|') ||
      Object.values(value).some(item => typeof item !== 'string')) refuse();
  return value;
}

/** Inspect actual compiled output, not a successful-build boolean. */
export function mainnetPrivateHeaderDigest(source) {
  const file = path.join(source, '.next', 'routes-manifest.json');
  const stat = fs.lstatSync(file);
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
  return digest(rows);
}

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../lib/canonical-json';
import { verifyPublicPolicyExtension } from './server1-public-policy-renewal.mts';

const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const prior = {
  format: 'keryx-hosted-treasury-policy-v1', network: 'eip155:5042', origin: 'https://keryx.cc',
  storageIdentityDigest: '1'.repeat(64), signer: '0x' + '2'.repeat(40),
  expiresAtSeconds: 1800000000, lifetimeCapMicroUsdc: '500', queryCapMicroUsdc: '50',
};
const renewed = { ...prior, expiresAtSeconds: prior.expiresAtSeconds + 3600 };
const env = (policy: typeof prior, extra = 'PRIVATE_FIXTURE=original') => {
  const json = canonicalJson(policy);
  return Buffer.from(`KERYX_MAINNET_TREASURY_POLICY_JSON='${json}'\nKERYX_MAINNET_TREASURY_POLICY_DIGEST=${sha(json)}\n${extra}\n`);
};
function fixture(next = renewed, extra?: string) {
  const original = env(prior), active = env(next, extra);
  const binding = { commit: 'a'.repeat(40), rolesSha256: 'b'.repeat(64),
    originalEnvironmentSha256: sha(original), originalPolicySha256: sha(canonicalJson(prior)) };
  const authorization = { format: 'keryx-public-policy-expiry-authorization-v1', ...binding,
    expiresAtSeconds: next.expiresAtSeconds, renewedPolicySha256: sha(canonicalJson(next)), renewedEnvironmentSha256: sha(active) };
  return { ...binding, original, active, authorization, nowSeconds: prior.expiresAtSeconds + 1 };
}

describe('expiry-only public treasury authorization', () => {
  it('recognizes an exact protected successor of the reviewed ENV', () => {
    expect(verifyPublicPolicyExtension(fixture())).toEqual({
      expiresAtSeconds: renewed.expiresAtSeconds, policySha256: sha(canonicalJson(renewed)),
    });
  });
  it.each([
    { lifetimeCapMicroUsdc: '501' }, { queryCapMicroUsdc: '51' },
    { signer: '0x' + '3'.repeat(40) }, { storageIdentityDigest: '4'.repeat(64) },
    { origin: 'https://example.com' }, { expiresAtSeconds: prior.expiresAtSeconds },
  ])('refuses a changed authorization scope or non-extension', delta => {
    expect(() => verifyPublicPolicyExtension(fixture({ ...renewed, ...delta }))).toThrow('authorization refused');
  });
  it('refuses unrelated ENV edits even with a matching successor hash', () => {
    expect(() => verifyPublicPolicyExtension(fixture(renewed, 'PRIVATE_FIXTURE=changed'))).toThrow('authorization refused');
  });
  it('requires the live release binding, exact bytes and an unexpired successor', () => {
    const f = fixture();
    for (const input of [{ ...f, rolesSha256: 'c'.repeat(64) }, { ...f, active: f.original },
      { ...f, original: f.active }, { ...f, nowSeconds: renewed.expiresAtSeconds },
      { ...f, authorization: { ...f.authorization, extra: true } }]) {
      expect(() => verifyPublicPolicyExtension(input)).toThrow('authorization refused');
    }
  });
});

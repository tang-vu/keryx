import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { canonicalJson } from '../../lib/canonical-json';
import { hostedTreasuryPolicyDigest, hostedTreasuryPolicySchema } from '../../lib/payments/hosted-treasury-policy';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const authorizationSchema = z.object({
  format: z.literal('keryx-public-policy-expiry-authorization-v1'),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  rolesSha256: digest,
  originalEnvironmentSha256: digest,
  renewedEnvironmentSha256: digest,
  originalPolicySha256: digest,
  renewedPolicySha256: digest,
  expiresAtSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const policyKey = 'KERYX_MAINNET_TREASURY_POLICY_JSON';
const digestKey = 'KERYX_MAINNET_TREASURY_POLICY_DIGEST';
const refuse = () => { throw new Error('Public treasury expiry authorization refused'); };

/** The protected authorization names the exact successor. The original reviewed
 * ENV supplies every byte, including private configuration. Never return ENV or
 * include its values in an exception. The caller owns protected file reads. */
export function verifyPublicPolicyExtension(input: {
  authorization: unknown;
  original: Buffer;
  active: Buffer;
  commit: string;
  rolesSha256: string;
  originalEnvironmentSha256: string;
  originalPolicySha256: string;
  nowSeconds: number;
}) {
  try {
    const a = authorizationSchema.parse(input.authorization);
    assert(a.commit === input.commit && a.rolesSha256 === input.rolesSha256);
    assert(a.originalEnvironmentSha256 === input.originalEnvironmentSha256);
    assert(a.originalPolicySha256 === input.originalPolicySha256);
    assert(sha(input.original) === a.originalEnvironmentSha256 && sha(input.active) === a.renewedEnvironmentSha256);
    const originalText = input.original.toString('utf8');
    assert(Buffer.from(originalText).equals(input.original));
    const originalEnv = parseEnv(originalText);
    const previous = hostedTreasuryPolicySchema.parse(JSON.parse(originalEnv[policyKey] ?? ''));
    const previousJson = canonicalJson(previous);
    assert(originalEnv[policyKey] === previousJson && originalEnv[digestKey] === a.originalPolicySha256);
    assert(hostedTreasuryPolicyDigest(previous) === a.originalPolicySha256);
    assert(Number.isSafeInteger(input.nowSeconds) && a.expiresAtSeconds > input.nowSeconds);
    assert(a.expiresAtSeconds > previous.expiresAtSeconds);
    const renewed = { ...previous, expiresAtSeconds: a.expiresAtSeconds };
    const renewedJson = canonicalJson(renewed);
    assert(hostedTreasuryPolicyDigest(renewed) === a.renewedPolicySha256);
    let expected = originalText;
    for (const [before, after] of [[previousJson, renewedJson], [a.originalPolicySha256, a.renewedPolicySha256]]) {
      const at = expected.indexOf(before);
      assert(at >= 0 && expected.indexOf(before, at + before.length) === -1);
      expected = expected.slice(0, at) + after + expected.slice(at + before.length);
    }
    assert(Buffer.from(expected).equals(input.active));
    const active = parseEnv(expected);
    assert(active[policyKey] === renewedJson && active[digestKey] === a.renewedPolicySha256);
    return Object.freeze({ policySha256: a.renewedPolicySha256, expiresAtSeconds: a.expiresAtSeconds });
  } catch {
    return refuse();
  }
}

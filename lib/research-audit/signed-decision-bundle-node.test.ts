import { generateKeyPairSync } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ACTUAL_READ_POLICY } from "./actual-read-policy";
import { canonicalSignedDecisionBundle, verifySignedDecisionBundle } from "./signed-decision-bundle";
import { decisionAuditTrustAnchorFromPem, signDecisionBundle } from "./signed-decision-bundle-node";

function fixture() {
  return { schema: 1, policy: ACTUAL_READ_POLICY, coverage: "post-portfolio-checkpoints", monetaryAuthority: "qualified-assertions-only",
    records: [{ sequence: 0, candidate: 1, round: 0, proposal: "BUY", plan: "BUY", facts: "assertions",
      check: { kind: "channel", creatorFree: false, cache: false }, outcome: { action: "BUY", rule: "delivery-channel" },
      amounts: { priceMicros: null, remainingMicros: null } }] };
}
const pair = generateKeyPairSync("ed25519"), signingKeyPem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString(), exportedAt = "2026-10-12T12:00:00.000Z";

it("derives a public SHA256 SPKI fingerprint and deterministic detached signature with no private key in export", async () => {
  const trusted = decisionAuditTrustAnchorFromPem(publicKeyPem), packet = fixture();
  expect(trusted.keyId).toMatch(/^sha256:[a-f0-9]{64}$/);
  const first = await signDecisionBundle(packet, { signingKeyPem, keyId: trusted.keyId, exportedAt });
  const second = await signDecisionBundle(packet, { signingKeyPem, exportedAt });
  expect(canonicalSignedDecisionBundle(first)).toBe(canonicalSignedDecisionBundle(second));
  expect(await verifySignedDecisionBundle(first, trusted)).toMatchObject({ verified: true });
  expect(first.envelope.reportDigest).toBeNull();
  expect(canonicalSignedDecisionBundle(first)).not.toContain(signingKeyPem);
  expect(decisionAuditTrustAnchorFromPem(publicKeyPem, trusted.keyId)).toEqual(trusted);
  expect(() => decisionAuditTrustAnchorFromPem(publicKeyPem, `sha256:${"0".repeat(64)}`)).toThrow("Decision audit refused the public key");
});

it("refuses missing, malformed, oversized, public-only, encrypted and non-Ed25519 signing keys without error context", async () => {
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  for (const invalid of ["", "PRIVATE_SENTINEL", "a".repeat(8193), publicKeyPem,
    signingKeyPem.replaceAll("PRIVATE KEY", "ENCRYPTED PRIVATE KEY"), ec.privateKey.export({ format: "pem", type: "pkcs8" }).toString()]) {
    await expect(signDecisionBundle(fixture(), { signingKeyPem: invalid })).rejects.toThrow("Decision audit refused the signing input");
    try { await signDecisionBundle(fixture(), { signingKeyPem: invalid }); }
    catch (error) { expect(String(error)).not.toContain(invalid.length < 30 ? "PRIVATE_SENTINEL" : invalid); }
  }
  expect(() => decisionAuditTrustAnchorFromPem(ec.publicKey.export({ format: "pem", type: "spki" }).toString())).toThrow("Decision audit refused the public key");
  expect(() => decisionAuditTrustAnchorFromPem(signingKeyPem)).toThrow("Decision audit refused the public key");
});

it("refuses arbitrary key labels, invalid export metadata and unexpected signing fields", async () => {
  const options = [
    { keyId: "audit-2026" }, { keyId: `sha256:${"0".repeat(64)}` }, { exportedAt: "2026-10-12" },
    { reportDigest: "x" }, { reportDigest: undefined }, { exportedAt: undefined }, { paymentKey: signingKeyPem },
  ];
  for (const patch of options) await expect(signDecisionBundle(fixture(), { signingKeyPem, exportedAt, ...patch } as never))
    .rejects.toThrow("Decision audit refused the signing input");
});

it("copies the packet and rejects asynchronous mutation or accessor signing inputs without exposing secrets", async () => {
  const packet = fixture(), mutable = fixture(), pending = signDecisionBundle(mutable, { signingKeyPem, exportedAt });
  mutable.records[0].candidate = 2;
  await expect(pending).rejects.toThrow("Decision audit refused the signing input");
  const options = { signingKeyPem, exportedAt }, second = signDecisionBundle(packet, options);
  options.exportedAt = "2026-10-13T12:00:00.000Z";
  await expect(second).rejects.toThrow("Decision audit refused the signing input");
  const prototypeOptions = { signingKeyPem, exportedAt }, prototypePending = signDecisionBundle(packet, prototypeOptions);
  Object.setPrototypeOf(prototypeOptions, { privateContext: "PRIVATE_SENTINEL" });
  await expect(prototypePending).rejects.toThrow("Decision audit refused the signing input");
  const getter = vi.fn(() => signingKeyPem), accessors = { signingKeyPem, exportedAt };
  Object.defineProperty(accessors, "signingKeyPem", { get: getter });
  await expect(signDecisionBundle(packet, accessors)).rejects.toThrow("Decision audit refused the signing input");
  expect(getter).not.toHaveBeenCalled();
  const signed = await signDecisionBundle(packet, { signingKeyPem, exportedAt });
  packet.records[0].candidate = 5;
  expect(signed.packet.records[0].candidate).toBe(1);
});

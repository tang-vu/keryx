import { generateKeyPairSync } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ACTUAL_READ_POLICY } from "./actual-read-policy";
import { actualReadPacketHash, type ActualReadPacketV1 } from "./actual-read-record";
import { optimizerPacketFixture } from "./optimizer-checkpoint.test-fixture";
import { economicPacketFixture } from "./economic-checkpoint.test-fixture";
import { canonicalSignedDecisionBundle, decisionAuditTrustAnchor, verifySignedDecisionBundle, type SignedDecisionBundle } from "./signed-decision-bundle";
import { decisionAuditTrustAnchorFromPem, signDecisionBundle } from "./signed-decision-bundle-node";

const exportedAt = "2026-10-12T12:00:00.000Z", reportDigest = "a".repeat(64);
function fixture(): ActualReadPacketV1 {
  return { schema: 1, policy: ACTUAL_READ_POLICY, coverage: "post-portfolio-checkpoints", monetaryAuthority: "qualified-assertions-only",
    records: [{ sequence: 0, candidate: 1, round: 0, proposal: "BUY", plan: "BUY", facts: "assertions",
      check: { kind: "channel", creatorFree: false, cache: false }, outcome: { action: "BUY", rule: "delivery-channel" },
      amounts: { priceMicros: "2", remainingMicros: "30000" } }] };
}
function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { signingKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    anchor: decisionAuditTrustAnchorFromPem(publicKey.export({ format: "pem", type: "spki" }).toString()) };
}
async function signed() {
  const key = keys(), packet = fixture();
  return { key, bundle: await signDecisionBundle(packet, { signingKeyPem: key.signingKeyPem, exportedAt, reportDigest }) };
}

it("binds a closed canonical snapshot, packet schema/digest, report digest, purpose, UTC time and external Ed25519 key", async () => {
  const { key, bundle } = await signed(), expectedPacketDigest = await actualReadPacketHash(fixture());
  expect(bundle.envelope).toMatchObject({ schema: 1, purpose: "keryx-decision-audit", algorithm: "Ed25519", packetSchema: 1,
    packetDigest: expectedPacketDigest, reportDigest, exportedAt, keyId: key.anchor.keyId });
  expect(await decisionAuditTrustAnchor(key.anchor.publicKeySpki)).toEqual(key.anchor);
  expect(await verifySignedDecisionBundle(bundle, key.anchor, { expectedPacketDigest, expectedReportDigest: reportDigest }))
    .toEqual({ verified: true, envelope: bundle.envelope });
  const reordered = Object.fromEntries(Object.entries(bundle).reverse());
  expect(canonicalSignedDecisionBundle(reordered)).toBe(canonicalSignedDecisionBundle(bundle));
  expect(await verifySignedDecisionBundle(reordered, key.anchor)).toMatchObject({ verified: true });
  expect(canonicalSignedDecisionBundle(bundle)).not.toContain("PRIVATE KEY");
});

it("retains exact schema2/3/4 canonical digest rather than creating a competing record policy", async () => {
  const key = keys(), v3 = optimizerPacketFixture().packet, v4 = economicPacketFixture().packet;
  const v2 = { schema: 2, policy: "ordinary-read-capture-v2", coverage: "normalization-and-read-checkpoints", monetaryAuthority: "qualified-assertions-only",
    records: [], mappings: [], normalizations: [], portfolio: null,
    stops: [{ afterCheckpoint: 0, stage: "discovery", count: 0, action: "STOP" }], observations: { actions: [], citations: [], payments: [] } };
  for (const packet of [v2, v3, v4]) {
    const bundle = await signDecisionBundle(packet, { signingKeyPem: key.signingKeyPem, exportedAt });
    expect(bundle.envelope.packetSchema).toBe(packet.schema);
    expect(bundle.envelope.packetDigest).toBe(await actualReadPacketHash(packet));
    expect(await verifySignedDecisionBundle(bundle, key.anchor)).toMatchObject({ verified: true });
  }
});

it("binds v4 economics and refuses changed schema or economic outcomes with the retained signature", async () => {
  const key = keys(), packet = economicPacketFixture().packet;
  const bundle = await signDecisionBundle(packet, { signingKeyPem: key.signingKeyPem, exportedAt });
  const before = canonicalSignedDecisionBundle(bundle);
  expect(await verifySignedDecisionBundle(bundle, key.anchor)).toMatchObject({ verified: true });
  const changed = structuredClone(bundle);
  if (changed.packet.schema !== 4 || changed.packet.economics.status !== "available") throw Error("Missing v4 economics");
  const record = changed.packet.economics.records[0];
  if (record.status !== "available" || record.kind !== "query-budget") throw Error("Missing query budget");
  record.outcome.afterMicros = "2";
  expect(await verifySignedDecisionBundle(changed, key.anchor)).toEqual({ verified: false });
  expect(await verifySignedDecisionBundle({ ...bundle, envelope: { ...bundle.envelope, packetSchema: 3 } }, key.anchor))
    .toEqual({ verified: false });
  expect(canonicalSignedDecisionBundle(bundle)).toBe(before);
});

it("requires the external trust anchor, checks fingerprints and permits only externally selected key rotation", async () => {
  const { key, bundle } = await signed(), rotated = keys();
  expect(await verifySignedDecisionBundle(bundle, undefined as never)).toEqual({ verified: false });
  expect(await verifySignedDecisionBundle(bundle, rotated.anchor)).toEqual({ verified: false });
  expect(await verifySignedDecisionBundle(bundle, { ...key.anchor, keyId: rotated.anchor.keyId })).toEqual({ verified: false });
  const rotatedBundle = await signDecisionBundle(fixture(), { signingKeyPem: rotated.signingKeyPem, exportedAt });
  expect(await verifySignedDecisionBundle(rotatedBundle, key.anchor)).toEqual({ verified: false });
  expect(await verifySignedDecisionBundle(rotatedBundle, rotated.anchor)).toMatchObject({ verified: true });
  const replaced = { ...bundle, publicKeySpki: rotatedBundle.publicKeySpki, signature: rotatedBundle.signature, envelope: rotatedBundle.envelope };
  expect(await verifySignedDecisionBundle(replaced, key.anchor)).toEqual({ verified: false });
});

it("rejects changed metadata, canonical packet, forged digest, detached signature and independently retained expectations", async () => {
  const { key, bundle } = await signed();
  const patches = [
    { schema: 2 }, { purpose: "another-purpose" }, { algorithm: "ECDSA" }, { packetSchema: 2 },
    { keyId: `sha256:${"b".repeat(64)}` }, { packetDigest: "b".repeat(64) }, { reportDigest: "b".repeat(64) },
    { exportedAt: "2026-10-13T12:00:00.000Z" }, { exportedAt: "2026-10-12T12:00:00Z" },
    { exportedAt: "2026-02-30T12:00:00.000Z" }, { exportedAt: "2026-10-12T12:00:00.000+00:00" },
  ];
  for (const patch of patches) expect(await verifySignedDecisionBundle({ ...bundle, envelope: { ...bundle.envelope, ...patch } }, key.anchor)).toEqual({ verified: false });
  const changed = structuredClone(bundle);
  changed.packet.records[0].amounts.priceMicros = "3";
  expect(await verifySignedDecisionBundle(changed, key.anchor)).toEqual({ verified: false });
  changed.envelope.packetDigest = await actualReadPacketHash(changed.packet);
  expect(await verifySignedDecisionBundle(changed, key.anchor)).toEqual({ verified: false });
  const first = bundle.signature[0] === "A" ? "B" : "A";
  expect(await verifySignedDecisionBundle({ ...bundle, signature: first + bundle.signature.slice(1) }, key.anchor)).toEqual({ verified: false });
  expect(await verifySignedDecisionBundle(bundle, key.anchor, { expectedPacketDigest: "b".repeat(64) })).toEqual({ verified: false });
  expect(await verifySignedDecisionBundle(bundle, key.anchor, { expectedReportDigest: "b".repeat(64) })).toEqual({ verified: false });
  expect(await verifySignedDecisionBundle(bundle, key.anchor, { expectedReportDigest: null })).toEqual({ verified: false });
});

it("rejects unknown/private fields, array holes, excessive capture, unsupported versions and truncated/noncanonical encodings", async () => {
  const { key, bundle } = await signed();
  const malformed: unknown[] = [
    { ...bundle, question: "PRIVATE_SENTINEL" }, { ...bundle, envelope: { ...bundle.envelope, question: "PRIVATE_SENTINEL" } },
    { ...bundle, packet: { ...bundle.packet, question: "PRIVATE_SENTINEL" } }, { ...bundle, schema: 2 },
    { ...bundle, packet: { ...bundle.packet, schema: 4 } },
    { ...bundle, packet: { ...bundle.packet, records: Array(1) } },
    { ...bundle, packet: { ...bundle.packet, records: Array(257).fill(bundle.packet.records[0]) } },
    { ...bundle, signature: bundle.signature.slice(0, -1) }, { ...bundle, signature: bundle.signature + "=" },
    { ...bundle, publicKeySpki: bundle.publicKeySpki.slice(0, -1) }, { ...bundle, publicKeySpki: "A".repeat(59) },
    { ...bundle, envelope: { ...bundle.envelope, keyId: "audit-2026" } },
  ];
  for (const value of malformed) expect(await verifySignedDecisionBundle(value, key.anchor)).toEqual({ verified: false });
  expect(await verifySignedDecisionBundle(bundle, { ...key.anchor, privateKey: "PRIVATE_SENTINEL" } as never)).toEqual({ verified: false });
  expect(await verifySignedDecisionBundle(bundle, key.anchor, { unknown: true } as never)).toEqual({ verified: false });
  const sparse = structuredClone(bundle); delete sparse.packet.records[0];
  expect(await verifySignedDecisionBundle(sparse, key.anchor)).toEqual({ verified: false });
});

it("does not invoke accessors or coercion when rejecting untrusted bundle, anchors or expectations", async () => {
  const { key, bundle } = await signed(), getter = vi.fn(() => bundle.signature);
  const accessor = { ...bundle }; Object.defineProperty(accessor, "signature", { get: getter });
  expect(await verifySignedDecisionBundle(accessor, key.anchor)).toEqual({ verified: false });
  const trusted = { ...key.anchor }; Object.defineProperty(trusted, "keyId", { get: getter });
  expect(await verifySignedDecisionBundle(bundle, trusted)).toEqual({ verified: false });
  const expected = {}; Object.defineProperty(expected, "expectedPacketDigest", { get: getter });
  expect(await verifySignedDecisionBundle(bundle, key.anchor, expected)).toEqual({ verified: false });
  expect(await verifySignedDecisionBundle(bundle, key.anchor, { expectedPacketDigest: { toString: getter } } as never)).toEqual({ verified: false });
  expect(getter).not.toHaveBeenCalled();
});

it("rejects mutation across Web Crypto awaits for the bundle, external anchor and separately retained report digest", async () => {
  const { key, bundle } = await signed();
  const mutable = structuredClone(bundle), first = verifySignedDecisionBundle(mutable, key.anchor);
  mutable.envelope.exportedAt = "2026-10-13T12:00:00.000Z";
  expect(await first).toEqual({ verified: false });
  const trusted = { ...key.anchor }, second = verifySignedDecisionBundle(bundle, trusted);
  trusted.keyId = `sha256:${"b".repeat(64)}`;
  expect(await second).toEqual({ verified: false });
  const expected = { expectedReportDigest: reportDigest }, third = verifySignedDecisionBundle(bundle, key.anchor, expected);
  expected.expectedReportDigest = "b".repeat(64);
  expect(await third).toEqual({ verified: false });
});

it("fails closed when Web Crypto or Ed25519 verification is unavailable", async () => {
  const { key, bundle } = await signed();
  vi.stubGlobal("crypto", undefined);
  try { expect(await verifySignedDecisionBundle(bundle, key.anchor)).toEqual({ verified: false }); }
  finally { vi.unstubAllGlobals(); }
});

it("keeps signature success separate from signed source/settlement assertions", async () => {
  const key = keys(), packet = optimizerPacketFixture().packet;
  packet.observations.payments = [{ candidate: 1, kind: "citation", amount: "0.000001", amountMicros: "1", status: "simulated", settled: true }];
  const bundle: SignedDecisionBundle = await signDecisionBundle(packet, { signingKeyPem: key.signingKeyPem, exportedAt: "2000-01-01T00:00:00.000Z" });
  expect(await verifySignedDecisionBundle(bundle, key.anchor)).toMatchObject({ verified: true });
  expect(bundle.packet.schema === 3 && bundle.packet.observations.payments[0]).toMatchObject({ status: "simulated", settled: true });
  expect(bundle.envelope.exportedAt).toBe("2000-01-01T00:00:00.000Z");
});

/** Explicit audit-key signing only. Never imports app configuration, payment keys or storage. */
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { checkpointData } from "./actual-read-policy";
import { actualReadPacketHash, canonicalReadPacket, type ActualReadPacket } from "./actual-read-record";
import { canonicalDecisionAuditEnvelope, canonicalSignedDecisionBundle, DECISION_AUDIT_PURPOSE,
  type DecisionAuditEnvelope, type DecisionAuditTrustAnchor, type SignedDecisionBundle } from "./signed-decision-bundle";

export interface SignDecisionBundleOptions {
  signingKeyPem: string; keyId?: string; exportedAt?: string; reportDigest?: string | null;
}
const MAX_PEM_BYTES = 8192;
function pem(value: unknown, privateKey: boolean): asserts value is string {
  const label = privateKey ? "PRIVATE KEY" : "PUBLIC KEY";
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_PEM_BYTES ||
      !new RegExp(`^-----BEGIN ${label}-----\\r?\\n[A-Za-z0-9+/=\\r\\n]+-----END ${label}-----\\r?\\n?$`).test(value))
    throw Error("Invalid audit key");
}
function publicAnchor(publicKeyPem: string): DecisionAuditTrustAnchor {
  pem(publicKeyPem, false);
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw Error("Invalid audit key");
  const encoded = key.export({ format: "der", type: "spki" });
  return { keyId: `sha256:${createHash("sha256").update(encoded).digest("hex")}`, publicKeySpki: encoded.toString("base64url") };
}
export function decisionAuditTrustAnchorFromPem(publicKeyPem: string, expectedKeyId?: string): DecisionAuditTrustAnchor {
  try {
    const trusted = publicAnchor(publicKeyPem);
    if (expectedKeyId !== undefined && expectedKeyId !== trusted.keyId) throw Error("Audit key ID disagreement");
    return trusted;
  } catch { throw Error("Decision audit refused the public key"); }
}

/** Caller provides a separate audit Ed25519 PKCS8 PEM; no keys are generated or persisted. */
export async function signDecisionBundle(packet: unknown, options: SignDecisionBundleOptions): Promise<SignedDecisionBundle> {
  try {
    const names = Reflect.ownKeys(options);
    if (names.some(name => !["signingKeyPem", "keyId", "exportedAt", "reportDigest"].includes(name as string))) throw Error("Invalid signing options");
    const row = checkpointData(options, names as string[]);
    pem(row.signingKeyPem, true);
    const privateKey = createPrivateKey(row.signingKeyPem);
    if (privateKey.asymmetricKeyType !== "ed25519") throw Error("Invalid audit key");
    const trusted = publicAnchor(createPublicKey(privateKey).export({ format: "pem", type: "spki" }).toString());
    if (Object.hasOwn(row, "keyId") && row.keyId !== trusted.keyId) throw Error("Audit key ID disagreement");
    const canonicalPacket = canonicalReadPacket(packet), snapshot = JSON.parse(canonicalPacket) as ActualReadPacket;
    const attestation = { schema: 1, purpose: DECISION_AUDIT_PURPOSE, algorithm: "Ed25519", keyId: trusted.keyId,
      packetSchema: snapshot.schema, packetDigest: await actualReadPacketHash(snapshot),
      reportDigest: Object.hasOwn(row, "reportDigest") ? row.reportDigest : null,
      exportedAt: Object.hasOwn(row, "exportedAt") ? row.exportedAt : new Date().toISOString() } as DecisionAuditEnvelope;
    const payload = canonicalDecisionAuditEnvelope(attestation);
    const signature = sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64url");
    const bundle = { schema: 1, envelope: attestation, packet: snapshot, publicKeySpki: trusted.publicKeySpki, signature } as SignedDecisionBundle;
    const canonicalBundle = canonicalSignedDecisionBundle(bundle);
    const current = checkpointData(options, names as string[]);
    if (canonicalReadPacket(packet) !== canonicalPacket ||
        names.some(name => current[name as string] !== row[name as string])) throw Error("Signing input changed");
    return JSON.parse(canonicalBundle) as SignedDecisionBundle;
  } catch { throw Error("Decision audit refused the signing input"); }
}

import { checkpointData } from "./actual-read-policy";
import { actualReadPacketHash, canonicalReadPacket, MAX_READ_PACKET_BYTES, type ActualReadPacket } from "./actual-read-record";

export const DECISION_AUDIT_PURPOSE = "keryx-decision-audit" as const;
export const MAX_SIGNED_DECISION_BUNDLE_BYTES = MAX_READ_PACKET_BYTES + 4096;
const SPKI_PREFIX = [48, 42, 48, 5, 6, 3, 43, 101, 112, 3, 33, 0];
const DIGEST = /^[a-f0-9]{64}$/;

/** A signed EXPORT snapshot. The timestamp and recorded facts remain signer assertions. */
export interface DecisionAuditEnvelope {
  schema: 1; purpose: typeof DECISION_AUDIT_PURPOSE; algorithm: "Ed25519";
  keyId: string; packetSchema: 1 | 2 | 3; packetDigest: string;
  reportDigest: string | null; exportedAt: string;
}
export interface DecisionAuditTrustAnchor { keyId: string; publicKeySpki: string }
export interface SignedDecisionBundle {
  schema: 1; envelope: DecisionAuditEnvelope; packet: ActualReadPacket;
  /** A public hint only. Verification REQUIRES a separately supplied trust anchor. */
  publicKeySpki: string; signature: string;
}
export interface SignedDecisionVerifyOptions {
  expectedPacketDigest?: string;
  /** A report digest is checked only against an independently retained expected digest. */
  expectedReportDigest?: string | null;
}
export type SignedDecisionVerification = { verified: true; envelope: DecisionAuditEnvelope } | { verified: false };

function bytes(value: unknown, length: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length !== Math.ceil(length * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value))
    throw Error("Invalid audit encoding");
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4));
  const result = Uint8Array.from(decoded, character => character.charCodeAt(0));
  if (result.length !== length || btoa(decoded).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") !== value)
    throw Error("Invalid audit encoding");
  return result;
}
function spki(value: unknown): Uint8Array<ArrayBuffer> {
  const result = bytes(value, 44);
  if (SPKI_PREFIX.some((byte, index) => result[index] !== byte)) throw Error("Invalid audit public key");
  return result;
}
function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function digest(value: unknown): asserts value is string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw Error("Invalid audit digest");
}
function keyId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) throw Error("Invalid audit key ID");
}
function envelope(value: unknown): DecisionAuditEnvelope {
  const row = checkpointData(value, ["schema", "purpose", "algorithm", "keyId", "packetSchema", "packetDigest", "reportDigest", "exportedAt"]);
  if (row.schema !== 1 || row.purpose !== DECISION_AUDIT_PURPOSE || row.algorithm !== "Ed25519" ||
      ![1, 2, 3].includes(row.packetSchema as number)) throw Error("Unsupported audit envelope");
  keyId(row.keyId); digest(row.packetDigest); if (row.reportDigest !== null) digest(row.reportDigest);
  if (typeof row.exportedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.exportedAt) ||
      new Date(row.exportedAt).toISOString() !== row.exportedAt) throw Error("Invalid audit timestamp");
  return row as unknown as DecisionAuditEnvelope;
}
function anchor(value: unknown): DecisionAuditTrustAnchor {
  const row = checkpointData(value, ["keyId", "publicKeySpki"]);
  keyId(row.keyId); spki(row.publicKeySpki);
  return row as unknown as DecisionAuditTrustAnchor;
}
function verifyOptions(value: unknown): SignedDecisionVerifyOptions {
  if (!value || typeof value !== "object") throw Error("Invalid audit verification options");
  const names = Reflect.ownKeys(value);
  if (names.some(name => name !== "expectedPacketDigest" && name !== "expectedReportDigest")) throw Error("Invalid audit verification options");
  const row = checkpointData(value, names as string[]);
  if (Object.hasOwn(row, "expectedPacketDigest")) digest(row.expectedPacketDigest);
  if (Object.hasOwn(row, "expectedReportDigest") && row.expectedReportDigest !== null) digest(row.expectedReportDigest);
  return row as SignedDecisionVerifyOptions;
}

export function canonicalDecisionAuditEnvelope(value: unknown): string { return JSON.stringify(envelope(value)); }

/** Closed grammar, fixed ordering and original v1/v2/v3 packet canonicalization. */
export function canonicalSignedDecisionBundle(value: unknown): string {
  const row = checkpointData(value, ["schema", "envelope", "packet", "publicKeySpki", "signature"]);
  if (row.schema !== 1) throw Error("Unsupported audit bundle");
  const attestation = envelope(row.envelope), packet = JSON.parse(canonicalReadPacket(row.packet)) as ActualReadPacket;
  if (attestation.packetSchema !== packet.schema) throw Error("Audit packet schema disagreement");
  spki(row.publicKeySpki); bytes(row.signature, 64);
  const canonical = JSON.stringify({ schema: 1, envelope: attestation, packet, publicKeySpki: row.publicKeySpki, signature: row.signature });
  if (new TextEncoder().encode(canonical).byteLength > MAX_SIGNED_DECISION_BUNDLE_BYTES) throw Error("Oversized audit bundle");
  return canonical;
}

/** Derives an anchor fingerprint from a PUBLIC key supplied outside the bundle. */
export async function decisionAuditTrustAnchor(publicKeySpki: string): Promise<DecisionAuditTrustAnchor> {
  const encoded = spki(publicKeySpki);
  const fingerprint = hex(await globalThis.crypto.subtle.digest("SHA-256", encoded));
  return { keyId: `sha256:${fingerprint}`, publicKeySpki };
}

/**
 * Offline signature/integrity verification. An embedded key cannot authorize itself.
 * Success proves neither settlement, truth, completeness nor an independent timestamp.
 * reportDigest binds a claim about a separately retained report; this bundle has no report body.
 */
export async function verifySignedDecisionBundle(value: unknown, trustedKey: DecisionAuditTrustAnchor,
  options: SignedDecisionVerifyOptions = {}): Promise<SignedDecisionVerification> {
  try {
    const canonical = canonicalSignedDecisionBundle(value), bundle = JSON.parse(canonical) as SignedDecisionBundle;
    const trusted = anchor(trustedKey), expected = verifyOptions(options);
    if (bundle.envelope.keyId !== trusted.keyId || bundle.publicKeySpki !== trusted.publicKeySpki ||
        Object.hasOwn(expected, "expectedPacketDigest") && bundle.envelope.packetDigest !== expected.expectedPacketDigest ||
        Object.hasOwn(expected, "expectedReportDigest") && bundle.envelope.reportDigest !== expected.expectedReportDigest) return { verified: false };
    const actualAnchor = await decisionAuditTrustAnchor(trusted.publicKeySpki);
    if (actualAnchor.keyId !== trusted.keyId || await actualReadPacketHash(bundle.packet) !== bundle.envelope.packetDigest) return { verified: false };
    const publicKey = await globalThis.crypto.subtle.importKey("spki", spki(trusted.publicKeySpki), { name: "Ed25519" }, false, ["verify"]);
    const verified = await globalThis.crypto.subtle.verify("Ed25519", publicKey, bytes(bundle.signature, 64),
      new TextEncoder().encode(canonicalDecisionAuditEnvelope(bundle.envelope)));
    // Reject input changes during Web Crypto awaits, including separately supplied anchor/options.
    if (!verified || canonicalSignedDecisionBundle(value) !== canonical || JSON.stringify(anchor(trustedKey)) !== JSON.stringify(trusted) ||
        JSON.stringify(verifyOptions(options)) !== JSON.stringify(expected)) return { verified: false };
    return { verified: true, envelope: bundle.envelope };
  } catch { return { verified: false }; }
}

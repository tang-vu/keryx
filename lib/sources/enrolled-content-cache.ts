import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { validateStorageIdentity, storageIdentityDigest, type StorageIdentity } from "../db/storage-identity";
import { encryptContent, decryptContent, hasContentKey } from "../ipfs/content-crypto";

const PREFIX = "enc:v3:";
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const envelopeSchema = z.object({
  format: z.literal("keryx-enrolled-cache-v1"),
  sourceId: z.string().min(1).max(256),
  storageIdentityDigest: z.string().regex(/^[a-f0-9]{64}$/),
  cipherB64: base64.max(Math.ceil(MAX_TEXT_BYTES / 3) * 4),
  ivB64: base64.length(16),
  authTagB64: base64.length(24),
  wrappedKeyB64: base64.length(64),
  wrapIvB64: base64.length(16),
}).strict();

function refuse(): never { throw new Error("Enrolled content cache unavailable"); }
function context(sourceId: string, identity: StorageIdentity) {
  if (typeof sourceId !== "string" || !sourceId || sourceId.length > 256 || sourceId.includes("\0") ||
    Buffer.byteLength(sourceId) > 512 ||
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(sourceId)) !== sourceId) refuse();
  return { format: "keryx-enrolled-cache-v1" as const, sourceId,
    storageIdentityDigest: storageIdentityDigest(validateStorageIdentity(identity)) };
}
function aad(binding: ReturnType<typeof context>): Buffer {
  return Buffer.from(canonicalJson(binding), "utf8");
}

/** Envelope version and source/store binding, not article-version or paid-delivery evidence. */
export function sealEnrolledCacheText(text: string, sourceId: string, identity: StorageIdentity): string {
  const selected = validateStorageIdentity(identity);
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_TEXT_BYTES ||
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(text)) !== text) return refuse();
  const binding = context(sourceId, selected);
  if (selected.authorityMode === "testnet-offline") return "plain:v1:" + text;
  if (!hasContentKey()) return refuse();
  const envelope = { ...binding, ...encryptContent(text, aad(binding)) };
  return PREFIX + Buffer.from(canonicalJson(envelope), "utf8").toString("base64");
}

export function openEnrolledCacheText(value: string | null | undefined, sourceId: string, identity: StorageIdentity): string | null {
  if (value == null) return null;
  const selected = validateStorageIdentity(identity);
  const binding = context(sourceId, selected);
  if (typeof value !== "string") return refuse();
  if (selected.authorityMode === "testnet-offline") {
    if (!value.startsWith("plain:v1:") || Buffer.byteLength(value) > MAX_TEXT_BYTES + 9) return refuse();
    return value.slice(9);
  }
  try {
    if (!hasContentKey() || !value.startsWith(PREFIX) || value.length > MAX_ENVELOPE_BYTES) return refuse();
    const wire = value.slice(PREFIX.length);
    if (!base64.safeParse(wire).success) return refuse();
    const bytes = Buffer.from(wire, "base64");
    if (bytes.toString("base64") !== wire) return refuse();
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(decoded);
    if (canonicalJson(parsed) !== decoded) return refuse();
    const envelope = envelopeSchema.parse(parsed);
    if (envelope.sourceId !== binding.sourceId || envelope.storageIdentityDigest !== binding.storageIdentityDigest) return refuse();
    for (const key of ["cipherB64", "ivB64", "authTagB64", "wrappedKeyB64", "wrapIvB64"] as const) {
      if (Buffer.from(envelope[key], "base64").toString("base64") !== envelope[key]) return refuse();
    }
    if (Buffer.from(envelope.ivB64, "base64").length !== 12 ||
      Buffer.from(envelope.wrapIvB64, "base64").length !== 12 ||
      Buffer.from(envelope.authTagB64, "base64").length !== 16 ||
      Buffer.from(envelope.wrappedKeyB64, "base64").length !== 48) return refuse();
    if (Buffer.from(envelope.cipherB64, "base64").length > MAX_TEXT_BYTES) return refuse();
    const text = decryptContent(envelope.cipherB64, envelope.wrappedKeyB64, envelope.ivB64,
      envelope.authTagB64, envelope.wrapIvB64, aad(binding));
    if (Buffer.byteLength(text) > MAX_TEXT_BYTES) return refuse();
    return text;
  } catch { return refuse(); }
}

import { config } from "../config";
import {
  decryptContent,
  encryptContent,
  hasContentKey,
  type EncryptedEnvelope,
} from "../ipfs/content-crypto";

const ENCRYPTED_PREFIX = "enc:v2:";
const PLAINTEXT_PREFIX = "plain:v1:";

export function cacheEncryptionRequired(): boolean {
  return (
    process.env.KERYX_FORCE_OFFLINE !== "1" &&
    (process.env.NODE_ENV === "production" || Boolean(config.funderKey))
  );
}

export function isEncryptedCacheValue(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/** DB adapters call this before every cache write; callers continue to work with plaintext. */
export function sealCacheText(text: string): string {
  if (!text) return text;
  if (hasContentKey()) {
    const envelope = encryptContent(text);
    return ENCRYPTED_PREFIX + Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
  }
  if (cacheEncryptionRequired()) {
    throw new Error("CONTENT_MASTER_KEY is required for paid-content cache writes in real mode");
  }
  return PLAINTEXT_PREFIX + text;
}

/** Reads v2 encrypted rows plus legacy/raw rows so deploy-time migration is backward compatible. */
export function openCacheText(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  if (value.startsWith(PLAINTEXT_PREFIX)) return value.slice(PLAINTEXT_PREFIX.length);
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value;
  if (!hasContentKey()) throw new Error("CONTENT_MASTER_KEY is unavailable for encrypted cache read");

  const envelope = JSON.parse(
    Buffer.from(value.slice(ENCRYPTED_PREFIX.length), "base64").toString("utf8"),
  ) as EncryptedEnvelope;
  return decryptContent(
    envelope.cipherB64,
    envelope.wrappedKeyB64,
    envelope.ivB64,
    envelope.authTagB64,
    envelope.wrapIvB64,
  );
}

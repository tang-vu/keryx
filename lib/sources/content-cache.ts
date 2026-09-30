import { readRuntimeStorageDeployment, RuntimeStorageRefused } from "../db/runtime-storage-config";
import type { StorageIdentity } from "../db/storage-identity";
import {
  decryptContent,
  encryptContent,
  hasContentKey,
  type EncryptedEnvelope,
} from "../ipfs/content-crypto";

const ENCRYPTED_PREFIX = "enc:v2:";
const PLAINTEXT_PREFIX = "plain:v1:";

/** Explicit mode comes only from a validated adapter identity; standalone calls require the manifest. */
export function cacheEncryptionRequired(authorityMode?: StorageIdentity["authorityMode"]): boolean {
  const mode = authorityMode ?? readRuntimeStorageDeployment().identity.authorityMode;
  if (!["testnet-real", "testnet-offline"].includes(mode) || (mode === "testnet-real" && process.env.KERYX_FORCE_OFFLINE === "1")) throw new RuntimeStorageRefused();
  return mode === "testnet-real";
}

export function isEncryptedCacheValue(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/** DB adapters call this before every cache write; callers continue to work with plaintext. */
export function sealCacheText(text: string, authorityMode?: StorageIdentity["authorityMode"]): string {
  if (!text) return text;
  const encryptedRequired = cacheEncryptionRequired(authorityMode);
  if (hasContentKey()) {
    const envelope = encryptContent(text);
    return ENCRYPTED_PREFIX + Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
  }
  if (encryptedRequired) {
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

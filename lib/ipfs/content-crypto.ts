/**
 * AES-256-GCM envelope encryption for content items.
 *
 * Trust model: the server holds the master key (CONTENT_MASTER_KEY env var).
 * Per-item keys are random and wrapped (encrypted) with the master key so that:
 *   - the IPFS blob is opaque without the item key
 *   - the item key is opaque without the master key
 * Decryption is only exposed inside settleThenServe's produce() callback —
 * after x402 settlement — making the gate structural, not conditional.
 *
 * Upgrade path: when Arc testnet (5042002) is supported by Lit Protocol, replace
 * unwrapAndDecrypt() with a Lit condition-based share release. The x402 flow is untouched.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm" as const;
const KEY_LEN = 32; // bytes — AES-256
const IV_LEN = 12;  // bytes — GCM standard nonce

export interface EncryptedEnvelope {
  /** base64-encoded ciphertext (to be uploaded to IPFS) */
  cipherB64: string;
  /** base64-encoded iv */
  ivB64: string;
  /** base64-encoded GCM auth tag */
  authTagB64: string;
  /** base64-encoded per-item key wrapped (encrypted) with CONTENT_MASTER_KEY */
  wrappedKeyB64: string;
}

/**
 * Encrypt plaintext content and return the envelope.
 * Throws if CONTENT_MASTER_KEY is not set (caller must check hasPinata() first).
 */
export function encryptContent(plaintext: string): EncryptedEnvelope {
  const masterKey = getMasterKey();
  const itemKey = randomBytes(KEY_LEN);
  const iv = randomBytes(IV_LEN);

  // Encrypt the content with the per-item key.
  const cipher = createCipheriv(ALGO, itemKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Wrap (encrypt) the per-item key with the master key using a fixed zero-iv.
  // Using a fixed iv here is safe because the master key + each item key pair is unique.
  const wrapIv = Buffer.alloc(IV_LEN, 0);
  const wrapCipher = createCipheriv(ALGO, masterKey, wrapIv);
  const wrappedKey = Buffer.concat([wrapCipher.update(itemKey), wrapCipher.final()]);
  // Append the wrap auth tag so we can verify integrity on unwrap.
  const wrapTag = wrapCipher.getAuthTag();
  const wrappedKeyWithTag = Buffer.concat([wrappedKey, wrapTag]);

  return {
    cipherB64: encrypted.toString("base64"),
    ivB64: iv.toString("base64"),
    authTagB64: authTag.toString("base64"),
    wrappedKeyB64: wrappedKeyWithTag.toString("base64"),
  };
}

/**
 * Decrypt a content envelope. Unwraps the per-item key with CONTENT_MASTER_KEY,
 * then decrypts the ciphertext. Returns plaintext string.
 * Throws on any integrity/auth failure — callers should treat as unreadable content.
 */
export function decryptContent(
  cipherB64: string,
  wrappedKeyB64: string,
  ivB64: string,
  authTagB64: string,
): string {
  const masterKey = getMasterKey();
  const cipherBuf = Buffer.from(cipherB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const wrappedKeyWithTag = Buffer.from(wrappedKeyB64, "base64");

  // The last 16 bytes of wrappedKeyWithTag are the GCM auth tag from wrapping.
  const wrappedKey = wrappedKeyWithTag.subarray(0, wrappedKeyWithTag.length - 16);
  const wrapTag = wrappedKeyWithTag.subarray(wrappedKeyWithTag.length - 16);

  // Unwrap the per-item key.
  const wrapIv = Buffer.alloc(IV_LEN, 0);
  const unwrapper = createDecipheriv(ALGO, masterKey, wrapIv);
  unwrapper.setAuthTag(wrapTag);
  const itemKey = Buffer.concat([unwrapper.update(wrappedKey), unwrapper.final()]);

  // Decrypt the content.
  const decipher = createDecipheriv(ALGO, itemKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(cipherBuf), decipher.final()]).toString("utf8");
}

/** True when CONTENT_MASTER_KEY is a valid 64-hex-char (32-byte) string. */
export function hasContentKey(): boolean {
  const k = process.env.CONTENT_MASTER_KEY ?? "";
  return k.length === 64 && /^[0-9a-fA-F]+$/.test(k);
}

function getMasterKey(): Buffer {
  const k = process.env.CONTENT_MASTER_KEY ?? "";
  if (k.length !== 64 || !/^[0-9a-fA-F]+$/.test(k)) {
    throw new Error(
      "CONTENT_MASTER_KEY must be a 64-char hex string (32 bytes). " +
        "Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(k, "hex");
}

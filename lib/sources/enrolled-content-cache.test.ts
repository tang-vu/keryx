import { afterEach, expect, it, vi } from "vitest";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { syntheticStorageIdentity } from "../db/storage-identity-fixture";
import { storageIdentityDigest } from "../db/storage-identity";
import { encryptContent, decryptContent } from "../ipfs/content-crypto";
import { openCacheText, isEncryptedCacheValue } from "./content-cache";
import { openEnrolledCacheText, sealEnrolledCacheText } from "./enrolled-content-cache";

afterEach(() => vi.unstubAllEnvs());
function setup() {
  const masterKey = randomBytes(32);
  vi.stubEnv("CONTENT_MASTER_KEY", masterKey.toString("hex"));
  const identity = syntheticStorageIdentity("testnet-real");
  return { masterKey, identity };
}
function decode(wire: string) {
  return JSON.parse(Buffer.from(wire.slice(7), "base64").toString("utf8")) as Record<string, string>;
}
function encode(envelope: Record<string, string>) {
  return "enc:v3:" + Buffer.from(canonicalJson(envelope)).toString("base64");
}

it("authenticates actual empty and Unicode content with fresh body and wrapping nonces", () => {
  const { identity } = setup();
  for (const text of ["", "Synthetic café content"]) {
    const first = sealEnrolledCacheText(text, "source", identity);
    const second = sealEnrolledCacheText(text, "source", identity);
    expect(openEnrolledCacheText(first, "source", identity)).toBe(text);
    expect(first).not.toBe(second);
    expect(decode(first).ivB64).not.toBe(decode(second).ivB64);
    expect(decode(first).wrapIvB64).not.toBe(decode(second).wrapIvB64);
    expect(isEncryptedCacheValue(first)).toBe(true);
    expect(() => openCacheText(first)).toThrow("storage-bound reader");
  }
});

it("refuses copied or relabeled envelopes across sources and storage identities", () => {
  const { identity } = setup();
  const wire = sealEnrolledCacheText("Synthetic body", "source", identity);
  expect(() => openEnrolledCacheText(wire, "other", identity)).toThrow("unavailable");
  const other = { ...identity, storageId: crypto.randomUUID() };
  expect(() => openEnrolledCacheText(wire, "source", other)).toThrow("unavailable");
  const relabeled = { ...decode(wire), sourceId: "other", storageIdentityDigest: storageIdentityDigest(other) };
  expect(() => openEnrolledCacheText(encode(relabeled), "other", other)).toThrow("unavailable");
});

it("binds body AAD independently even when a privileged fixture rewraps the actual DEK for another source", () => {
  const { identity, masterKey } = setup();
  const envelope = decode(sealEnrolledCacheText("Synthetic body", "source", identity));
  const originalAad = Buffer.from(canonicalJson({ format: envelope.format,
    sourceId: envelope.sourceId, storageIdentityDigest: envelope.storageIdentityDigest }));
  const wrapped = Buffer.from(envelope.wrappedKeyB64, "base64");
  const unwrap = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(envelope.wrapIvB64, "base64"), { authTagLength: 16 });
  unwrap.setAAD(originalAad);
  unwrap.setAuthTag(wrapped.subarray(32));
  const dek = Buffer.concat([unwrap.update(wrapped.subarray(0, 32)), unwrap.final()]);
  const changed: Record<string, string> = { ...envelope, sourceId: "other" };
  const newAad = Buffer.from(canonicalJson({ format: changed.format,
    sourceId: changed.sourceId, storageIdentityDigest: changed.storageIdentityDigest }));
  const iv = randomBytes(12);
  const rewrap = createCipheriv("aes-256-gcm", masterKey, iv, { authTagLength: 16 });
  rewrap.setAAD(newAad);
  changed.wrappedKeyB64 = Buffer.concat([rewrap.update(dek), rewrap.final(), rewrap.getAuthTag()]).toString("base64");
  changed.wrapIvB64 = iv.toString("base64");
  expect(() => openEnrolledCacheText(encode(changed), "other", identity)).toThrow("unavailable");
});

it("rejects ciphertext, wrapping tag, short tag, noncanonical and unknown-field envelopes without returning plaintext", () => {
  const { identity } = setup();
  const wire = sealEnrolledCacheText("Synthetic body", "source", identity);
  const original = decode(wire);
  for (const key of ["cipherB64", "wrappedKeyB64", "authTagB64"] as const) {
    const bytes = Buffer.from(original[key], "base64");
    bytes[bytes.length - 1] ^= 1;
    expect(() => openEnrolledCacheText(encode({ ...original, [key]: bytes.toString("base64") }), "source", identity)).toThrow("unavailable");
  }
  expect(() => openEnrolledCacheText(encode({ ...original, authTagB64: randomBytes(12).toString("base64") }), "source", identity)).toThrow("unavailable");
  expect(() => openEnrolledCacheText(encode({ ...original, extra: "unknown" }), "source", identity)).toThrow("unavailable");
  expect(() => openEnrolledCacheText("enc:v3:" + Buffer.from(JSON.stringify(original, null, 2)).toString("base64"), "source", identity)).toThrow("unavailable");
});

it("requires a valid key in real mode and preserves legacy no-AAD crypto without accepting legacy cache rows", () => {
  const { identity } = setup();
  const legacy = encryptContent("Legacy synthetic body");
  expect(decryptContent(legacy.cipherB64, legacy.wrappedKeyB64, legacy.ivB64,
    legacy.authTagB64, legacy.wrapIvB64)).toBe("Legacy synthetic body");
  const legacyWire = "enc:v2:" + Buffer.from(JSON.stringify(legacy)).toString("base64");
  expect(() => openEnrolledCacheText(legacyWire, "source", identity)).toThrow("unavailable");
  expect(() => openEnrolledCacheText("plain:v1:body", "source", identity)).toThrow("unavailable");
  vi.stubEnv("CONTENT_MASTER_KEY", "invalid");
  expect(() => sealEnrolledCacheText("body", "source", identity)).toThrow("unavailable");
});

it("uses explicit offline plaintext regardless of production environment and enforces bounded input", () => {
  const identity = syntheticStorageIdentity("testnet-offline");
  vi.stubEnv("CONTENT_MASTER_KEY", "");
  vi.stubEnv("NODE_ENV", "production");
  const wire = sealEnrolledCacheText("Offline synthetic body", "source", identity);
  expect(wire).toBe("plain:v1:Offline synthetic body");
  expect(openEnrolledCacheText(wire, "source", identity)).toBe("Offline synthetic body");
  expect(() => sealEnrolledCacheText("x".repeat(1024 * 1024 + 1), "source", identity)).toThrow("unavailable");
  expect(() => openEnrolledCacheText("enc:v3:" + "A".repeat(2 * 1024 * 1024), "source", syntheticStorageIdentity("testnet-real"))).toThrow("unavailable");
});

it("rejects a correctly authenticated one-byte overrun even when its base64 length equals the allowed boundary", () => {
  const { identity } = setup();
  const binding = { format: "keryx-enrolled-cache-v1", sourceId: "source",
    storageIdentityDigest: storageIdentityDigest(identity) };
  const payload = "x".repeat(1024 * 1024 + 1);
  const encrypted = encryptContent(payload, Buffer.from(canonicalJson(binding)));
  expect(encrypted.cipherB64.length).toBe(Math.ceil((1024 * 1024) / 3) * 4);
  expect(() => openEnrolledCacheText(encode({ ...binding, ...encrypted }), "source", identity)).toThrow("unavailable");
});

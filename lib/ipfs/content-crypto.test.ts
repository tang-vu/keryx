import { createCipheriv, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { decryptContent, encryptContent } from "./content-crypto";

const ORIGINAL_KEY = process.env.CONTENT_MASTER_KEY;
const MASTER_HEX = "11".repeat(32);

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.CONTENT_MASTER_KEY;
  else process.env.CONTENT_MASTER_KEY = ORIGINAL_KEY;
});

describe("content envelope encryption", () => {
  it("uses a fresh key-wrap nonce for every v2 envelope and decrypts both", () => {
    process.env.CONTENT_MASTER_KEY = MASTER_HEX;
    const first = encryptContent("publisher full text");
    const second = encryptContent("publisher full text");

    expect(first.wrapIvB64).not.toBe(second.wrapIvB64);
    expect(Buffer.from(first.wrapIvB64, "base64")).toHaveLength(12);
    expect(
      decryptContent(
        first.cipherB64,
        first.wrappedKeyB64,
        first.ivB64,
        first.authTagB64,
        first.wrapIvB64,
      ),
    ).toBe("publisher full text");
  });

  it("still decrypts legacy envelopes whose key-wrap nonce was the historical zero IV", () => {
    process.env.CONTENT_MASTER_KEY = MASTER_HEX;
    const master = Buffer.from(MASTER_HEX, "hex");
    const itemKey = randomBytes(32);
    const iv = randomBytes(12);
    const contentCipher = createCipheriv("aes-256-gcm", itemKey, iv);
    const cipher = Buffer.concat([contentCipher.update("legacy paid body", "utf8"), contentCipher.final()]);
    const wrapCipher = createCipheriv("aes-256-gcm", master, Buffer.alloc(12, 0));
    const wrapped = Buffer.concat([wrapCipher.update(itemKey), wrapCipher.final(), wrapCipher.getAuthTag()]);

    expect(
      decryptContent(
        cipher.toString("base64"),
        wrapped.toString("base64"),
        iv.toString("base64"),
        contentCipher.getAuthTag().toString("base64"),
      ),
    ).toBe("legacy paid body");
  });
});


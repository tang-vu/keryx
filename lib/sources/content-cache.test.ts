import { afterEach, describe, expect, it } from "vitest";

import { isEncryptedCacheValue, openCacheText, sealCacheText } from "./content-cache";

const ORIGINAL_KEY = process.env.CONTENT_MASTER_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.CONTENT_MASTER_KEY;
  else process.env.CONTENT_MASTER_KEY = ORIGINAL_KEY;
});

describe("paid-content cache", () => {
  it("stores ciphertext when the server content key exists", () => {
    process.env.CONTENT_MASTER_KEY = "22".repeat(32);
    const sealed = sealCacheText("decrypted article body");
    expect(isEncryptedCacheValue(sealed)).toBe(true);
    expect(sealed).not.toContain("decrypted article body");
    expect(openCacheText(sealed)).toBe("decrypted article body");
  });

  it("labels offline plaintext explicitly and reads legacy rows", () => {
    delete process.env.CONTENT_MASTER_KEY;
    expect(sealCacheText("offline body")).toBe("plain:v1:offline body");
    expect(openCacheText("plain:v1:offline body")).toBe("offline body");
    expect(openCacheText("legacy body")).toBe("legacy body");
  });
});


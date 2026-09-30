import { afterEach, describe, expect, it, vi } from "vitest";

const policy = vi.hoisted(() => ({ mode: "testnet-offline" }));
vi.mock("../db/runtime-storage-config", async importOriginal => ({
  ...await importOriginal<typeof import("../db/runtime-storage-config")>(),
  readRuntimeStorageDeployment: () => ({ identity: { authorityMode: policy.mode } }),
}));

import { cacheEncryptionRequired, isEncryptedCacheValue, openCacheText, sealCacheText } from "./content-cache";

const ORIGINAL_FORCE = process.env.KERYX_FORCE_OFFLINE;
const ORIGINAL_KEY = process.env.CONTENT_MASTER_KEY;

afterEach(() => {
  policy.mode = "testnet-offline";
  if (ORIGINAL_FORCE === undefined) delete process.env.KERYX_FORCE_OFFLINE; else process.env.KERYX_FORCE_OFFLINE = ORIGINAL_FORCE;
  if (ORIGINAL_KEY === undefined) delete process.env.CONTENT_MASTER_KEY;
  else process.env.CONTENT_MASTER_KEY = ORIGINAL_KEY;
});

describe("paid-content cache", () => {
  it("requires encryption for validated real identity without inferring mode from key presence", () => {
    delete process.env.CONTENT_MASTER_KEY; delete process.env.KERYX_FORCE_OFFLINE;
    expect(cacheEncryptionRequired("testnet-real")).toBe(true);
    expect(() => sealCacheText("private body", "testnet-real")).toThrow(/CONTENT_MASTER_KEY/);
    expect(cacheEncryptionRequired("testnet-offline")).toBe(false);
    expect(sealCacheText("synthetic body", "testnet-offline")).toBe("plain:v1:synthetic body");
  });
  it("fails closed on conflicting real forced-offline policy before writing plaintext", () => {
    process.env.KERYX_FORCE_OFFLINE = "1";
    expect(() => sealCacheText("private body", "testnet-real")).toThrow(/configuration unavailable/);
  });
  it("uses the standalone runtime manifest mode", () => {
    delete process.env.CONTENT_MASTER_KEY; delete process.env.KERYX_FORCE_OFFLINE; policy.mode = "testnet-real";
    expect(() => sealCacheText("private body")).toThrow(/CONTENT_MASTER_KEY/);
  });
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


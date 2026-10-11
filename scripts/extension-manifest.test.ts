import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateExtensionManifest } from "./extension-manifest.mjs";

describe("Chrome extension submission manifest", () => {
  const valid = { manifest_version: 3, description: "Research", version: "0.1.4.1" };
  it("accepts the shipped manifest and the 132-character boundary", () => {
    expect(() => validateExtensionManifest(JSON.parse(readFileSync("extension/manifest.json", "utf8")))).not.toThrow();
    expect(() => validateExtensionManifest({ ...valid, description: "a".repeat(132) })).not.toThrow();
  });
  it.each(["", "  ", "a".repeat(133), undefined])("rejects unusable descriptions", description => {
    expect(() => validateExtensionManifest({ ...valid, description })).toThrow(/description/);
  });
  it.each(["0", "0.0.0.0", "01.2", "1.02", "1.2.3.4.5", "65536.1", "1.-1", "1.2-beta", "1.", undefined])("rejects invalid Chrome versions: %s", version => {
    expect(() => validateExtensionManifest({ ...valid, version })).toThrow(/version/);
  });
  it.each(["1", "0.1.4.1", "0.1.4", "65535.65535.65535.65535"])("accepts valid Chrome versions: %s", version => {
    expect(() => validateExtensionManifest({ ...valid, version })).not.toThrow();
  });
  it("rejects a different manifest generation", () => {
    expect(() => validateExtensionManifest({ ...valid, manifest_version: 2 })).toThrow(/Manifest V3/);
  });
});

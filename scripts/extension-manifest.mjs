/** Chrome manifest limits checked before writing a distribution archive. */
export function validateExtensionManifest(manifest) {
  if (manifest?.manifest_version !== 3) throw new Error("Extension requires Manifest V3");
  if (typeof manifest.description !== "string" || !manifest.description.trim() ||
      [...manifest.description].length > 132) {
    throw new Error("Extension description must contain 1–132 characters");
  }
  const version = manifest.version;
  if (typeof version !== "string" || !/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(version) ||
      version.split(".").some(part => Number(part) > 65535) ||
      version.split(".").every(part => Number(part) === 0)) {
    throw new Error("Extension version must have 1–4 numeric parts, each 0–65535, without leading zeros, and not all zero");
  }
}

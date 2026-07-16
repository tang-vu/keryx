/**
 * pack-extension.mts — build the Chrome Web Store upload zip from extension/.
 *
 * Produces keryx-extension-v{manifest.version}.zip at the repo root (gitignored),
 * containing exactly the files the store needs — manifest, scripts, popup, icons —
 * and not the README. The store rejects zips with a top-level folder, so entries
 * are added relative to extension/.
 *
 * Zip tool: Windows ships bsdtar at System32\tar.exe (zip via -a + .zip name);
 * Git Bash's GNU tar can't write zip, so the path is pinned. POSIX falls back to `zip`.
 *
 * Run: npm run pack:extension
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const extDir = resolve(root, "extension");

const manifest = JSON.parse(readFileSync(resolve(extDir, "manifest.json"), "utf8"));
const version: string = manifest.version;

// Explicit allowlist — a stray editor swap file or local test config must never ship.
const FILES = [
  "manifest.json",
  "background.js",
  "keryx-config.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
];

for (const f of FILES) {
  if (!existsSync(resolve(extDir, f))) {
    console.error(`missing expected extension file: ${f}`);
    process.exit(1);
  }
}

const out = resolve(root, `keryx-extension-v${version}.zip`);
rmSync(out, { force: true });

if (process.platform === "win32") {
  execFileSync("C:\\Windows\\System32\\tar.exe", ["-a", "-cf", out, "-C", extDir, ...FILES]);
} else {
  execFileSync("zip", ["-q", out, ...FILES], { cwd: extDir });
}

// List the archive back so what shipped is visible in the run log.
const listing =
  process.platform === "win32"
    ? execFileSync("C:\\Windows\\System32\\tar.exe", ["-tf", out]).toString()
    : execFileSync("unzip", ["-l", out]).toString();
console.log(listing.trim());
console.log(`\npacked ${FILES.length} files -> ${out}`);

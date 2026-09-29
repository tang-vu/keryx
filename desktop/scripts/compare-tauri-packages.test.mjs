import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertTauriExecutablePair, assertTauriPackagePair } from "./compare-tauri-packages.mjs";

const portableMarker = "__TAURI_BUNDLE_TYPE_VAR_UNK";
const installedMarker = "__TAURI_BUNDLE_TYPE_VAR_NSS";
const executable = (marker, suffix = "suffix") => Buffer.from(`MZ-prefix-${marker}-${suffix}`);

test("accepts only Tauri's bundle marker change in the executable", () => {
  assertTauriExecutablePair(executable(portableMarker), executable(installedMarker));
  assert.throws(() => assertTauriExecutablePair(executable(portableMarker), executable(installedMarker, "change")),
    /beyond the Tauri bundle type marker/);
  assert.throws(() => assertTauriExecutablePair(executable(portableMarker), executable(installedMarker, "longest")),
    /sizes differ/);
  assert.throws(() => assertTauriExecutablePair(executable(portableMarker), Buffer.from(`MZprefix-${installedMarker}--suffix`)),
    /different offsets/);
  assert.throws(() => assertTauriExecutablePair(executable(portableMarker), executable(portableMarker)),
    /unbundled marker/);
  assert.throws(() => assertTauriExecutablePair(executable(portableMarker + portableMarker), executable(installedMarker + installedMarker)),
    /exactly one/);
});

test("rejects a changed or missing installed resource", async () => {
  const root = await mkdtemp(join(tmpdir(), "keryx-tauri-package-"));
  const portable = join(root, "portable");
  const installed = join(root, "installed");
  try {
    await Promise.all([portable, installed].map((dir) => mkdir(join(dir, "dist", "ui"), { recursive: true })));
    await writeFile(join(portable, "KeryxOperator.exe"), executable(portableMarker));
    await writeFile(join(installed, "KeryxOperator.exe"), executable(installedMarker));
    await writeFile(join(portable, "dist", "ui", "index.html"), "<main>same</main>");
    await writeFile(join(installed, "dist", "ui", "index.html"), "<main>same</main>");
    await assertTauriPackagePair(portable, installed);
    await writeFile(join(installed, "dist", "ui", "index.html"), "<main>changed</main>");
    await assert.rejects(assertTauriPackagePair(portable, installed), /resources differ/);
    await rm(join(installed, "dist", "ui", "index.html"));
    await assert.rejects(assertTauriPackagePair(portable, installed), /file lists differ/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dependencyFingerprint, canReuseDependencies, invalidateDependencies, recordDependencies } from "./dependency-state.mjs";

const manifest = { name: "fixture", version: "1.0.0", scripts: { build: "next build" }, dependencies: { example: "1.0.0" } };
const lock = { name: "fixture", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "fixture", version: "1.0.0", dependencies: manifest.dependencies }, "node_modules/example": { version: "1.0.0", integrity: "synthetic" } } };
const runtime = { node: "v24", abi: "137", npm: "11", platform: "linux", arch: "x64", config: { omit: [], registry: "https://example.test", token: "synthetic-secret" } };

test("reuse ignores only root release metadata, not dependency integrity or install context", () => {
  const next = structuredClone(lock); next.version = next.packages[""].version = "1.0.1";
  const original = dependencyFingerprint(manifest, lock, runtime);
  assert.equal(dependencyFingerprint({ ...manifest, version: "1.0.1" }, next, runtime), original);
  next.packages["node_modules/example"].integrity = "different";
  assert.notEqual(dependencyFingerprint(manifest, next, runtime), original);
  assert.notEqual(dependencyFingerprint(manifest, lock, { ...runtime, node: "v25" }), original);
  assert.notEqual(dependencyFingerprint(manifest, lock, { ...runtime, config: { omit: ["dev"] } }), original);
  assert.notEqual(dependencyFingerprint({ ...manifest, scripts: { build: "changed" } }, lock, runtime), original);
});

test("root version remains install-sensitive with hooks, workspaces or local dependencies", () => {
  for (const extra of [{ scripts: { prepare: "node prepare.mjs" } }, { workspaces: ["packages/*"] }, { dependencies: { example: "file:../example" } }]) {
    const before = { ...manifest, ...extra }, after = { ...before, version: "1.0.1" };
    assert.notEqual(dependencyFingerprint(before, lock, runtime), dependencyFingerprint(after, lock, runtime));
  }
  assert.throws(() => dependencyFingerprint(manifest, { ...lock, lockfileVersion: 2 }, runtime));
});

test("missing, invalidated and incomplete installs cannot be reused after a failed attempt", () => {
  const root = mkdtempSync(join(tmpdir(), "keryx-dependency-state-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock));
    mkdirSync(join(root, "node_modules/example"), { recursive: true });
    writeFileSync(join(root, "node_modules/example/package.json"), '{}');
    writeFileSync(join(root, "node_modules/.package-lock.json"), JSON.stringify(lock));
    const fakeNpm = join(root, "fake-npm.mjs");
    writeFileSync(fakeNpm, `console.log(process.argv.includes('--version') ? '11' : JSON.stringify({registry:'https://example.test',token:'synthetic-secret'}));`);
    const cli = mode => spawnSync(process.execPath, [fileURLToPath(new URL("./dependency-state.mjs", import.meta.url)), mode],
      { cwd: root, env: { ...process.env, npm_execpath: fakeNpm }, encoding: "utf8" });
    assert.equal(cli("check").status, 1);
    assert.equal(cli("record").status, 0);
    assert.equal(cli("check").status, 0);
    assert.equal(cli("invalidate").status, 0);
    assert.equal(canReuseDependencies(root, runtime), false);
    recordDependencies(root, runtime); assert.equal(canReuseDependencies(root, runtime), true);
    assert(!readFileSync(join(root, "node_modules/.keryx-dependency-state.json"), "utf8").includes("synthetic-secret"));
    invalidateDependencies(root); assert.equal(canReuseDependencies(root, runtime), false);
    recordDependencies(root, runtime);
    writeFileSync(join(root, "node_modules/.package-lock.json"), '{}');
    assert.equal(canReuseDependencies(root, runtime), false);
    invalidateDependencies(root);
    rmSync(join(root, "node_modules/example/package.json"));
    assert.throws(() => recordDependencies(root, runtime));
    assert.equal(canReuseDependencies(root, runtime), false);
  } finally {
    // One shell/runtime owns cleanup; verify the exact target remains in its temp root.
    assert(resolve(root).startsWith(resolve(tmpdir()) + sep));
    assert(root.includes("keryx-dependency-state-"));
    rmSync(root, { recursive: true, force: true });
  }
});

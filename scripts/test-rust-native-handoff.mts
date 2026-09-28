/** Test-only producer/consumer drill for an independently downloaded read-only artifact. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat,
  writeFile } from "node:fs/promises";
import { tmpdir, release as osRelease, version as osVersion } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createNativeReadonlyManifest, verifyNativeReadonlyArtifact } from "../lib/operator/native-readonly-artifact.ts";
import { NativeReadonlyTransport } from "../lib/operator/native-readonly-transport.ts";
import { digestTree, writtenV1 } from "./rust-native-synthetic-fixture.mts";

const repo = resolve(import.meta.dirname, "..");
const filename = process.platform === "win32" ? "keryx-engine.exe" : "keryx-engine";
const manifestName = "native-manifest.json";
const noEnv = { PATH: process.env.PATH ?? "", PATHEXT: process.env.PATHEXT ?? "",
  SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" };
const tsxLoader = import.meta.resolve("tsx");
const offlineGuard = pathToFileURL(join(repo, "scripts", "rust-offline-fallback-guard.mjs")).href;
const sourceCommitPattern = /^[a-f0-9]{40}$/;
const targetsForHost = process.platform === "win32"
  ? ["x86_64-pc-windows-msvc", "x86_64-pc-windows-gnu"]
  : process.platform === "linux" ? ["x86_64-unknown-linux-gnu"] : [];

function requiredEnv(name: string) {
  const value = process.env[name];
  assert(value, `${name} must be supplied by the trusted test procedure`);
  return value;
}

function expectedInputs() {
  const sourceCommit = requiredEnv("KERYX_HANDOFF_SHA");
  const target = requiredEnv("KERYX_HANDOFF_TARGET");
  const directory = requiredEnv("KERYX_HANDOFF_DIR");
  assert.match(sourceCommit, sourceCommitPattern);
  assert.equal(process.arch, "x64", "this handoff evaluates x64 artifacts only");
  assert(targetsForHost.includes(target), "expected target does not match this consumer/producer host");
  assert(isAbsolute(directory), "artifact directory must be absolute");
  const checkout = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, env: noEnv,
    encoding: "utf8", timeout: 10_000, maxBuffer: 100_000, windowsHide: true });
  if (checkout.error) throw checkout.error;
  assert.equal(checkout.status, 0, checkout.stderr);
  assert.equal(checkout.stdout.trim(), sourceCommit, "expected source must equal the independent checkout SHA");
  return { sourceCommit, target, directory };
}

async function exactInventory(directory: string) {
  const root = await lstat(directory);
  assert(root.isDirectory() && !root.isSymbolicLink(), "artifact directory must be a real directory");
  const entries = await readdir(directory, { withFileTypes: true });
  assert.deepEqual(entries.map(entry => entry.name).sort(), [filename, manifestName].sort(),
    "artifact must contain exactly the canonical binary and manifest");
  for (const entry of entries) {
    assert(entry.isFile() && !entry.isSymbolicLink(), `artifact entry is not a regular file: ${entry.name}`);
    const file = await lstat(join(directory, entry.name));
    assert(file.isFile() && !file.isSymbolicLink(), `artifact entry changed type: ${entry.name}`);
  }
}

async function stage() {
  const { sourceCommit, target, directory } = expectedInputs();
  const binary = requiredEnv("KERYX_HANDOFF_BINARY");
  assert(isAbsolute(binary), "built binary path must be absolute");
  assert.equal(resolve(binary), join(repo, "rust", "target", "release", filename),
    "producer may stage only this checkout's canonical release binary");
  const built = await lstat(binary);
  assert(built.isFile() && !built.isSymbolicLink() && built.size > 0,
    "producer release binary is missing or not a regular file");
  await mkdir(directory); // An existing destination is not reused or mixed with private files.
  const copied = join(directory, filename);
  await copyFile(binary, copied);
  if (process.platform !== "win32") await chmod(copied, 0o755);
  const manifest = await createNativeReadonlyManifest(copied, { sourceCommit,
    target: target as Parameters<typeof createNativeReadonlyManifest>[1]["target"] });
  await writeFile(join(directory, manifestName), `${JSON.stringify(manifest)}\n`, { flag: "wx", mode: 0o600 });
  await exactInventory(directory);
  await verifyNativeReadonlyArtifact(copied, join(directory, manifestName), sourceCommit);
  assert.equal(manifest.target, target);
  console.log(JSON.stringify({ phase: "producer", sourceCommit, target, files: [filename, manifestName],
    sizeBytes: manifest.sizeBytes, sha256: manifest.sha256 }));
}

function runNode(args: string[]) {
  const result = spawnSync(process.execPath, args, { cwd: repo, env: noEnv,
    encoding: null, timeout: 30_000, maxBuffer: 4_000_000, windowsHide: true });
  if (result.error) throw result.error;
  return result;
}

function assertOfflineGuard() {
  const probe = `
    import assert from "node:assert/strict";
    import { spawnSync } from "node:child_process";
    assert.throws(() => fetch("http://127.0.0.1:1"),
      /offline acceptance forbids network or child process access/);
    assert.throws(() => spawnSync(process.execPath, ["-e", ""]),
      /offline acceptance forbids network or child process access/);
    console.log("offline guard blocked network and child launch");
  `;
  const result = runNode(["--import", offlineGuard, "--input-type=module", "-e", probe]);
  assert.equal(result.status, 0, result.stderr.toString("utf8"));
  assert.match(result.stdout.toString("utf8"), /offline guard blocked network and child launch/);
  assert.match(result.stderr.toString("utf8"), /keryx offline fallback guard active/);
}

function evaluate(binary: string, manifest: string, sourceCommit: string,
  command: "status" | "result" | "brief", state: string) {
  return runNode(["--import", tsxLoader, join(repo, "scripts", "evaluate-rust-readonly.mts"),
    "--binary", binary, "--manifest", manifest, "--source-commit", sourceCommit,
    "--command", command, "--state", state]);
}

async function consume() {
  const { sourceCommit, target, directory } = expectedInputs();
  await exactInventory(directory); // Refuse missing, extra, link or directory entries before chmod.
  const binary = join(directory, filename);
  const manifestPath = join(directory, manifestName);
  if (process.platform !== "win32") await chmod(binary, 0o755); // Actions archive restores files as 0644.
  const manifest = await verifyNativeReadonlyArtifact(binary, manifestPath, sourceCommit);
  assert.equal(manifest.target, target, "downloaded target differs from the independently expected target");
  const root = await realpath(await mkdtemp(join(tmpdir(), "keryx-native-handoff-")));
  let artifactRefusals = 0;
  let parityChecks = 0;
  let rollbackChecks = 0;
  try {
    const state = join(root, "task & (one) Unicode 🧪");
    const expected = await writtenV1(state);
    const before = await digestTree(state);
    const native = new NativeReadonlyTransport({ binaryPath: binary, manifestPath,
      expectedSourceCommit: sourceCommit });
    for (const command of ["status", "result", "brief"] as const) {
      const observed = await native.inspect(command, state);
      assert.deepEqual(observed, expected[command]);
      parityChecks++;
      const cli = evaluate(binary, manifestPath, sourceCommit, command, state);
      assert.equal(cli.status, 0, cli.stderr.toString("utf8"));
      if (command === "brief") assert.deepEqual(cli.stdout, expected.brief);
      else assert.deepEqual(JSON.parse(cli.stdout.toString("utf8")), expected[command]);
      parityChecks++;
    }

    const refusalDir = join(root, "refusal copies");
    await mkdir(refusalDir);
    const missingManifest = join(refusalDir, manifestName);
    const missingBinary = join(refusalDir, filename);
    await copyFile(manifestPath, missingManifest);
    await assert.rejects(
      new NativeReadonlyTransport({ binaryPath: missingBinary, manifestPath: missingManifest,
        expectedSourceCommit: sourceCommit }).inspect("status", state), /Native inspection artifact/);
    artifactRefusals++;
    await copyFile(binary, missingBinary);
    if (process.platform !== "win32") await chmod(missingBinary, 0o755);
    const wrongSourceManifest = join(refusalDir, "wrong-source-manifest.json");
    const wrongSource = JSON.parse(await readFile(manifestPath, "utf8"));
    wrongSource.sourceCommit = sourceCommit === "0".repeat(40) ? "1".repeat(40) : "0".repeat(40);
    await writeFile(wrongSourceManifest, JSON.stringify(wrongSource), { flag: "wx" });
    await assert.rejects(
      new NativeReadonlyTransport({ binaryPath: missingBinary, manifestPath: wrongSourceManifest,
        expectedSourceCommit: sourceCommit }).inspect("status", state), /Native inspection artifact.*identity/);
    artifactRefusals++;
    await copyFile(binary, missingBinary);
    if (process.platform !== "win32") await chmod(missingBinary, 0o755);
    await appendFile(missingBinary, Buffer.from("corrupt"));
    await assert.rejects(
      new NativeReadonlyTransport({ binaryPath: missingBinary, manifestPath: missingManifest,
        expectedSourceCommit: sourceCommit }).inspect("status", state), /Native inspection artifact/);
    artifactRefusals++;

    // Explicitly disable the candidate for this caller; there is no automatic fallback.
    const disabledBinary = join(root, `disabled-${filename}`);
    await assert.rejects(stat(disabledBinary), { code: "ENOENT" });
    const nativeFailure = evaluate(disabledBinary, manifestPath, sourceCommit, "status", state);
    assert.notEqual(nativeFailure.status, 0);
    assert.equal(nativeFailure.stdout.length, 0, "disabled native caller emitted success output");
    assert.match(nativeFailure.stderr.toString("utf8"), /Native inspection artifact/);
    artifactRefusals++;
    assertOfflineGuard();
    for (const command of ["status", "result", "brief"] as const) {
      const exported = join(root, "rollback-brief.md");
      const args = ["--import", offlineGuard, "--import", tsxLoader, "--no-warnings",
        join(repo, "scripts", "operator.mts"), command, "--state", state,
        ...(command === "brief" ? ["--file", exported] : [])];
      const result = runNode(args);
      assert.equal(result.status, 0, `guarded TypeScript ${command}: ${result.stderr.toString("utf8")}`);
      assert.match(result.stderr.toString("utf8"), /keryx offline fallback guard active/);
      if (command === "brief") {
        assert.deepEqual(JSON.parse(result.stdout.toString("utf8")), { saved: resolve(exported), private: true });
        assert.deepEqual(await readFile(exported), expected.brief.subarray(0, -1));
      } else assert.deepEqual(JSON.parse(result.stdout.toString("utf8")), expected[command]);
      rollbackChecks++;
    }
    assert.equal(await digestTree(state), before, "handoff inspection or rollback changed the original v1 files");
    const report = process.report?.getReport()?.header;
    console.log(JSON.stringify({ phase: "consumer", fixtureKind: "TypeScript-written synthetic; no settlement evidence",
      sourceCommit, target, artifactRefusals, parityChecks, explicitGuardedRollback: rollbackChecks,
      offlineGuardSelfCheck: 1,
      platform: process.platform, arch: process.arch, node: process.version,
      osRelease: osRelease(), osVersion: osVersion(), runnerImageOs: process.env.ImageOS ?? null,
      runnerImageVersion: process.env.ImageVersion ?? null,
      glibcVersionRuntime: typeof report === "object" && "glibcVersionRuntime" in report
        ? report.glibcVersionRuntime : null,
      authority: "TypeScript remains production; artifact handoff is explicit read-only evaluation" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const phase = process.argv[2];
if (process.argv.length !== 3 || !["stage", "consume"].includes(phase)) {
  throw new Error("Expected exactly one phase: stage or consume");
}
(phase === "stage" ? stage() : consume()).catch(error => {
  console.error(error instanceof Error ? error.message : "Native artifact handoff failed");
  process.exitCode = 1;
});

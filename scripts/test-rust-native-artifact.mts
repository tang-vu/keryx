/** Real copied-artifact and OS subprocess acceptance for the optional read-only adapter. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, chmod, copyFile, mkdir, mkdtemp, readFile, rm,
  realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { digestTree, writtenV1 } from "./rust-native-synthetic-fixture.mts";
import { NativeReadonlyTransport } from "../lib/operator/native-readonly-transport.ts";
import { createNativeReadonlyManifest } from "../lib/operator/native-readonly-artifact.ts";
import { readOperatorResearchResult } from "../lib/operator/task.ts";

const repo = resolve(import.meta.dirname, "..");
const filename = process.platform === "win32" ? "keryx-engine.exe" : "keryx-engine";
const noEnv = { PATH: process.env.PATH ?? "", PATHEXT: process.env.PATHEXT ?? "",
  SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" };
const releaseBinary = resolve(process.env.KERYX_NATIVE_TEST_BINARY ?? join(repo, "rust", "target", "release", filename));
const target = process.env.KERYX_NATIVE_TEST_TARGET;
const sourceCommit = process.env.KERYX_NATIVE_TEST_SOURCE_COMMIT ?? gitHead();
const tsxLoader = import.meta.resolve("tsx");
const offlineGuard = pathToFileURL(join(repo, "scripts", "rust-offline-fallback-guard.mjs")).href;
let artifactChecks = 0;
let processChecks = 0;
let parityChecks = 0;
let rollbackChecks = 0;

function child(executable: string, args: string[], maxBuffer = 4_000_000,
  environment: NodeJS.ProcessEnv = noEnv) {
  const result = spawnSync(executable, args, { cwd: repo, env: environment, windowsHide: true,
    encoding: "utf8", timeout: 30_000, maxBuffer });
  if (result.error) throw new Error(`Subprocess did not finish: ${result.error.message}`);
  return result;
}

function gitHead() {
  const result = child("git", ["rev-parse", "HEAD"], 100_000);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function transport(binaryPath: string, manifestPath: string, deadlineMs = 10_000,
  maxStdoutBytes?: number, maxStderrBytes?: number) {
  return new NativeReadonlyTransport({ binaryPath, manifestPath, expectedSourceCommit: sourceCommit,
    deadlineMs, maxStdoutBytes, maxStderrBytes });
}

async function refused(action: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(action, error => {
    assert.match(String(error), pattern);
    return true;
  });
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };
async function refusedOutcome(outcome: Promise<Outcome>, pattern: RegExp) {
  const result = await outcome;
  assert.equal(result.ok, false, "native child unexpectedly succeeded");
  if (!result.ok) assert.match(String(result.error), pattern);
}

function evaluate(binaryPath: string, manifestPath: string, command: "status" | "result" | "brief", state: string) {
  return child(process.execPath, ["--import", tsxLoader, join(repo, "scripts", "evaluate-rust-readonly.mts"),
    "--binary", binaryPath, "--manifest", manifestPath, "--source-commit", sourceCommit,
    "--command", command, "--state", state]);
}

async function makeManifest(binaryPath: string, manifestPath: string) {
  const generated = child(process.execPath, ["--import", tsxLoader,
    join(repo, "scripts", "create-rust-readonly-manifest.mts"), "--binary", binaryPath,
    "--out", manifestPath, "--source-commit", sourceCommit, "--target", target]);
  assert.equal(generated.status, 0, generated.stderr);
  const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(parsed.sourceCommit, sourceCommit);
  assert.equal(parsed.target, target);
  assert.equal(parsed.binaryName, filename);
  return parsed;
}

async function waitForPid(path: string) {
  for (let attempt = 0; attempt < 250; attempt++) {
    try {
      const pid = Number(await readFile(path, "utf8"));
      assert(Number.isInteger(pid) && pid > 0);
      return pid;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await delay(20);
  }
  throw new Error(`Child PID marker not written: ${path}`);
}

async function assertReaped(pid: number) {
  for (let attempt = 0; attempt < 250; attempt++) {
    try { process.kill(pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await delay(20);
  }
  throw new Error(`Native child ${pid} remained alive after transport rejection`);
}

function guardSelfCheck() {
  const probe = `
    import assert from "node:assert/strict";
    import { request as httpRequest } from "node:http";
    import { request as httpsRequest } from "node:https";
    import { Socket } from "node:net";
    import { spawnSync as nestedSpawn } from "node:child_process";
    for (const action of [
      () => fetch("http://127.0.0.1:1"),
      () => httpRequest("http://127.0.0.1:1"),
      () => httpsRequest("https://127.0.0.1:1"),
      () => new Socket().connect(1, "127.0.0.1"),
      () => nestedSpawn(process.execPath, ["-e", ""]),
    ]) assert.throws(action, /offline acceptance forbids network or child process access/);
    console.log("offline guard denied all five probes before connection or launch");
  `;
  const run = child(process.execPath, ["--import", offlineGuard, "--input-type=module", "-e", probe], 100_000);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /offline guard denied all five probes/);
  assert.match(run.stderr, /keryx offline fallback guard active/);
}

async function main() {
  assert(target, "KERYX_NATIVE_TEST_TARGET must name the target of the just-built binary");
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(sourceCommit, gitHead(), "manifest source must name the exact checked-out commit");
  assert.equal(releaseBinary, join(repo, "rust", "target", "release", filename),
    "binary must come from this checkout's Rust release directory");
  const original = await stat(releaseBinary);
  assert(original.isFile() && original.size > 0, "build the current release binary first");
  const root = await realpath(await mkdtemp(join(tmpdir(), "keryx-native-artifact-")));
  const active = new Set<{ controller: AbortController; outcome: Promise<Outcome> }>();
  const tracked = (action: (signal: AbortSignal) => Promise<unknown>) => {
    const controller = new AbortController();
    const outcome: Promise<Outcome> = action(controller.signal).then(
      value => ({ ok: true, value }), error => ({ ok: false, error }));
    const entry = { controller, outcome };
    active.add(entry);
    void outcome.then(() => active.delete(entry));
    return entry;
  };
  try {
    const varied = join(root, "space & (one) Việt 😀");
    await mkdir(varied);
    const state = join(varied, "task & (one) Việt 😀");
    const expected = await writtenV1(state);
    const before = await digestTree(state);
    const artifactDir = join(varied, "copied artifact & (one)");
    await mkdir(artifactDir);
    const binaryPath = join(artifactDir, filename);
    const manifestPath = join(artifactDir, "native-manifest.json");
    await copyFile(releaseBinary, binaryPath);
    if (process.platform !== "win32") await chmod(binaryPath, 0o755);
    const manifest = await makeManifest(binaryPath, manifestPath);
    const native = transport(binaryPath, manifestPath);
    const protocol = child(binaryPath, ["protocol"]);
    assert.equal(protocol.status, 0, protocol.stderr);
    assert.deepEqual(JSON.parse(protocol.stdout), { protocol: "keryx-readonly-cli-v1", engine: "keryx-engine" });
    const protocolWithState = child(binaryPath, ["protocol", "--state", state]);
    assert.notEqual(protocolWithState.status, 0);
    assert.equal(protocolWithState.stdout, "", "protocol with state leaked success output");
    artifactChecks += 2;
    assert.deepEqual(await native.inspect("status", state), expected.status);
    assert.deepEqual(await native.inspect("result", state), expected.result);
    assert.deepEqual(await native.inspect("brief", state), expected.brief);
    parityChecks += 3;

    // Application exports enrich the checked receipt above either raw inspection adapter;
    // the exact v1 raw comparisons above remain unchanged for historical records.
    const recordedState = join(varied, "recorded article task");
    const recorded = await writtenV1(recordedState, true);
    const recordedBefore = await digestTree(recordedState);
    const nativeRaw = await native.inspect("result", recordedState);
    assert.deepEqual(nativeRaw, recorded.result);
    const enriched = await readOperatorResearchResult(recordedState);
    assert(enriched);
    assert(nativeRaw && typeof nativeRaw === "object");
    assert.deepEqual(enriched, { ...nativeRaw, researchExports: enriched.researchExports });
    assert.equal(enriched.researchExports.bibtex.count, 1);
    assert.match(enriched.researchExports.ris.content, /Observed synthetic article/);
    assert.match(enriched.researchExports.evidenceCsv, /Synthetic bounded excerpt/);
    assert.equal(await digestTree(recordedState), recordedBefore, "application export projection wrote to inspected files");
    parityChecks += 4;

    const cliStatus = evaluate(binaryPath, manifestPath, "status", state);
    assert.equal(cliStatus.status, 0, cliStatus.stderr);
    assert.deepEqual(JSON.parse(cliStatus.stdout), expected.status);
    const cliBrief = evaluate(binaryPath, manifestPath, "brief", state);
    assert.equal(cliBrief.status, 0, cliBrief.stderr);
    assert.deepEqual(Buffer.from(cliBrief.stdout, "utf8"), expected.brief);
    parityChecks += 2;

    const wrongSourcePath = join(artifactDir, "wrong-source.json");
    await writeFile(wrongSourcePath, JSON.stringify({ ...manifest, sourceCommit: "0".repeat(40) }));
    await refused(() => transport(binaryPath, wrongSourcePath).inspect("status", state), /artifact.*identity/i);
    artifactChecks++;
    const wrongHostPath = join(artifactDir, "wrong-host.json");
    await writeFile(wrongHostPath, JSON.stringify({ ...manifest,
      platform: process.platform === "win32" ? "linux" : "win32",
      target: process.platform === "win32" ? "x86_64-unknown-linux-gnu" : "x86_64-pc-windows-msvc" }));
    await refused(() => transport(binaryPath, wrongHostPath).inspect("status", state), /artifact.*host/i);
    artifactChecks++;
    await appendFile(binaryPath, Buffer.from("tamper"));
    await refused(() => native.inspect("status", state), /artifact.*trusted manifest/i);
    const cliRefusal = evaluate(binaryPath, manifestPath, "status", state);
    assert.notEqual(cliRefusal.status, 0);
    assert.equal(cliRefusal.stdout, "", "evaluator emitted success output on artifact refusal");
    assert.match(cliRefusal.stderr, /Native inspection artifact/);
    artifactChecks += 2;
    await copyFile(releaseBinary, binaryPath);
    if (process.platform !== "win32") await chmod(binaryPath, 0o755);
    assert.deepEqual(await native.inspect("status", state), expected.status);
    artifactChecks++;
    await rm(binaryPath);
    await refused(() => native.inspect("status", state), /artifact/i);
    artifactChecks++;
    await copyFile(releaseBinary, binaryPath);
    if (process.platform !== "win32") await chmod(binaryPath, 0o755);

    const fixtureDir = join(varied, "test-only fault process");
    await mkdir(fixtureDir);
    const fixtureBinary = join(fixtureDir, filename);
    // Windows GNU's linker cannot emit directly to a Unicode path. Compile
    // in an ASCII build directory, then exercise the copied Unicode path.
    const fixtureBuildDir = join(root, "fixture-build");
    await mkdir(fixtureBuildDir);
    const compiledFixture = join(fixtureBuildDir, filename);
    const compile = child("rustc", [
      ...(process.env.KERYX_TEST_RUST_TOOLCHAIN ? [`+${process.env.KERYX_TEST_RUST_TOOLCHAIN}`] : []),
      "--edition=2021", join(repo, "scripts", "rust-native-test-fixture.rs"),
      "-o", compiledFixture,
    ], 4_000_000, process.env); // Host compiler/linker needs trusted MSVC SDK variables.
    assert.equal(compile.status, 0, compile.stderr);
    await copyFile(compiledFixture, fixtureBinary);
    if (process.platform !== "win32") await chmod(fixtureBinary, 0o755);
    const fixtureManifest = join(fixtureDir, "manifest.json");
    const fixtureMetadata = await createNativeReadonlyManifest(fixtureBinary, {
      sourceCommit, target: target as Parameters<typeof createNativeReadonlyManifest>[1]["target"],
    });
    await writeFile(fixtureManifest, JSON.stringify(fixtureMetadata));
    const modePath = join(fixtureDir, "mode.txt");
    const pidPath = join(fixtureDir, "active.pid");
    const launchMarker = join(fixtureDir, "launched.txt");
    const commandMarker = join(fixtureDir, "command-called.txt");
    const responsePath = join(fixtureDir, "response.bin");
    const setMode = async (mode: string, response = Buffer.from("fixture brief\n")) => {
      await rm(pidPath, { force: true });
      await rm(launchMarker, { force: true });
      await rm(commandMarker, { force: true });
      await writeFile(modePath, mode);
      await writeFile(responsePath, response);
    };
    const fault = transport(fixtureBinary, fixtureManifest);
    await setMode("normal");
    const fixtureWrongSource = join(fixtureDir, "wrong-source.json");
    await writeFile(fixtureWrongSource, JSON.stringify({ ...fixtureMetadata,
      sourceCommit: "0".repeat(40) }));
    await refused(() => transport(fixtureBinary, fixtureWrongSource).inspect("brief", state),
      /artifact.*identity/i);
    await assert.rejects(stat(launchMarker), { code: "ENOENT" });
    artifactChecks++;
    for (const mode of ["protocol_wrong", "protocol_invalid_utf8", "protocol_nonzero"]) {
      await setMode(mode);
      await refused(() => fault.inspect("brief", state), /Native inspection protocol/);
      await assert.rejects(stat(commandMarker), { code: "ENOENT" });
      processChecks++;
    }
    for (const [mode, response, pattern] of [
      ["normal", Buffer.from("not json"), /invalid JSON output/],
      ["normal", Buffer.from('{"schema":'), /invalid JSON output/],
      ["normal", Buffer.from('{}{}'), /invalid JSON output/],
      ["normal", Buffer.from([0xff]), /invalid UTF-8 output/],
      ["command_nonzero", Buffer.alloc(0), /child refused/],
    ] as const) {
      await setMode(mode, response);
      await refused(() => fault.inspect("status", state), pattern);
      assert.equal(await readFile(commandMarker, "utf8"), "status");
      processChecks++;
    }
    const finiteStatus = JSON.stringify(expected.status);
    assert.match(finiteStatus, /"creatorBudgetMicros":30000/);
    await setMode("normal", Buffer.from(finiteStatus.replace('"creatorBudgetMicros":30000',
      '"creatorBudgetMicros":1e400')));
    await refused(() => fault.inspect("status", state), /unexpected response shape/);
    processChecks++;
    await setMode("normal", Buffer.from(finiteStatus.replace('"savedResult":"present_unchecked"',
      '"savedResult":"impossible"')));
    await refused(() => fault.inspect("status", state), /unexpected response shape/);
    processChecks++;
    await setMode("normal", Buffer.alloc(0));
    await refused(() => fault.inspect("brief", state), /empty brief output/);
    processChecks++;
    await setMode("normal", Buffer.alloc(2048, "x"));
    await refused(() => transport(fixtureBinary, fixtureManifest, 10_000, 1024).inspect("brief", state),
      /stdout byte limit exceeded/);
    processChecks++;
    await setMode("command_oversize_stderr");
    await refused(() => transport(fixtureBinary, fixtureManifest, 10_000, undefined, 1024).inspect("brief", state),
      /stderr byte limit exceeded/);
    processChecks++;

    const canceled = new AbortController();
    canceled.abort();
    await setMode("normal");
    await refused(() => fault.inspect("brief", state, canceled.signal), /canceled before launch/);
    await assert.rejects(stat(launchMarker), { code: "ENOENT" });
    await assert.rejects(stat(commandMarker), { code: "ENOENT" });
    processChecks++;

    await setMode("protocol_hang");
    const handshake = tracked(signal => fault.inspect("brief", state, signal));
    const handshakePid = await waitForPid(pidPath);
    handshake.controller.abort();
    await refusedOutcome(handshake.outcome, /Native inspection protocol: canceled/);
    await assertReaped(handshakePid);
    await assert.rejects(stat(commandMarker), { code: "ENOENT" });
    processChecks++;

    await setMode("command_hang");
    const command = tracked(signal => fault.inspect("brief", state, signal));
    const commandPid = await waitForPid(pidPath);
    await refused(() => fault.inspect("brief", state), /adapter busy/);
    processChecks++;
    command.controller.abort();
    await refusedOutcome(command.outcome, /Native inspection command: canceled/);
    await assertReaped(commandPid);
    processChecks++;
    await setMode("normal");
    assert.deepEqual(await fault.inspect("brief", state), Buffer.from("fixture brief\n"));
    processChecks++;

    await setMode("protocol_hang");
    const handshakeTimeout = transport(fixtureBinary, fixtureManifest, 500);
    const timedHandshake = tracked(signal => handshakeTimeout.inspect("brief", state, signal));
    const timedHandshakePid = await waitForPid(pidPath);
    await refusedOutcome(timedHandshake.outcome, /Native inspection protocol: deadline exceeded/);
    await assertReaped(timedHandshakePid);
    processChecks++;
    await setMode("command_late_success");
    await refused(() => transport(fixtureBinary, fixtureManifest, 500).inspect("brief", state),
      /Native inspection command: deadline exceeded/);
    assert.equal(await readFile(commandMarker, "utf8"), "brief");
    processChecks++;
    await setMode("normal");
    assert.deepEqual(await handshakeTimeout.inspect("brief", state), Buffer.from("fixture brief\n"));
    processChecks++;
    for (const mode of ["protocol_delay", "command_delay"]) {
      await setMode(mode);
      assert.deepEqual(await transport(fixtureBinary, fixtureManifest, 3500).inspect("brief", state),
        Buffer.from("fixture brief\n"), `single delayed ${mode} phase should fit the deadline`);
      processChecks++;
    }
    await setMode("both_delay");
    await refused(() => transport(fixtureBinary, fixtureManifest, 3500).inspect("brief", state),
      /Native inspection command: deadline exceeded/);
    assert.equal(await readFile(commandMarker, "utf8"), "brief");
    processChecks++;

    guardSelfCheck();
    const disabled = join(varied, `disabled-${filename}`);
    await assert.rejects(stat(disabled), { code: "ENOENT" });
    const unavailable = spawnSync(disabled, ["status", "--state", state], { cwd: repo,
      env: noEnv, encoding: "utf8", timeout: 20_000, maxBuffer: 100_000, windowsHide: true });
    assert.equal(unavailable.error?.code, "ENOENT", "explicit disabled candidate was still launchable");
    for (const readCommand of ["status", "result", "brief"] as const) {
      const file = join(varied, "rollback-brief.md");
      const args = ["--import", offlineGuard, "--import", tsxLoader, "--no-warnings",
        join(repo, "scripts", "operator.mts"), readCommand, "--state", state,
        ...(readCommand === "brief" ? ["--file", file] : [])];
      const result = child(process.execPath, args);
      assert.equal(result.status, 0, `guarded TypeScript ${readCommand}: ${result.stderr}`);
      assert.match(result.stderr, /keryx offline fallback guard active/);
      if (readCommand === "brief") {
        assert.deepEqual(JSON.parse(result.stdout), { saved: resolve(file), private: true });
        assert.deepEqual(await readFile(file), expected.brief.subarray(0, -1));
      } else assert.deepEqual(JSON.parse(result.stdout), expected[readCommand]);
      rollbackChecks++;
    }
    assert.equal(await digestTree(state), before, "inspection or explicit rollback changed original v1 files");
    console.log(JSON.stringify({ fixtureKind: "TypeScript-written synthetic; no settlement evidence",
      artifactChecks, processChecks, parityChecks, explicitGuardedRollback: rollbackChecks,
      guardSelfCheck: 1, platform: process.platform, target,
      authority: "TypeScript remains production; native transport is an explicit read-only evaluator" }));
  } finally {
    for (const entry of active) entry.controller.abort();
    await Promise.all([...active].map(entry => entry.outcome));
    await rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

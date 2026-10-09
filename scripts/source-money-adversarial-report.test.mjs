import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ATTACK_CASES, adversarialEnvironment, buildAdversarialReport, captureProcess, completeCapture,
  readBoundedFile, snapshotSource, writeCaptureArtifacts } from "./source-money-adversarial-report.mjs";

const environment = adversarialEnvironment(process.env);
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "keryx-adversarial-capture-test-"));
console.log(`Retained lifecycle fixtures: ${scratch}`);

// These doubles test the predicate only. Actual EOF claims use real children below.
function completeDouble() {
  return { exitObserved: true, closeObserved: true, exitCode: 0, signal: null, timedOut: false,
    captureOverflow: false, errors: [], stdout: { eof: true }, stderr: { eof: true } };
}
function snapshotDouble() {
  return { valid: true, workingTree: "clean", head: "1".repeat(40), tree: "2".repeat(40),
    inputs: { files: 1, bytes: 7, sha256: "3".repeat(64) },
    runtime: { node: "24.21.0", executable: "/fixture/node", vitestMetadataSha256: "4".repeat(64) },
    captures: Object.fromEntries(["head", "tree", "status", "files"].map(key => [key, completeDouble()])) };
}
function rawReport(assertions = ATTACK_CASES.map(id => ({ title: `${id}: fixture`, status: "passed" }))) {
  return { success: true, numTotalTests: assertions.length,
    numPassedTests: assertions.filter(test => test.status === "passed").length,
    numFailedTests: assertions.filter(test => test.status === "failed").length,
    testResults: [{ assertionResults: assertions }] };
}
function report(overrides = {}) {
  return buildAdversarialReport({ capture: completeDouble(), before: snapshotDouble(), after: snapshotDouble(),
    reportBytes: Buffer.from(JSON.stringify(rawReport())), ...overrides });
}

test("complete offline report retains its limits and exact case inventory", () => {
  const result = report();
  assert.equal(result.success, true);
  assert.equal(result.sourceCommit, "1".repeat(40));
  assert.deepEqual(result.tests, { total: 8, passed: 8, failed: 0 });
  assert.deepEqual(result.cases.map(test => test.id), ATTACK_CASES);
  assert.equal(result.liveTestnetRefusal, null);
  assert.equal(result.vitestReport.sha256.length, 64);
  assert.match(result.authority, /no live settlement or provider evidence/);
});

for (const [name, mutate] of [
  ["nonzero", value => { value.exitCode = 1; }],
  ["signal", value => { value.signal = "SIGTERM"; }],
  ["timeout", value => { value.timedOut = true; }],
  ["overflow", value => { value.captureOverflow = true; }],
  ["process error", value => { value.errors.push({ code: "ENOENT" }); }],
  ["missing exit", value => { value.exitObserved = false; }],
  ["missing close", value => { value.closeObserved = false; }],
  ["missing stdout end", value => { value.stdout.eof = false; }],
  ["missing stderr end", value => { value.stderr.eof = false; }],
]) test(`refuses a passing JSON report with ${name}`, () => {
  const capture = completeDouble(); mutate(capture);
  const result = report({ capture });
  assert.equal(result.success, false);
  assert.ok(result.refusalReasons.includes("incomplete_process_capture"));
});

for (const [name, mutate] of [
  ["dirty tree", value => { value.workingTree = "modified"; }],
  ["head drift", value => { value.head = "5".repeat(40); }],
  ["tree drift", value => { value.tree = "5".repeat(40); }],
  ["source drift", value => { value.inputs.sha256 = "5".repeat(64); }],
  ["runtime drift", value => { value.runtime.node = "24.22.0"; }],
  ["dependency metadata drift", value => { value.runtime.vitestMetadataSha256 = "5".repeat(64); }],
  ["missing digest", value => { delete value.inputs.sha256; }],
  ["missing source fields", value => { delete value.head; delete value.tree; }],
  ["failed Git capture", value => { value.captures.status.exitCode = 1; }],
  ["Git output truncated", value => { value.captures.files.captureOverflow = true; }],
]) test(`refuses ${name} instead of classifying it as clean published source`, () => {
  const after = snapshotDouble(); mutate(after);
  const result = report({ after });
  assert.equal(result.success, false);
  assert.equal(result.sourceCommit, null);
  assert.equal(result.workingTree, "modified-or-unqualified");
  assert.ok(result.refusalReasons.includes("source_binding_unqualified_or_changed"));
});

test("both omitted source digests cannot qualify through undefined equality", () => {
  const before = snapshotDouble(), after = snapshotDouble();
  delete before.inputs.sha256; delete after.inputs.sha256;
  assert.equal(report({ before, after }).success, false);
});

test("missing and duplicate attacks refuse the report even with consistent passed totals", () => {
  const assertions = rawReport().testResults[0].assertionResults;
  const missing = report({ reportBytes: Buffer.from(JSON.stringify(rawReport(assertions.slice(1)))) });
  assert.ok(missing.refusalReasons.includes(`missing_case:${ATTACK_CASES[0]}`));
  assert.equal(missing.success, false);
  const duplicate = report({ reportBytes: Buffer.from(JSON.stringify(rawReport([...assertions, assertions[0]]))) });
  assert.ok(duplicate.refusalReasons.includes(`duplicate_case:${ATTACK_CASES[0]}`));
  assert.equal(duplicate.success, false);
});

test("a failed or skipped case and a false JSON success cannot pass", () => {
  for (const status of ["failed", "pending", "skipped"]) {
    const assertions = rawReport().testResults[0].assertionResults;
    assertions[0].status = status;
    assert.equal(report({ reportBytes: Buffer.from(JSON.stringify(rawReport(assertions))) }).success, false);
  }
  assert.equal(report({ reportBytes: Buffer.from(JSON.stringify({ ...rawReport(), success: false })) }).success, false);
});

test("malformed JSON, fatal UTF-8, missing output, mismatched counts and oversized output refuse", () => {
  const invalid = rawReport(); invalid.numTotalTests++;
  for (const reportBytes of [undefined, Buffer.from("{"), Buffer.from([0xff]), Buffer.from(JSON.stringify(invalid)),
    Buffer.from(JSON.stringify({ ...rawReport(), testResults: {} })), Buffer.alloc(4 * 1024 * 1024 + 1)]) {
    const result = report({ reportBytes });
    assert.equal(result.success, false);
    assert.equal(result.tests, null);
    assert.ok(result.refusalReasons.includes("missing_or_malformed_vitest_report"));
  }
});

test("environment admits OS paths and explicit offline flags, without credential or preload authority", () => {
  const env = adversarialEnvironment({ PATH: "/fixture", SystemRoot: "C:\\Windows", NODE_OPTIONS: "--import attacker",
    OPENAI_API_KEY: "synthetic-canary", PRIVATE_KEY: "synthetic-canary", SUPABASE_URL: "shared", KERYX_NETWORK: "arc" });
  assert.equal(env.PATH, "/fixture"); assert.equal(env.SystemRoot, "C:\\Windows");
  assert.equal(env.KERYX_FORCE_OFFLINE, "1"); assert.equal(env.KERYX_NETWORK, "arcTestnet");
  assert.equal(env.SUPABASE_URL, ""); assert.equal(env.KERYX_EXTERNAL_DISCOVERY, "0");
  assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.PRIVATE_KEY, undefined);
});

async function trap(name, code, bounds = {}) {
  const capture = await captureProcess(process.execPath, ["-e", code], { cwd: scratch, env: environment, timeoutMs: 5000, ...bounds });
  await writeCaptureArtifacts(scratch, name, capture);
  return capture;
}

test("actual child stdout/stderr end, exit and close produce a complete capture", { timeout: 10_000 }, async () => {
  const capture = await trap("natural-eof", "process.stdout.write('out'); process.stderr.write('err');");
  assert.equal(completeCapture(capture), true);
  assert.equal(capture.stdout.raw.toString(), "out"); assert.equal(capture.stderr.raw.toString(), "err");
  assert.equal(capture.stdout.bytesRetained, 3); assert.equal(capture.stderr.bytesRetained, 3);
  assert.equal(capture.stdout.sha256.length, 64);
});

test("actual nonzero exit preserves both partial streams and refuses success", { timeout: 10_000 }, async () => {
  const capture = await trap("nonzero-exit", "process.stdout.write('before'); process.stderr.write('failure'); process.exitCode = 7;");
  assert.equal(capture.exitCode, 7); assert.equal(capture.closeObserved, true);
  assert.equal(capture.stdout.raw.toString(), "before"); assert.equal(capture.stderr.raw.toString(), "failure");
  assert.equal(completeCapture(capture), false);
});

test("actual timeout stops the owned child and retains bounded output", { timeout: 10_000 }, async () => {
  const capture = await trap("timeout", "process.stdout.write('started'); setInterval(() => {}, 1000);", { timeoutMs: 1000 });
  assert.equal(capture.timedOut, true); assert.equal(completeCapture(capture), false);
  assert.equal(capture.stdout.raw.toString(), "started"); assert.equal(capture.closeObserved, true);
  assert.ok(capture.elapsedMs < 8000); assert.equal(capture.cleanup.attempted, true);
});

test("actual overflow cannot convert a bounded partial capture into EOF success", { timeout: 10_000 }, async () => {
  const capture = await trap("overflow", "process.stdout.write('x'.repeat(100000)); setInterval(() => {}, 1000);", { maxBytes: 64 });
  assert.equal(capture.captureOverflow, true); assert.equal(completeCapture(capture), false);
  assert.equal(capture.stdout.raw.length + capture.stderr.raw.length, 64);
  assert.ok(capture.stdout.bytesObserved > 64); assert.equal(capture.closeObserved, true);
});

// Windows Node numeric-FD inheritance does not retain this fixture pipe after the leader exits.
// Keep the retained Windows failures; the Ubuntu CI checks job exercises actual POSIX pipe ownership.
test("actual POSIX descendant-held pipes wait for their tail and real EOF after leader exit", {
  timeout: 10_000, skip: process.platform === "win32" ? "POSIX inherited-pipe lifecycle; runs on Linux CI" : false,
}, async () => {
  const descendant = "setTimeout(() => { process.stdout.write('tail-out'); process.stderr.write('tail-err'); }, 200);";
  const code = `const {spawn} = require('node:child_process'); process.stdout.write('leader:');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio: ['ignore', 1, 2], windowsHide: true, env: process.env});
    child.once('error', () => { process.exitCode = 2; });
    child.once('spawn', () => { child.unref(); process.exit(0); });`;
  const capture = await trap("descendant-eof", code);
  assert.equal(completeCapture(capture), true);
  assert.equal(capture.stdout.raw.toString(), "leader:tail-out"); assert.equal(capture.stderr.raw.toString(), "tail-err");
  assert.ok(capture.elapsedMs >= 200);
});

test("actual missing executable records its error without inventing exit or success", { timeout: 10_000 }, async () => {
  const capture = await captureProcess(path.join(scratch, "not-present-executable"), [], { cwd: scratch, env: environment, timeoutMs: 1000 });
  await writeCaptureArtifacts(scratch, "spawn-error", capture);
  assert.equal(completeCapture(capture), false); assert.equal(capture.exitObserved, false);
  assert.equal(capture.closeObserved, true); assert.equal(capture.errors[0].code, "ENOENT");
});

test("artifact writes are exclusive and bounded file reads refuse oversize/missing output", async () => {
  const file = path.join(scratch, "bounded.json");
  await fs.writeFile(file, "{}", { flag: "wx" });
  assert.equal((await readBoundedFile(file, 2)).toString(), "{}");
  await assert.rejects(readBoundedFile(file, 1), /bounds/);
  await assert.rejects(readBoundedFile(path.join(scratch, "missing.json"), 1024));
  const capture = await trap("exclusive-artifact", "process.stdout.write('retained');");
  await assert.rejects(writeCaptureArtifacts(scratch, "exclusive-artifact", capture), { code: "EEXIST" });
  assert.equal((await fs.readFile(path.join(scratch, "exclusive-artifact.stdout.raw"))).toString(), "retained");
});

test("actual isolated Git snapshots retain source/config/workflow inputs and detect source drift", { timeout: 30_000 }, async () => {
  const root = path.join(scratch, "source-fixture");
  const fixed = ["scripts/test-source-money-adversarial.mjs", "scripts/source-money-adversarial-report.mjs",
    "scripts/source-money-adversarial-report.test.mjs", ".github/workflows/ci.yml", "package.json", "package-lock.json",
    "vitest.config.mts", "tsconfig.json", "lib/fixture.ts", "test-support/fixture.ts", ".gitignore"];
  for (const name of fixed) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), name === ".gitignore" ? "node_modules/\n" : `synthetic fixture: ${name}\n`, { flag: "wx" });
  }
  // A synthetic metadata-only package for this isolated snapshot test; no dependency install or executable import.
  await fs.mkdir(path.join(root, "node_modules/vitest"), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules/vitest/package.json"), '{"version":"synthetic-fixture"}', { flag: "wx" });
  const hooks = path.join(scratch, "empty-hooks"); await fs.mkdir(hooks);
  async function git(name, args) {
    const capture = await captureProcess("git", ["-c", `core.hooksPath=${hooks}`, "-c", "commit.gpgSign=false",
      "-c", "user.name=Synthetic fixture", "-c", "user.email=fixture@example.invalid", ...args],
    { cwd: root, env: environment, timeoutMs: 5000 });
    await writeCaptureArtifacts(scratch, name, capture);
    assert.equal(completeCapture(capture), true);
  }
  await git("fixture-init", ["init", "--quiet", "--template="]);
  await git("fixture-add", ["add", "--", "."]);
  await git("fixture-commit", ["commit", "--quiet", "-m", "synthetic offline source fixture"]);
  const before = await snapshotSource(root, environment, { directory: scratch, phase: "fixture-before" });
  assert.equal(before.valid, true); assert.equal(before.workingTree, "clean");
  assert.ok(before.inputs.manifest.some(file => file.path === ".github/workflows/ci.yml"));
  assert.ok(before.inputs.manifest.some(file => file.path === "package-lock.json"));
  assert.ok(before.inputs.manifest.some(file => file.path === "lib/fixture.ts"));
  assert.equal(before.runtime.dependencyClosure, "not attested by this report");
  await fs.writeFile(path.join(root, "lib/fixture.ts"), "changed synthetic source\n");
  const after = await snapshotSource(root, environment, { directory: scratch, phase: "fixture-after" });
  assert.equal(after.valid, true); assert.equal(after.workingTree, "modified");
  assert.notEqual(before.inputs.sha256, after.inputs.sha256);
  assert.equal(report({ before, after }).success, false);
});

test("actual Git failure cannot produce a qualified source snapshot", { timeout: 15_000 }, async () => {
  const root = path.join(scratch, "not-a-repository"); await fs.mkdir(root);
  const snapshot = await snapshotSource(root, environment, { directory: scratch, phase: "outside-git" });
  assert.equal(snapshot.valid, false);
  assert.ok(Object.values(snapshot.captures).some(capture => !completeCapture(capture)));
  assert.equal(report({ before: snapshot, after: snapshot }).success, false);
});

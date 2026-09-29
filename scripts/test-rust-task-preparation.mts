/** Differential acceptance for pure Rust preparation of the existing local v1 task files. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buyerRequestSchema } from "../lib/buyer/protocol.ts";
import { operatorTaskStatus } from "../lib/operator/task.ts";
import { createLegacyOperatorTask } from "../test-support/legacy-operator-task.ts";

const repo = resolve(import.meta.dirname, "..");
const executable = process.platform === "win32" ? ".exe" : "";
const prepareExe = resolve(process.env.KERYX_RUST_PREPARE_EXAMPLE
  ?? join(repo, "rust", "target", "release", "examples", `prepare-task-v1${executable}`));
const engineExe = resolve(process.env.KERYX_RUST_ENGINE
  ?? join(repo, "rust", "target", "release", `keryx-engine${executable}`));
const tsxLoader = import.meta.resolve("tsx");
const offlineGuard = pathToFileURL(join(repo, "scripts", "rust-offline-fallback-guard.mjs")).href;
const noEnv = { PATH: process.env.PATH ?? "", PATHEXT: process.env.PATHEXT ?? "",
  SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" };
const payee = `0x${"a".repeat(40)}`;
const request = { question: "Synthetic task preparation question", budget: 0.05,
  researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" } as const;
const maxTotalMicros = "1000000";
let byteParity = 0;
let pairedRefusals = 0;
let tinyCandidateRefusals = 0;
let injectedInputRefusals = 0;
let bridgeFormatRefusals = 0;
let materializedReopens = 0;
let historicalReadRefusals = 0;

type Envelope = { request: unknown; payee: unknown; maxTotalMicros: unknown; id: unknown; createdAt: unknown };

function serialized(value: unknown) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }

function run(exe: string, args: string[], input?: string | Buffer, env: NodeJS.ProcessEnv = noEnv) {
  assert(isAbsolute(exe), "test executable must be absolute");
  const result = spawnSync(exe, args, { cwd: repo, env, input, encoding: "utf8",
    timeout: 20_000, maxBuffer: 128_000, windowsHide: true });
  if (result.error) throw new Error(`Subprocess did not finish: ${result.error.message}`);
  return result;
}

function prepare(input: Envelope) {
  const bytes = JSON.stringify(input);
  assert(Buffer.byteLength(bytes) <= 16_384, "test envelope exceeds bridge input cap");
  return run(prepareExe, [], bytes);
}

function operator(command: "status" | "result" | "brief", state: string,
  output?: string, guarded = false, disabled?: string) {
  const env = disabled ? { ...noEnv, KERYX_RUST_ENGINE: disabled } : noEnv;
  return run(process.execPath,
    [...(guarded ? ["--import", offlineGuard] : []), "--import", tsxLoader, "--no-warnings",
      join(repo, "scripts", "operator.mts"), command, "--state", state,
      ...(output ? ["--file", output] : [])], undefined, env);
}

async function treeDigest(directory: string) {
  const entries: string[] = [];
  async function walk(path: string, relative: string) {
    for (const name of (await readdir(path)).sort()) {
      const file = join(path, name);
      const key = join(relative, name);
      const kind = await lstat(file);
      if (kind.isDirectory()) { entries.push(`dir ${key}`); await walk(file, key); }
      else if (kind.isFile()) {
        entries.push(`file ${key} ${createHash("sha256").update(await readFile(file)).digest("hex")}`);
      } else throw new Error(`Unexpected synthetic tree entry: ${key}`);
    }
  }
  await walk(directory, "");
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

function questionForBytes(target: number, withQuestion: (value: string) => unknown) {
  const emptyBytes = serialized(withQuestion("")).length;
  const delta = target - emptyBytes;
  assert(delta >= 1, `Cannot construct ${target}-byte fixture`);
  const controls = Math.floor((delta - 1) / 6);
  const ascii = delta - 1 - controls * 6;
  const question = `Q${"\u0000".repeat(controls)}${"x".repeat(ascii)}`;
  assert(question.length <= 2_000, "byte-boundary question exceeds TS UTF-16 limit");
  assert.equal(serialized(withQuestion(question)).length, target);
  return question;
}

function assertRefused(result: ReturnType<typeof run>, label: string, diagnostic?: RegExp) {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
  assert.equal(result.stdout, "", `${label} emitted partial success output`);
  assert(result.stderr.trim().length > 0, `${label} lost its refusal diagnostic`);
  if (diagnostic) assert.match(result.stderr, diagnostic, label);
}

async function accepted(root: string, label: string, input: { request: unknown; payee: string;
  maxTotalMicros: string }, materialize = false) {
  const state = join(root, label);
  const created = await createLegacyOperatorTask(state, input);
  const requestBytes = await readFile(join(state, "request.json"));
  const taskBytes = await readFile(join(state, "task.json"));
  assert(requestBytes.length <= 8192 && taskBytes.length <= 8192);
  const task = JSON.parse(taskBytes.toString("utf8"));
  const envelope = { ...input, id: task.id, createdAt: task.createdAt };
  const before = await treeDigest(root);
  const rust = prepare(envelope);
  assert.equal(rust.status, 0, `${label} Rust preparation: ${rust.stderr}`);
  const output = JSON.parse(rust.stdout);
  assert.deepEqual(Object.keys(output).sort(), ["requestJson", "taskId", "taskJson"]);
  assert.equal(output.taskId, created.taskId);
  assert.deepEqual(Buffer.from(output.requestJson, "utf8"), requestBytes, `${label} request bytes`);
  assert.deepEqual(Buffer.from(output.taskJson, "utf8"), taskBytes, `${label} task bytes`);
  assert.equal(await treeDigest(root), before, `${label} pure preparation changed files`);
  byteParity++;

  if (materialize) {
    // This write belongs only to the test harness; no native writer is evaluated.
    const preparedState = join(root, `${label}-harness-materialized`);
    await mkdir(preparedState);
    await writeFile(join(preparedState, "request.json"), Buffer.from(output.requestJson, "utf8"), { flag: "wx" });
    await writeFile(join(preparedState, "task.json"), Buffer.from(output.taskJson, "utf8"), { flag: "wx" });
    const status = await operatorTaskStatus(preparedState);
    assert.equal(status.taskId, created.taskId);
    assert.equal(status.stage, "ready");
    assert.equal(status.payment, "unknown");
    assert.equal(status.delivery, "unknown");
    assert.equal(status.savedResult, "absent");
    const disabled = join(root, `disabled-native${executable}`);
    await assert.rejects(stat(disabled), { code: "ENOENT" });
    const preparedBefore = await treeDigest(preparedState);
    for (let restart = 0; restart < 2; restart++) {
      const read = operator("status", preparedState, undefined, true, disabled);
      assert.equal(read.status, 0, `guarded TS restart ${restart}: ${read.stderr}`);
      assert.match(read.stderr, /keryx offline fallback guard active/);
      assert.deepEqual(JSON.parse(read.stdout), status);
      assert.equal(await treeDigest(preparedState), preparedBefore, "guarded TS reopening changed v1 files");
      materializedReopens++;
    }
  }
  return { state, task, requestBytes, taskBytes };
}

async function pairedRefusal(root: string, label: string, input: { request: unknown; payee: unknown;
  maxTotalMicros: unknown }, id: string, createdAt: string, diagnostic?: RegExp) {
  const state = join(root, label);
  await assert.rejects(createLegacyOperatorTask(state, input as Parameters<typeof createLegacyOperatorTask>[1]),
    undefined, `${label} TypeScript unexpectedly accepted invalid input`);
  await assert.rejects(stat(state), { code: "ENOENT" });
  const before = await treeDigest(root);
  assertRefused(prepare({ ...input, id, createdAt }), `${label} Rust`, diagnostic);
  assert.equal(await treeDigest(root), before, `${label} refusal changed files`);
  pairedRefusals++;
}

async function candidateOnlyRefusal(root: string, label: string, envelope: Envelope,
  diagnostic?: RegExp) {
  const before = await treeDigest(root);
  assertRefused(prepare(envelope), label, diagnostic);
  assert.equal(await treeDigest(root), before, `${label} refusal changed files`);
}

async function rawBridgeRefusal(root: string, label: string, input: string | Buffer,
  diagnostic?: RegExp) {
  const before = await treeDigest(root);
  assertRefused(run(prepareExe, [], input), label, diagnostic);
  assert.equal(await treeDigest(root), before, `${label} refusal changed files`);
  bridgeFormatRefusals++;
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
  const guarded = run(process.execPath, ["--import", offlineGuard, "--input-type=module", "-e", probe]);
  assert.equal(guarded.status, 0, guarded.stderr);
  assert.match(guarded.stdout, /offline guard blocked network and child launch/);
  assert.match(guarded.stderr, /keryx offline fallback guard active/);
}

async function historicalOverBudget(root: string) {
  const state = join(root, "raw-budget-over-half");
  await createLegacyOperatorTask(state, { request, payee, maxTotalMicros });
  const taskPath = join(state, "task.json");
  const requestPath = join(state, "request.json");
  const task = JSON.parse(await readFile(taskPath, "utf8"));
  // The old Rust reader compared only rounded micros and accepted this raw
  // value even though the TS schema's max(0.5) rejects it.
  const invalidRequest = { ...task.request, budget: 0.500000000000001 };
  assert.equal(buyerRequestSchema.safeParse(invalidRequest).success, false,
    "the old Rust-only discrepancy requires a TypeScript-refused raw budget");
  await writeFile(requestPath, serialized(invalidRequest));
  await writeFile(taskPath, serialized({ ...task, request: invalidRequest }));
  const before = await treeDigest(state);
  for (const command of ["status", "result", "brief"] as const) {
    const output = command === "brief" ? join(root, `rejected-${command}.md`) : undefined;
    const ts = operator(command, state, output);
    const rust = run(engineExe, [command, "--state", state, ...(output ? ["--file", output] : [])]);
    assertRefused(ts, `TS ${command} raw >0.5`);
    assertRefused(rust, `Rust ${command} raw >0.5`, /invalid creator budget/i);
    if (output) await assert.rejects(stat(output), { code: "ENOENT" });
    assert.equal(await treeDigest(state), before, `${command} changed invalid source files`);
    historicalReadRefusals++;
  }
}

async function main() {
  assert(isAbsolute(prepareExe) && isAbsolute(engineExe));
  assert((await stat(prepareExe)).isFile(), "build the pure Rust example first");
  assert((await stat(engineExe)).isFile(), "build the Rust read-only CLI first");
  const tempParent = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(tempParent, "keryx-task-prep-")));
  assert.equal(dirname(root), tempParent);
  assert(basename(root).startsWith("keryx-task-prep-"));
  try {
    const seed = await accepted(root, "seed", { request, payee, maxTotalMicros }, true);
    const id = seed.task.id as string;
    const createdAt = seed.task.createdAt as string;
    const make = (question: string, changes: Record<string, unknown> = {}) =>
      ({ request: { ...request, question, ...changes }, payee, maxTotalMicros });
    for (const [label, input] of [
      ["deep", make("Deep source comparison", { researchMode: "deep" })],
      ["trim", make(" \t  leading and trailing \n ")],
      ["astral-pua", make("😀 and \uE000 with [1]")],
      ["lone-high", make("high \uD800 and literal \\uD800")],
      ["lone-low", make("low \uDC00 and newline\n")],
      ["controls", make("control \u0000\u0001\t and quote \" and slash \\ trail")],
      ["max-utf16", make("😀".repeat(1000))],
      ["one-micro", { request: { ...request, budget: 0.000001 }, payee, maxTotalMicros: "2" }],
      ["half-max", { request: { ...request, budget: 0.5 }, payee, maxTotalMicros: "1000000" }],
      ["half-adjacent-below", { request: { ...request, budget: 0.49999999999999994 },
        payee, maxTotalMicros: "1000000" }],
      ["near-micro", { request: { ...request, budget: 0.05000000000000001 }, payee, maxTotalMicros }],
      ["mixed-payee", { request, payee: `0x${"aA".repeat(20)}`, maxTotalMicros }],
    ] as Array<[string, { request: unknown; payee: string; maxTotalMicros: string }]>) {
      await accepted(root, label, input, label === "lone-high");
    }

    const withRequestQuestion = (question: string) => ({ ...request, question });
    const withTaskQuestion = (question: string) => ({ ...seed.task,
      request: { ...seed.task.request, question } });
    for (const target of [8191, 8192] as const) {
      const question = questionForBytes(target, withTaskQuestion);
      const result = await accepted(root, `task-${target}`, make(question));
      assert.equal(result.taskBytes.length, target, `task ${target} actual writer boundary`);
    }
    for (const target of [8191, 8192, 8193] as const) {
      const question = questionForBytes(target, withRequestQuestion);
      await pairedRefusal(root, `request-${target}`, make(question), id, createdAt,
        /8 KB|size|large|limit/i);
    }
    const taskOver = questionForBytes(8193, withTaskQuestion);
    await pairedRefusal(root, "task-8193", make(taskOver), id, createdAt, /8 KB|size|large|limit/i);

    for (const [label, input] of [
      ["empty-trimmed-question", make(" \t\n")],
      ["long-question", make("😀".repeat(1001))],
      ["wrong-question-type", { ...make("question"), request: { ...request, question: 3 } }],
      ["wrong-mode", make("question", { researchMode: "medium" })],
      ["wrong-package", make("question", { packageVersion: "2.0.0" })],
      ["missing-response-mode", { ...make("question"), request: { question: "question", budget: 0.05,
        researchMode: "quick", packageVersion: "1.0.0" } }],
      ["extra-request-field", make("question", { unexpected: true })],
      ["zero-budget", { ...make("question"), request: { ...request, budget: 0 } }],
      ["negative-budget", { ...make("question"), request: { ...request, budget: -0.000001 } }],
      ["over-half-budget", { ...make("question"), request: { ...request,
        budget: 0.500000000000001 } }],
      ["half-adjacent-above", { ...make("question"), request: { ...request,
        budget: 0.5000000000000001 } }],
      ["fractional-micro", { ...make("question"), request: { ...request, budget: 0.0000015 } }],
      ["zero-payee", { ...make("question"), payee: `0x${"0".repeat(40)}` }],
      ["malformed-payee", { ...make("question"), payee: "not-an-address" }],
      ["cap-equals-budget", { ...make("question"), maxTotalMicros: "50000" }],
      ["cap-above-one", { ...make("question"), maxTotalMicros: "1000001" }],
      ["cap-leading-zero", { ...make("question"), maxTotalMicros: "050001" }],
      ["cap-not-string", { ...make("question"), maxTotalMicros: 50001 }],
    ] as Array<[string, { request: unknown; payee: unknown; maxTotalMicros: unknown }]>) {
      await pairedRefusal(root, label, input, id, createdAt);
    }

    const tiny = { request: { ...request, budget: 1e-15 }, payee, maxTotalMicros };
    const tinyState = join(root, "ts-accepted-tiny");
    await createLegacyOperatorTask(tinyState, tiny);
    const tinyTask = JSON.parse(await readFile(join(tinyState, "task.json"), "utf8"));
    await candidateOnlyRefusal(root, "positive zero-micro candidate",
      { ...tiny, id: tinyTask.id, createdAt: tinyTask.createdAt }, /zero micro|TypeScript/i);
    tinyCandidateRefusals++;
    await candidateOnlyRefusal(root, "malformed injected id", { ...make("question"),
      id: "bad-id", createdAt });
    injectedInputRefusals++;
    await candidateOnlyRefusal(root, "malformed injected time", { ...make("question"),
      id, createdAt: "2026-09-29T00:00:60Z" });
    injectedInputRefusals++;
    const validEnvelope = { ...make("question"), id, createdAt };
    await rawBridgeRefusal(root, "malformed bridge JSON", '{"request":');
    await rawBridgeRefusal(root, "missing bridge field",
      JSON.stringify({ request: validEnvelope.request, payee, maxTotalMicros, createdAt }));
    await rawBridgeRefusal(root, "extra bridge field",
      JSON.stringify({ ...validEnvelope, extra: true }));
    await rawBridgeRefusal(root, "bridge input exceeds 16 KiB",
      `${JSON.stringify(validEnvelope)}${" ".repeat(16_385)}`, /16 KiB|exceeds/i);
    await rawBridgeRefusal(root, "invalid bridge UTF-8", Buffer.from([0xff]));
    await historicalOverBudget(root);
    assertOfflineGuard();
    console.log(JSON.stringify({ fixtureKind: "historical TypeScript-created synthetic v1; no settlement",
      byteParity, pairedRefusals, tinyCandidateRefusals, injectedInputRefusals,
      bridgeFormatRefusals, materializedReopens, historicalReadRefusals,
      offlineGuardSelfCheck: 1, platform: process.platform,
      authority: "This preparation parity fixture is test-only; production creation uses the packaged native writer, while payment remains TypeScript" }));
  } finally {
    // The only recursive removal is the exact directory just created under the OS temp root.
    assert.equal(dirname(root), tempParent);
    assert(basename(root).startsWith("keryx-task-prep-"));
    await rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

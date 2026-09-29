/** Historical TypeScript v1 fixture versus bounded native preparation/publication. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink,
  unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { operatorTaskStatus } from "../lib/operator/task.ts";
import { WorkspaceStore, type DesktopTaskWriter } from "../desktop/src/workspace.ts";
import { parseBuyerBudget } from "../lib/a2a/buyer-workspace.ts";
import { addressSchema } from "../lib/buyer/protocol.ts";
import { createLegacyOperatorTask } from "../test-support/legacy-operator-task.ts";
import { nonPrivateParent, privateParent, treeDigest } from "./rust-task-publication-fixtures.mts";

const repo = resolve(import.meta.dirname, "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const prepareExe = resolve(process.env.KERYX_RUST_PREPARE_EXAMPLE
  ?? join(repo, "rust", "target", "release", "examples", `prepare-task-v1${suffix}`));
const publishExe = resolve(process.env.KERYX_RUST_PUBLISH_EXAMPLE
  ?? join(repo, "rust", "target", "release", "examples", `publish-task-v1${suffix}`));
const readerExe = resolve(process.env.KERYX_RUST_ENGINE
  ?? join(repo, "rust", "target", "release", `keryx-engine${suffix}`));
const tsxLoader = import.meta.resolve("tsx");
const offlineGuard = pathToFileURL(join(repo, "scripts", "rust-offline-fallback-guard.mjs")).href;
const noEnv = { PATH: process.env.PATH ?? "", PATHEXT: process.env.PATHEXT ?? "",
  SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" };
const payee = `0x${"a".repeat(40)}`;
const request = (question: string, budget: number) => ({ question, budget,
  researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" });
type Result = { status: number | null; stdout: string; stderr: string };
type Envelope = { parent: string; child: string; request: unknown; payee: string;
  maxTotalMicros: string; id: string; createdAt: string };
let byteParity = 0;
let preMkdirBarriers = 0;
let candidateOnly = 0;
let callerRefusals = 0;
let guardedReopens = 0;
let fullPublications = 0;
let collisionRefusals = 0;
let nativeReopens = 0;
let guardedNativeReopens = 0;
let desktopReopens = 0;
let processExitUncertain = false;

function run(executable: string, args: string[], input?: string | Buffer,
  env: NodeJS.ProcessEnv = noEnv): Result {
  assert(isAbsolute(executable), "acceptance executable must be absolute");
  const result = spawnSync(executable, args, { cwd: repo, env, input, encoding: "utf8",
    timeout: 20_000, maxBuffer: 128_000, windowsHide: true });
  if (result.error || result.status === null || result.signal) {
    processExitUncertain = true;
    throw new Error(`Subprocess exit unconfirmed: ${result.error?.message ?? result.signal ?? "no exit code"}`);
  }
  return result;
}

function native(executable: string, envelope: object, args: string[] = []) {
  const input = JSON.stringify(envelope);
  assert(Buffer.byteLength(input) <= 16_384, "native bridge envelope must remain bounded");
  return run(executable, executable === publishExe && process.platform === "win32"
    ? ["--evaluation-current-user-owner", ...args] : args, input);
}

function operator(command: "status", state: string, guarded = false, disabled?: string) {
  return run(process.execPath,
    [...(guarded ? ["--import", offlineGuard] : []), "--import", tsxLoader, "--no-warnings",
      join(repo, "scripts", "operator.mts"), command, "--state", state], undefined,
    disabled ? { ...noEnv, KERYX_RUST_ENGINE: disabled } : noEnv);
}

// Historical TypeScript fixture. The production CLI is exercised by the
// separate native-creation integration corpus, never by this legacy oracle.
async function legacyCliCreate(state: string, create: { requestPath: string; cap: string; payee?: string }): Promise<Result> {
  try {
    const bytes = await readFile(create.requestPath);
    if (bytes.length > 8192) throw new Error("Request exceeds 8 KB");
    const request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const selectedPayee = addressSchema.parse(create.payee ?? payee);
    const total = parseBuyerBudget(create.cap, 1);
    if (total === null) throw new Error("Invalid total cap");
    const result = await createLegacyOperatorTask(state, { request, payee: selectedPayee,
      maxTotalMicros: String(Math.round(total * 1e6)) });
    return { status: 0, stdout: JSON.stringify(result), stderr: "" };
  } catch {
    return { status: 1, stdout: "", stderr: "Legacy fixture refused input" };
  }
}

const legacyDesktopWriter: DesktopTaskWriter = {
  async create(input) {
    const result = await createLegacyOperatorTask(join(input.parent, input.child), input);
    return { taskId: result.taskId, child: input.child,
      state: process.platform === "win32" ? "windows_visible_entry_unproven" : "unix_synced" };
  },
  async createWorkspace() { throw new Error("Workspace creation is outside this historical fixture"); },
};

function verifyOfflineGuard() {
  const probe = `
    import assert from "node:assert/strict";
    import { spawnSync } from "node:child_process";
    assert.throws(() => fetch("http://127.0.0.1:1"),
      /offline acceptance forbids network or child process access/);
    assert.throws(() => spawnSync(process.execPath, ["-e", ""]),
      /offline acceptance forbids network or child process access/);
    console.log("guard denied network and child launch");
  `;
  const result = run(process.execPath,
    ["--import", offlineGuard, "--input-type=module", "-e", probe]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /guard denied network and child launch/);
  assert.match(result.stderr, /keryx offline fallback guard active/);
}

function refusal(result: Result, label: string, stage?: string) {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
  assert.equal(result.stdout, "", `${label} emitted success stdout`);
  assert(result.stderr.length > 0, `${label} omitted refusal diagnostic`);
  if (stage) {
    const parsed = JSON.parse(result.stderr) as { state: string; stage: string; message: string };
    assert.deepEqual(Object.keys(parsed).sort(), ["message", "stage", "state"]);
    assert.equal(parsed.state, "refused_unchanged", label);
    assert.equal(parsed.stage, stage, label);
    assert(parsed.message.length > 0, label);
  }
}

async function absent(path: string) { await assert.rejects(stat(path), { code: "ENOENT" }); }

async function sourceEnvelope(state: string, parent: string, child: string): Promise<Envelope> {
  const requestBytes = await readFile(join(state, "request.json"));
  const taskBytes = await readFile(join(state, "task.json"));
  const savedRequest = JSON.parse(requestBytes.toString("utf8"));
  const task = JSON.parse(taskBytes.toString("utf8"));
  assert.deepEqual(task.request, savedRequest, "persisted task/request binding");
  return { parent, child, request: savedRequest, payee: task.payee,
    maxTotalMicros: task.maxTotalMicros, id: task.id, createdAt: task.createdAt };
}

async function accepted(state: string, sibling: string, parent: string, disabled: string) {
  assert.deepEqual((await readdir(state)).sort(), ["request.json", "task.json"]);
  const originalTree = await treeDigest(state);
  const requestBytes = await readFile(join(state, "request.json"));
  const taskBytes = await readFile(join(state, "task.json"));
  const envelope = await sourceEnvelope(state, parent, sibling);
  const { parent: _parent, child: _child, ...preparation } = envelope;
  const result = native(prepareExe, preparation);
  assert.equal(result.status, 0, `native preparation refused historical v1 fixture bytes: ${result.stderr}`);
  assert.equal(result.stderr, "");
  const prepared = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(prepared).sort(), ["requestJson", "taskId", "taskJson"]);
  assert.equal(prepared.taskId, envelope.id);
  assert.deepEqual(Buffer.from(prepared.requestJson, "utf8"), requestBytes);
  assert.deepEqual(Buffer.from(prepared.taskJson, "utf8"), taskBytes);
  const status = await operatorTaskStatus(state);
  assert.equal(status.stage, "ready");
  assert.equal(status.payment, "unknown");
  assert.equal(status.delivery, "unknown");
  byteParity++;

  // This fault precedes mkdir. It proves no-write preflight on this absent sibling,
  // never a reservation or future collision-free publication guarantee.
  const target = join(parent, sibling);
  await absent(target);
  const before = await treeDigest(parent);
  const barrier = native(publishExe, envelope, ["--fail-at", "before-mkdir"]);
  refusal(barrier, `native pre-mkdir ${sibling}`, "before-mkdir");
  assert.equal(JSON.parse(barrier.stderr).message, "injected before-mkdir failure",
    "the selected no-write hook must actually fire");
  await absent(target);
  assert.equal(await treeDigest(parent), before, "pre-mkdir barrier changed source tree");
  preMkdirBarriers++;

  // Use the exact real caller envelope. The checkpoint above did not reserve
  // this name; exclusive mkdir below determines whether this attempt wins.
  const created = native(publishExe, envelope);
  assert.equal(created.status, 0, `native publication refused ${sibling}: ${created.stderr}`);
  assert.equal(created.stderr, "", "successful publication emitted stderr");
  const receipt = JSON.parse(created.stdout);
  assert.deepEqual(Object.keys(receipt).sort(), ["child", "state", "taskId"]);
  assert.equal(receipt.child, sibling);
  assert.equal(receipt.taskId, envelope.id);
  assert.equal(receipt.state, process.platform === "win32"
    ? "windows_visible_entry_unproven" : "unix_synced");
  assert.deepEqual((await readdir(target)).sort(), ["request.json", "task.json"]);
  assert.deepEqual(await readFile(join(target, "request.json")), requestBytes);
  assert.deepEqual(await readFile(join(target, "task.json")), taskBytes);
  assert.equal(await treeDigest(state), originalTree, "native publication changed original caller task");
  fullPublications++;

  const completeTree = await treeDigest(parent);
  const collision = native(publishExe, envelope);
  refusal(collision, `native existing target ${sibling}`, "mkdir");
  assert.equal(await treeDigest(parent), completeTree, "collision changed private parent");
  collisionRefusals++;

  const reopened = await operatorTaskStatus(target);
  assert.deepEqual(reopened, status, "TypeScript status changed for byte-identical native task");
  assert.equal(reopened.stage, "ready");
  assert.equal(reopened.payment, "unknown");
  assert.equal(reopened.delivery, "unknown");
  const rust = run(readerExe, ["status", "--state", target]);
  assert.equal(rust.status, 0, rust.stderr);
  assert.equal(rust.stderr, "");
  assert.deepEqual(JSON.parse(rust.stdout), reopened, "native read-only status differs from TypeScript");
  assert.equal(await treeDigest(parent), completeTree, "read-only reopening changed private parent");
  assert.equal(await treeDigest(state), originalTree, "read-only reopening changed original task");
  nativeReopens++;

  const fresh = operator("status", target, true, disabled);
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(fresh.stderr, /keryx offline fallback guard active/);
  assert.deepEqual(JSON.parse(fresh.stdout), reopened);
  assert.equal(await treeDigest(parent), completeTree, "guarded restart changed private parent");
  guardedNativeReopens++;

  const freshWorkspace = new WorkspaceStore(legacyDesktopWriter);
  await freshWorkspace.select(parent);
  const view = await freshWorkspace.view();
  const matches = view.tasks.filter(row => row.directoryName === sibling);
  assert.equal(matches.length, 1, "desktop did not discover exactly one native task");
  const row = matches[0];
  assert.equal(row.question, (envelope.request as { question: string }).question);
  assert.equal(row.mode, (envelope.request as { researchMode: string }).researchMode);
  assert.equal(row.payee, envelope.payee);
  assert.equal(row.createdAt, envelope.createdAt);
  assert.deepEqual(row.status, reopened);
  assert.deepEqual(await freshWorkspace.refreshTask(row.handle), row);
  assert.equal(await treeDigest(parent), completeTree, "desktop reopening changed private parent");
  desktopReopens++;
  return envelope;
}

async function callerCreateRefusal(parent: string, label: string, requestBytes: Buffer,
  cap: string, selectedPayee = payee) {
  const requestPath = join(parent, `refused-${label}.json`);
  const state = join(parent, `refused-${label}`);
  await writeFile(requestPath, requestBytes);
  await absent(state);
  const before = await treeDigest(parent);
  refusal(await legacyCliCreate(state, { requestPath, cap, payee: selectedPayee }), `legacy CLI fixture ${label}`);
  await absent(state);
  assert.equal(await treeDigest(parent), before, `CLI ${label} mutated source`);
  callerRefusals++;
}

async function desktopRefusal(store: WorkspaceStore, parent: string, label: string, value: object,
  expected: (error: unknown) => boolean) {
  const before = await treeDigest(parent);
  await assert.rejects(store.createTask(value), expected,
    `desktop ${label} refused for the wrong reason or unexpectedly created a task`);
  assert.equal(await treeDigest(parent), before, `desktop ${label} changed workspace`);
  callerRefusals++;
}

async function main() {
  for (const executable of [prepareExe, publishExe, readerExe]) assert((await stat(executable)).isFile());
  // A sibling gives the CLI a genuinely relative --state even if OS temp is on another drive.
  const base = await realpath(dirname(repo));
  const root = await realpath(await mkdtemp(join(base, "keryx-task-admission-")));
  assert.equal(dirname(root), base);
  assert(basename(root).startsWith("keryx-task-admission-"));
  const links: string[] = [];
  try {
    const disabled = join(root, "absent-native-engine" + suffix);
    await absent(disabled);
    verifyOfflineGuard();
    const parent = await privateParent(root);
    const relativeState = relative(repo, join(parent, "cli-relative"));
    assert(!isAbsolute(relativeState));
    assert.equal(resolve(repo, relativeState), join(parent, "cli-relative"));
    const one = join(parent, "request-one.json");
    await writeFile(one, JSON.stringify(request("Actual CLI relative path 🧪", 0.000001)) + "\n");
    const cliRelative = await legacyCliCreate(relativeState,
      { requestPath: one, cap: "0.10" });
    assert.equal(cliRelative.status, 0, cliRelative.stderr);
    assert.equal(JSON.parse(cliRelative.stdout).status, "ready");
    assert.equal(JSON.parse(cliRelative.stdout).buyerState,
      join(resolve(repo, relativeState), "buyer"), "legacy fixture resolved relative state");
    await accepted(join(parent, "cli-relative"), "native-relative-publication", parent, disabled);

    const half = join(parent, "request-half.json");
    await writeFile(half, JSON.stringify(request("Actual CLI half-USDC boundary", 0.5)) + "\n");
    const cliAbsolute = await legacyCliCreate(join(parent, "cli-half"),
      { requestPath: half, cap: "1" });
    assert.equal(cliAbsolute.status, 0, cliAbsolute.stderr);
    await accepted(join(parent, "cli-half"), "native-half-publication", parent, disabled);

    const desktop = new WorkspaceStore(legacyDesktopWriter);
    await desktop.select(parent);
    const desktopInput = { question: "Desktop Unicode 🧪 Việt \uD800", mode: "deep",
      creatorBudget: "0.05", totalCap: "1", payee };
    const row = await desktop.createTask(desktopInput);
    await accepted(join(parent, row.directoryName), `task-${row.status.taskId}`, parent,
      disabled);

    // Legacy CLI accepts a positive value that rounds to zero micros. The
    // native candidate refuses it; original files remain readable by TS.
    const tinyPath = join(parent, "request-tiny.json");
    const tinyState = join(parent, "legacy-tiny");
    await writeFile(tinyPath, JSON.stringify(request("Legacy tiny positive", 1e-15)) + "\n");
    const tiny = await legacyCliCreate(tinyState, { requestPath: tinyPath, cap: "0.10" });
    assert.equal(tiny.status, 0, tiny.stderr);
    const tinyEnvelope = await sourceEnvelope(tinyState, parent, "native-tiny-preflight");
    const tinyHash = await treeDigest(parent);
    const { parent: _tinyParent, child: _tinyChild, ...tinyPreparation } = tinyEnvelope;
    const tinyPrepare = native(prepareExe, tinyPreparation);
    refusal(tinyPrepare, "tiny native prepare");
    assert.match(tinyPrepare.stderr, /creator budget rounds to zero micro-USDC/i);
    await absent(join(parent, tinyEnvelope.child));
    const tinyPublish = native(publishExe, tinyEnvelope, ["--fail-at", "before-mkdir"]);
    refusal(tinyPublish,
      "tiny native publication", "prepare");
    assert.match(JSON.parse(tinyPublish.stderr).message, /creator budget rounds to zero micro-USDC/i);
    await absent(join(parent, tinyEnvelope.child));
    assert.equal(await treeDigest(parent), tinyHash);
    candidateOnly++;

    const unavailable = spawnSync(disabled, ["status", "--state", tinyState],
      { cwd: repo, env: noEnv, encoding: "utf8", timeout: 20_000,
        maxBuffer: 128_000, windowsHide: true });
    assert.equal((unavailable.error as NodeJS.ErrnoException | undefined)?.code, "ENOENT",
      "configured native candidate must be genuinely unavailable");
    const legacyStatus = await operatorTaskStatus(tinyState);
    assert.equal(legacyStatus.stage, "ready");
    assert.equal(legacyStatus.creatorBudgetMicros, 0);
    for (let index = 0; index < 2; index++) {
      const before = await treeDigest(parent);
      const status = operator("status", tinyState, true, disabled);
      assert.equal(status.status, 0, status.stderr);
      assert.match(status.stderr, /keryx offline fallback guard active/);
      assert.deepEqual(JSON.parse(status.stdout), legacyStatus);
      assert.equal(await treeDigest(parent), before);
      guardedReopens++;
    }

    const spaced = join(parent, "CLI name with spaces");
    const spacedResult = await legacyCliCreate(spaced, { requestPath: one, cap: "0.10" });
    assert.equal(spacedResult.status, 0, spacedResult.stderr);
    const spacedEnvelope = await sourceEnvelope(spaced, parent, "native name with spaces");
    const spacedBefore = await treeDigest(parent);
    refusal(native(publishExe, spacedEnvelope, ["--fail-at", "before-mkdir"]),
      "candidate child policy", "child");
    assert.equal(await treeDigest(parent), spacedBefore);
    candidateOnly++;

    const linkedParent = join(root, "linked-private-parent");
    await symlink(parent, linkedParent, process.platform === "win32" ? "junction" : "dir");
    links.push(linkedParent);
    const linkedState = join(linkedParent, "cli-through-link");
    const linkedCreate = await legacyCliCreate(linkedState, { requestPath: one, cap: "0.10" });
    assert.equal(linkedCreate.status, 0, linkedCreate.stderr);
    assert((await stat(join(parent, "cli-through-link"))).isDirectory(),
      "historical fixture link traversal must create in the owned target parent");
    const linkedEnvelope = await sourceEnvelope(join(parent, "cli-through-link"),
      linkedParent, "native-linked-preflight");
    await absent(join(parent, linkedEnvelope.child));
    const linkedBefore = await treeDigest(root);
    refusal(native(publishExe, linkedEnvelope, ["--fail-at", "before-mkdir"]),
      "candidate linked parent policy", "parent");
    await absent(join(parent, linkedEnvelope.child));
    assert.equal(await treeDigest(root), linkedBefore,
      "candidate linked-parent refusal changed source or link");
    candidateOnly++;

    const broad = await nonPrivateParent(root);
    const broadStore = new WorkspaceStore(legacyDesktopWriter);
    await broadStore.select(broad);
    const broadRow = await broadStore.createTask(desktopInput);
    const broadEnvelope = await sourceEnvelope(join(broad, broadRow.directoryName), broad,
      "native-broad-preflight");
    const broadBefore = await treeDigest(broad);
    refusal(native(publishExe, broadEnvelope, ["--fail-at", "before-mkdir"]),
      "candidate parent policy", "parent");
    await absent(join(broad, broadEnvelope.child));
    assert.equal(await treeDigest(broad), broadBefore);
    candidateOnly++;

    // Raw API relative parent refusal is not a CLI incompatibility: the real
    // CLI relative case above resolves to the absolute parent before preflight.
    const rawRelative = { ...(await sourceEnvelope(join(parent, "cli-relative"), parent,
      "raw-relative-parent")), parent: relative(repo, parent) };
    const beforeRelative = await treeDigest(parent);
    refusal(native(publishExe, rawRelative, ["--fail-at", "before-mkdir"]),
      "raw native relative parent", "parent");
    assert.equal(await treeDigest(parent), beforeRelative);
    candidateOnly++;

    await callerCreateRefusal(parent, "malformed", Buffer.from('{"question":'), "0.10");
    await callerCreateRefusal(parent, "utf8", Buffer.from([0xff, 0xfe]), "0.10");
    await callerCreateRefusal(parent, "oversize", Buffer.alloc(8193, 0x20), "0.10");
    await callerCreateRefusal(parent, "cap-decimals", Buffer.from(JSON.stringify(request("cap", 0.05))), "0.0000001");
    await callerCreateRefusal(parent, "payee", Buffer.from(JSON.stringify(request("payee", 0.05))), "0.10", "0x0");
    await desktopRefusal(desktop, parent, "tiny decimal", { ...desktopInput,
      creatorBudget: "0.000000000000001" },
    error => error instanceof Error && /Enter a USDC amount with at most six decimals/.test(error.message));
    await desktopRefusal(desktop, parent, "equal cap", { ...desktopInput,
      totalCap: "0.05" },
    error => error instanceof Error && /Total cap must exceed the creator budget/.test(error.message));
    await desktopRefusal(desktop, parent, "payee", { ...desktopInput, payee: "0x0" },
      error => error instanceof Error && "issues" in error && Array.isArray(error.issues)
        && error.issues.some((issue: { path?: unknown }) => Array.isArray(issue.path)
          && issue.path[0] === "payee"));

    assert.equal(byteParity, 3);
    assert.equal(preMkdirBarriers, 3);
    assert.equal(candidateOnly, 5);
    assert.equal(callerRefusals, 8);
    assert.equal(guardedReopens, 2);
    assert.equal(fullPublications, 3);
    assert.equal(collisionRefusals, 3);
    assert.equal(nativeReopens, 3);
    assert.equal(guardedNativeReopens, 3);
    assert.equal(desktopReopens, 3);
    console.log(`Task admission: ${byteParity} exact persisted-byte parity, `
      + `${preMkdirBarriers} no-write pre-mkdir barriers, ${candidateOnly} candidate-only refusals, `
      + `${callerRefusals} caller refusals, ${guardedReopens} guarded legacy reopenings; `
      + `${fullPublications} full native publications, ${collisionRefusals} preserved collisions, `
      + `${nativeReopens} native/TypeScript reopens, ${guardedNativeReopens} guarded native-task restarts, `
      + `${desktopReopens} fresh desktop discovery/refresh.`);
  } finally {
    if (processExitUncertain) {
      console.error(`Retained synthetic fixture after unconfirmed subprocess exit: ${root}`);
    } else {
      for (const link of links.reverse()) {
        const kind = await lstat(link);
        assert(kind.isSymbolicLink(), "owned fixture link changed type: " + link);
        assert((await realpath(link)).startsWith(root + sep),
          "owned fixture link escaped test root: " + link);
        await unlink(link);
      }
      // Delete only the freshly generated, prefix-checked sibling owned by this process.
      assert.equal(dirname(root), base);
      assert(basename(root).startsWith("keryx-task-admission-"));
      await rm(root, { recursive: true, force: true });
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

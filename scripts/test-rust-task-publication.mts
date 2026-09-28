/** OS acceptance of feature-gated native v1 publication, using only synthetic tasks. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink,
  unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createOperatorTask, operatorTaskStatus } from "../lib/operator/task.ts";

const repo = resolve(import.meta.dirname, "..");
const extension = process.platform === "win32" ? ".exe" : "";
const publisher = resolve(process.env.KERYX_RUST_PUBLISH_EXAMPLE
  ?? join(repo, "rust", "target", "release", "examples", "publish-task-v1" + extension));
const reader = resolve(process.env.KERYX_RUST_ENGINE
  ?? join(repo, "rust", "target", "release", "keryx-engine" + extension));
const tsxLoader = import.meta.resolve("tsx");
const offlineGuard = pathToFileURL(join(repo, "scripts", "rust-offline-fallback-guard.mjs")).href;
const noEnv = { PATH: process.env.PATH ?? "", PATHEXT: process.env.PATHEXT ?? "",
  SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" };
const payee = "0x" + "a".repeat(40);
const request = { question: "Synthetic native publication 🧪 with \uD800 and controls \u0001",
  budget: 0.05, researchMode: "deep", packageVersion: "1.0.0", responseMode: "async" };
const maxTotalMicros = "1000000";
type Envelope = { parent: string; child: string; request: unknown; payee: string;
  maxTotalMicros: string; id: string; createdAt: string };
type ChildResult = { status: number | null; stdout: string; stderr: string };
type Refusal = { state: "refused_unchanged" | "retained_partial" | "complete_unconfirmed";
  stage: string; message: string };
let successChecks = 0;
let refusalChecks = 0;
let concurrencyChecks = 0;
let reopenChecks = 0;
let linkChecks = 0;
let aclChecks = 0;
let crashChecks = 0;
let faultChecks = 0;

function run(executable: string, args: string[], input?: string,
  env: NodeJS.ProcessEnv = noEnv): ChildResult {
  assert(isAbsolute(executable));
  const result = spawnSync(executable, args, { cwd: repo, env, input, encoding: "utf8",
    timeout: 20_000, maxBuffer: 128_000, windowsHide: true });
  if (result.error) throw new Error("Subprocess did not finish: " + result.error.message);
  return result;
}

function publish(envelope: Envelope, args: string[] = []) {
  const input = JSON.stringify(envelope);
  assert(Buffer.byteLength(input) <= 16_384);
  return run(publisher, args, input);
}

async function publishConcurrent(envelope: Envelope): Promise<ChildResult> {
  const input = JSON.stringify(envelope);
  assert(Buffer.byteLength(input) <= 16_384);
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(publisher, [], { cwd: repo, env: noEnv, shell: false,
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let tooLarge = false;
    const timeout = setTimeout(() => { child.kill("SIGKILL"); }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 128_000) { tooLarge = true; child.kill("SIGKILL"); }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > 128_000) { tooLarge = true; child.kill("SIGKILL"); }
    });
    child.on("error", error => { clearTimeout(timeout); rejectChild(error); });
    child.on("close", status => {
      clearTimeout(timeout);
      if (tooLarge) rejectChild(new Error("Native concurrent response exceeded test bounds"));
      else resolveChild({ status, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

async function crashPausedPublisher(envelope: Envelope,
  stage: "after-mkdir" | "request-close" | "task-close") {
  const input = JSON.stringify(envelope);
  assert(Buffer.byteLength(input) <= 16_384);
  const marker = "KERYX_PUBLICATION_PAUSED:" + stage;
  return new Promise<ChildResult>((resolveChild, rejectChild) => {
    const child = spawn(publisher, ["--pause-after", stage], { cwd: repo, env: noEnv,
      shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let sawMarker = false;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 128_000) { timedOut = true; child.kill("SIGKILL"); }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > 128_000) { timedOut = true; child.kill("SIGKILL"); }
      if (stderr.includes(marker) && !sawMarker) {
        sawMarker = true;
        child.kill("SIGKILL");
      }
    });
    child.on("error", error => { clearTimeout(timeout); rejectChild(error); });
    child.on("close", status => {
      clearTimeout(timeout);
      if (timedOut || !sawMarker) rejectChild(new Error("Publisher did not pause and reap at " + stage));
      else resolveChild({ status, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function refusal(result: ChildResult, label: string, expectedState = "refused_unchanged"): Refusal {
  assert.notEqual(result.status, 0, label + " unexpectedly succeeded");
  assert.equal(result.stdout, "", label + " emitted partial success output");
  const value = JSON.parse(result.stderr.trim()) as Refusal;
  assert.deepEqual(Object.keys(value).sort(), ["message", "stage", "state"]);
  assert.equal(value.state, expectedState, label + " refusal state");
  assert(typeof value.stage === "string" && value.stage.length > 0);
  assert(typeof value.message === "string" && value.message.length > 0);
  refusalChecks++;
  return value;
}

function success(result: ChildResult, envelope: Envelope) {
  assert.equal(result.status, 0, "native publication refused: " + result.stderr);
  assert.equal(result.stderr, "", "successful native publisher wrote a diagnostic");
  const value = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(value).sort(), ["child", "state", "taskId"]);
  assert.equal(value.taskId, envelope.id);
  assert.equal(value.child, envelope.child);
  assert.equal(value.state, process.platform === "win32"
    ? "windows_visible_entry_unproven" : "unix_synced");
  successChecks++;
  return value;
}

async function treeDigest(directory: string) {
  const entries: string[] = [];
  async function walk(path: string, relative: string) {
    for (const name of (await readdir(path)).sort()) {
      const file = join(path, name);
      const key = join(relative, name);
      const kind = await lstat(file);
      if (kind.isSymbolicLink()) entries.push("link " + key + " " + await readlink(file));
      else if (kind.isDirectory()) { entries.push("dir " + key); await walk(file, key); }
      else if (kind.isFile()) {
        entries.push("file " + key + " " + createHash("sha256").update(await readFile(file)).digest("hex"));
      } else throw new Error("Unexpected synthetic fixture entry: " + key);
    }
  }
  await walk(directory, "");
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

function checkedTool(executable: string, args: string[], label: string) {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  assert(systemRoot && isAbsolute(systemRoot), "Windows system root must be absolute");
  const result = run(join(systemRoot, "System32", executable), args);
  assert.equal(result.status, 0, label + ": " + result.stderr);
  return result.stdout;
}

function currentUserSid() {
  const whoami = checkedTool("whoami.exe", ["/user", "/fo", "csv", "/nh"], "current-user SID");
  const sids = whoami.match(/S-1-\d+(?:-\d+)+/g);
  assert(sids && sids.length === 1, "cannot identify one current-user SID");
  return sids[0];
}

async function privateParent(root: string) {
  const parent = join(root, "owned-private-parent Ti\u1EBFng Vi\u1EC7t \u{1F9EA} (safe)");
  await mkdir(parent, { mode: 0o700 });
  if (process.platform === "win32") {
    const sid = currentUserSid();
    checkedTool("icacls.exe", [parent, "/grant:r", "*" + sid + ":(OI)(CI)F"],
      "grant the owned private parent only to the current user");
    checkedTool("icacls.exe", [parent, "/setowner", "*" + sid],
      "set owned fixture parent to current-user owner");
    checkedTool("icacls.exe", [parent, "/inheritance:r"], "remove inherited fixture ACEs");
    checkedTool("icacls.exe", [parent, "/verify"], "verify private parent ACL");
    aclChecks++;
  } else {
    assert.equal((await stat(parent)).mode & 0o777, 0o700);
    aclChecks++;
  }
  return parent;
}

async function privateParentWithUnsupportedAce(root: string, label: string, ace: string) {
  const parent = join(root, label);
  await mkdir(parent, { mode: 0o700 });
  const sid = currentUserSid();
  checkedTool("icacls.exe", [parent, "/grant:r", "*" + sid + ":" + ace],
    "install unsupported ACE only on owned fixture");
  checkedTool("icacls.exe", [parent, "/setowner", "*" + sid],
    "set owned unsupported ACE fixture to current-user owner");
  checkedTool("icacls.exe", [parent, "/inheritance:r"], "protect owned fixture DACL");
  checkedTool("icacls.exe", [parent, "/verify"], "verify owned unsupported ACE fixture");
  return parent;
}

async function tsReference(parent: string, label: string) {
  const state = join(parent, label);
  const result = await createOperatorTask(state, { request, payee, maxTotalMicros });
  const taskBytes = await readFile(join(state, "task.json"));
  const requestBytes = await readFile(join(state, "request.json"));
  const task = JSON.parse(taskBytes.toString("utf8"));
  assert.equal(result.taskId, task.id);
  return { state, taskBytes, requestBytes,
    envelope: { parent, child: label, request, payee, maxTotalMicros,
      id: task.id as string, createdAt: task.createdAt as string } };
}

function guardedStatus(state: string, disabled: string) {
  return run(process.execPath, ["--import", offlineGuard, "--import", tsxLoader, "--no-warnings",
    join(repo, "scripts", "operator.mts"), "status", "--state", state],
  undefined, { ...noEnv, KERYX_RUST_ENGINE: disabled });
}

async function inspectPublished(root: string, state: string, expected: Awaited<ReturnType<typeof tsReference>>) {
  assert.deepEqual(await readFile(join(state, "request.json")), expected.requestBytes);
  assert.deepEqual(await readFile(join(state, "task.json")), expected.taskBytes);
  const ts = await operatorTaskStatus(state);
  assert.equal(ts.stage, "ready");
  assert.equal(ts.savedResult, "absent");
  assert.equal(ts.payment, "unknown");
  assert.equal(ts.delivery, "unknown");
  assert.equal(ts.taskId, expected.envelope.id);
  const rust = run(reader, ["status", "--state", state]);
  assert.equal(rust.status, 0, rust.stderr);
  assert.deepEqual(JSON.parse(rust.stdout), ts);
  reopenChecks++;
  const disabled = join(root, "disabled-native" + extension);
  await assert.rejects(stat(disabled), { code: "ENOENT" });
  const before = await treeDigest(state);
  for (let restart = 0; restart < 2; restart++) {
    const fallback = guardedStatus(state, disabled);
    assert.equal(fallback.status, 0, "guarded TS restart " + restart + ": " + fallback.stderr);
    assert.match(fallback.stderr, /keryx offline fallback guard active/);
    assert.deepEqual(JSON.parse(fallback.stdout), ts);
    assert.equal(await treeDigest(state), before);
    reopenChecks++;
  }
  if (process.platform === "win32") {
    for (const path of [state, join(state, "request.json"), join(state, "task.json")]) {
      checkedTool("icacls.exe", [path, "/verify"], "verify native-created fixture ACL");
      aclChecks++;
    }
  } else {
    assert.equal((await stat(state)).mode & 0o777, 0o700);
    assert.equal((await stat(join(state, "request.json"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(state, "task.json"))).mode & 0o777, 0o600);
    aclChecks += 3;
  }
}

async function inspectCrashedPublication(root: string, parent: string,
  reference: Awaited<ReturnType<typeof tsReference>>,
  stage: "after-mkdir" | "request-close" | "task-close") {
  const child = "crash-" + stage;
  const state = join(parent, child);
  await assert.rejects(stat(state), { code: "ENOENT" });
  const result = await crashPausedPublisher({ ...reference.envelope, child }, stage);
  assert.notEqual(result.status, 0, "killed publisher reported success");
  assert.equal(result.stdout, "", "killed publisher emitted a success receipt");
  assert.equal(result.stderr.trim(), "KERYX_PUBLICATION_PAUSED:" + stage);
  assert((await stat(state)).isDirectory(), "crash must retain created task directory");
  const files = (await readdir(state)).sort();
  assert.deepEqual(files, stage === "after-mkdir" ? []
    : stage === "request-close" ? ["request.json"] : ["request.json", "task.json"]);
  if (stage !== "after-mkdir") {
    assert.deepEqual(await readFile(join(state, "request.json")), reference.requestBytes);
  }
  if (stage === "task-close") {
    assert.deepEqual(await readFile(join(state, "task.json")), reference.taskBytes);
    await inspectPublished(root, state, reference);
  } else {
    const disabled = join(root, "disabled-native" + extension);
    const before = await treeDigest(state);
    const fallback = guardedStatus(state, disabled);
    assert.notEqual(fallback.status, 0, "incomplete task reopened as valid TypeScript state");
    assert.equal(fallback.stdout, "", "incomplete TS task emitted status");
    assert.match(fallback.stderr, /keryx offline fallback guard active/);
    const rust = run(reader, ["status", "--state", state]);
    assert.notEqual(rust.status, 0, "incomplete task reopened as valid Rust state");
    assert.equal(rust.stdout, "", "incomplete Rust task emitted status");
    assert.equal(await treeDigest(state), before, "readers mutated retained partial state");
    reopenChecks += 2;
  }
  crashChecks++;
}

async function inspectFaultStates(root: string, parent: string,
  reference: Awaited<ReturnType<typeof tsReference>>) {
  const beforeChild = "fault-before-mkdir";
  const before = await treeDigest(root);
  const unchanged = refusal(publish({ ...reference.envelope, child: beforeChild },
    ["--fail-at", "before-mkdir"]), "injected before-mkdir", "refused_unchanged");
  assert.equal(unchanged.stage, "before-mkdir");
  assert.equal(await treeDigest(root), before);
  await assert.rejects(stat(join(parent, beforeChild)), { code: "ENOENT" });
  faultChecks++;

  const partialChild = "fault-request-write";
  const partial = refusal(publish({ ...reference.envelope, child: partialChild },
    ["--fail-at", "request-write"]), "injected request-write", "retained_partial");
  assert.equal(partial.stage, "request-write");
  const partialState = join(parent, partialChild);
  assert.deepEqual(await readdir(partialState), ["request.json"]);
  assert.equal((await readFile(join(partialState, "request.json"))).length, 0);
  const partialBefore = await treeDigest(partialState);
  const incompleteTs = guardedStatus(partialState, join(root, "disabled-native" + extension));
  assert.notEqual(incompleteTs.status, 0);
  assert.equal(incompleteTs.stdout, "");
  const incompleteRust = run(reader, ["status", "--state", partialState]);
  assert.notEqual(incompleteRust.status, 0);
  assert.equal(incompleteRust.stdout, "");
  assert.equal(await treeDigest(partialState), partialBefore, "rollback readers repaired partial files");
  reopenChecks += 2;
  faultChecks++;

  const completeChild = "fault-directory-sync";
  const complete = refusal(publish({ ...reference.envelope, child: completeChild },
    ["--fail-at", "directory-sync"]), "injected directory-sync", "complete_unconfirmed");
  assert.equal(complete.stage, "directory-sync");
  await inspectPublished(root, join(parent, completeChild), reference);
  faultChecks++;
}

async function refusedWithoutMutation(root: string, label: string, envelope: Envelope) {
  const before = await treeDigest(root);
  const output = refusal(publish(envelope), label);
  assert.equal(await treeDigest(root), before, label + " mutated existing files");
  return output;
}

async function main() {
  assert((await stat(publisher)).isFile(), "build the feature-gated publication example first");
  assert((await stat(reader)).isFile(), "build the Rust read-only CLI first");
  const tempParent = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(tempParent, "keryx-task-publication-")));
  assert.equal(dirname(root), tempParent);
  assert(basename(root).startsWith("keryx-task-publication-"));
  const links: string[] = [];
  try {
    const parent = await privateParent(root);
    const reference = await tsReference(parent, "typescript-reference");
    const envelope = { ...reference.envelope, child: "native-created" };
    success(publish(envelope), envelope);
    await inspectPublished(root, join(parent, envelope.child), reference);

    const existingDir = join(parent, "existing-dir");
    await mkdir(existingDir, { mode: 0o700 });
    await writeFile(join(existingDir, "sentinel"), "leave this existing directory unchanged",
      { flag: "wx" });
    const collisionDir = await refusedWithoutMutation(root, "existing directory",
      { ...envelope, child: "existing-dir" });
    assert.match(collisionDir.stage + " " + collisionDir.message, /exist|already|collision/i);
    const existingFile = join(parent, "existing-file");
    await writeFile(existingFile, "leave this existing file unchanged", { flag: "wx" });
    const collisionFile = await refusedWithoutMutation(root, "existing file",
      { ...envelope, child: "existing-file" });
    assert.match(collisionFile.stage + " " + collisionFile.message, /exist|already|collision/i);
    for (const child of ["../escape", "nested/name", ".", "", "name.with.dot",
      "CON", "con", "PrN", "AUX", "NUL", "COM1", "com9", "LPT1", "lpt9"]) {
      await refusedWithoutMutation(root, "unsafe child " + JSON.stringify(child),
        { ...envelope, child });
    }
    const relativeParent = "keryx-no-parent-" + basename(root);
    await assert.rejects(stat(join(repo, relativeParent)), { code: "ENOENT" });
    const relative = await refusedWithoutMutation(root, "relative parent",
      { ...envelope, parent: relativeParent, child: "must-not-appear" });
    assert.equal(relative.stage, "parent");
    await assert.rejects(stat(join(repo, relativeParent)), { code: "ENOENT" });
    if (process.platform === "win32") {
      const driveRelative = await refusedWithoutMutation(root, "drive-relative parent",
        { ...envelope, parent: root.slice(0, 2) + relativeParent, child: "must-not-appear" });
      assert.equal(driveRelative.stage, "parent");
      const noPropagate = await privateParentWithUnsupportedAce(root,
        "no-propagate-parent", "(OI)(CI)(NP)F");
      const noPropagateDenied = await refusedWithoutMutation(root, "no-propagate ACE",
        { ...envelope, parent: noPropagate, child: "must-not-appear" });
      assert.equal(noPropagateDenied.stage, "parent");
      await assert.rejects(stat(join(noPropagate, "must-not-appear")), { code: "ENOENT" });
      aclChecks++;
      const inheritOnly = await privateParentWithUnsupportedAce(root,
        "inherit-only-parent", "(OI)(CI)(IO)F");
      const aclBefore = checkedTool("icacls.exe", [inheritOnly], "read owned inherit-only ACL");
      try {
        const inheritOnlyDenied = refusal(publish({ ...envelope, parent: inheritOnly,
          child: "must-not-appear" }), "inherit-only ACE");
        assert.equal(inheritOnlyDenied.stage, "parent");
        assert.equal(checkedTool("icacls.exe", [inheritOnly], "read refused parent ACL"), aclBefore);
      } finally {
        checkedTool("icacls.exe", [inheritOnly, "/grant:r",
          "*" + currentUserSid() + ":(OI)(CI)F"], "restore owned fixture ACL for inspection");
      }
      assert.deepEqual(await readdir(inheritOnly), [], "inherit-only parent gained a child");
      aclChecks++;
    }
    const missingParent = join(root, "absent-parent");
    await assert.rejects(stat(missingParent), { code: "ENOENT" });
    await refusedWithoutMutation(root, "missing parent",
      { ...envelope, parent: missingParent, child: "must-not-appear" });
    await assert.rejects(stat(missingParent), { code: "ENOENT" });
    for (const [label, invalid] of [
      ["invalid raw budget", { ...envelope, child: "invalid-budget",
        request: { ...request, budget: 0.500000000000001 } }],
      ["invalid payee", { ...envelope, child: "invalid-payee", payee: "0x" + "0".repeat(40) }],
      ["invalid cap", { ...envelope, child: "invalid-cap", maxTotalMicros: "50000" }],
    ] as Array<[string, Envelope]>) {
      await refusedWithoutMutation(root, label, invalid);
      await assert.rejects(stat(join(parent, invalid.child)), { code: "ENOENT" });
    }

    const linkTarget = join(parent, "link-target");
    await mkdir(linkTarget, { mode: 0o700 });
    const targetLink = join(parent, "existing-link");
    await symlink(linkTarget, targetLink, process.platform === "win32" ? "junction" : "dir");
    links.push(targetLink);
    await refusedWithoutMutation(root, "existing linked child",
      { ...envelope, child: "existing-link" });
    linkChecks++;
    const parentLink = join(root, "linked-parent");
    await symlink(parent, parentLink, process.platform === "win32" ? "junction" : "dir");
    links.push(parentLink);
    await refusedWithoutMutation(root, "linked parent",
      { ...envelope, parent: parentLink, child: "must-not-appear" });
    await assert.rejects(stat(join(parent, "must-not-appear")), { code: "ENOENT" });
    linkChecks++;

    const first = await tsReference(parent, "race-reference-a");
    const second = await tsReference(parent, "race-reference-b");
    assert.notEqual(first.envelope.id, second.envelope.id);
    const raceChild = "concurrent-native-create";
    const [a, b] = await Promise.all([
      publishConcurrent({ ...first.envelope, child: raceChild }),
      publishConcurrent({ ...second.envelope, child: raceChild }),
    ]);
    const winners = [a, b].filter(result => result.status === 0);
    const losers = [a, b].filter(result => result.status !== 0);
    assert.equal(winners.length, 1, "exactly one native creator must win");
    assert.equal(losers.length, 1, "exactly one native creator must refuse");
    const chosen = JSON.parse(winners[0].stdout);
    const winningReference = chosen.taskId === first.envelope.id ? first : second;
    assert.equal(chosen.taskId, winningReference.envelope.id);
    success(winners[0], { ...winningReference.envelope, child: raceChild });
    const losing = refusal(losers[0], "concurrent loser");
    assert.match(losing.stage + " " + losing.message, /exist|already|collision/i);
    await inspectPublished(root, join(parent, raceChild), winningReference);
    concurrencyChecks++;
    for (const stage of ["after-mkdir", "request-close", "task-close"] as const) {
      await inspectCrashedPublication(root, parent, reference, stage);
    }
    await inspectFaultStates(root, parent, reference);
    console.log(JSON.stringify({ fixtureKind: "owned synthetic private parent; no native production writer",
      successChecks, refusalChecks, concurrencyChecks, reopenChecks, linkChecks, aclChecks,
      crashChecks, faultChecks,
      platform: process.platform, publicationObservation: process.platform === "win32"
        ? "windows_visible_entry_unproven" : "unix_synced",
      authority: "TypeScript creation and payment remain production; publication is test-only" }));
  } finally {
    for (const link of links.reverse()) {
      const kind = await lstat(link);
      assert(kind.isSymbolicLink(), "owned fixture link changed type: " + link);
      const resolved = await realpath(link);
      assert(resolved.startsWith(root + sep), "owned fixture link escaped test root: " + link);
      await unlink(link);
    }
    assert.equal(dirname(root), tempParent);
    assert(basename(root).startsWith("keryx-task-publication-"));
    await rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

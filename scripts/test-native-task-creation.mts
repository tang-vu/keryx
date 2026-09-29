/** Exact-revision, real CLI and desktop publication from an owned private fixture. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createNativeTaskWriter, repositoryNativeTaskWriter } from "../lib/operator/native-task-writer.ts";
import { operatorTaskStatus } from "../lib/operator/task.ts";
import { WorkspaceStore } from "../desktop/src/workspace.ts";
import { treeDigest } from "./rust-task-publication-fixtures.mts";

const repo = resolve(import.meta.dirname, "..");
const tsxLoader = import.meta.resolve("tsx");
const binary = join(repo, ".artifacts", "native-writer", process.platform === "win32" ? "keryx-engine.exe" : "keryx-engine");
const payee = `0x${"a".repeat(40)}`;
const request = { question: "What is Arc doing?", budget: 0.03, researchMode: "quick",
  packageVersion: "1.0.0", responseMode: "async" };
const expectedState = process.platform === "win32" ? "windows_visible_entry_unproven" : "unix_synced";
const root = await mkdtemp(join(tmpdir(), "keryx-native-creation-"));
let outcomeUncertain = false;

function cli(args: string[], cwd: string) {
  const run = spawnSync(process.execPath, ["--import", tsxLoader, join(repo, "scripts", "operator.mts"), ...args],
    { cwd, encoding: "utf8", timeout: 20_000, maxBuffer: 128_000, windowsHide: true,
      env: { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL } });
  if (run.error || run.signal || run.status === null) { outcomeUncertain = true; throw new Error("Operator exit unconfirmed"); }
  return run;
}

try {
  const workspace = join(root, "operator-workspace");
  const createdWorkspace = cli(["workspace", "--state", workspace], root);
  assert.equal(createdWorkspace.status, 0, createdWorkspace.stderr);
  assert.equal(JSON.parse(createdWorkspace.stdout).state, expectedState);
  const freshWriter = repositoryNativeTaskWriter(repo);
  const desktop = new WorkspaceStore(freshWriter);
  assert.equal((await desktop.select(workspace)).tasks.length, 0);

  const requestPath = join(root, "request.json");
  await writeFile(requestPath, JSON.stringify(request));
  const taskPath = join(workspace, "task-1");
  const created = cli(["create", "--request", requestPath, "--payee", payee,
    "--max-total", "0.10", "--state", taskPath], root);
  assert.equal(created.status, 0, created.stderr);
  const receipt = JSON.parse(created.stdout);
  assert.equal(receipt.publicationState, expectedState);
  const task = JSON.parse(await readFile(join(taskPath, "task.json"), "utf8"));
  assert.equal(task.id, receipt.taskId);
  assert.deepEqual(JSON.parse(await readFile(join(taskPath, "request.json"), "utf8")), request);
  const before = await treeDigest(workspace);
  const collision = cli(["create", "--request", requestPath, "--payee", payee,
    "--max-total", "0.10", "--state", taskPath], root);
  assert.equal(collision.status, 1);
  assert.equal(JSON.parse(collision.stderr).state, "refused_unchanged");
  assert.equal(await treeDigest(workspace), before);

  const native = spawnSync(binary, ["status", "--state", taskPath], { encoding: "utf8", timeout: 10_000,
    maxBuffer: 8192, windowsHide: true });
  if (native.error || native.signal || native.status === null) { outcomeUncertain = true; throw new Error("Native reopen exit unconfirmed"); }
  assert.equal(native.status, 0, native.stderr);
  assert.equal(JSON.parse(native.stdout).taskId, receipt.taskId);
  assert.equal((await operatorTaskStatus(taskPath)).taskId, receipt.taskId);
  const reopened = new WorkspaceStore(createNativeTaskWriter({ binaryPath: binary,
    manifestPath: join(repo, ".artifacts", "native-writer", "manifest.json"),
    expectedSourceCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim() }));
  const view = await reopened.select(workspace);
  assert.equal(view.tasks.length, 1);
  assert.equal(view.tasks[0].status.taskId, receipt.taskId);
  assert.equal((await reopened.refreshTask(view.tasks[0].handle)).status.taskId, receipt.taskId);
  assert.equal(await treeDigest(workspace), before);

  let desktopTask;
  try {
    desktopTask = await reopened.createTask({ question: "Desktop native publication", mode: "quick",
      creatorBudget: "0.03", payee, totalCap: "0.10" });
  } catch (error) { outcomeUncertain = true; throw error; }
  assert.equal(desktopTask.publicationState, expectedState);
  const afterDesktop = await treeDigest(workspace);
  const nextView = await new WorkspaceStore(repositoryNativeTaskWriter(repo)).select(workspace);
  assert.equal(nextView.tasks.length, 2);
  assert.equal(await treeDigest(workspace), afterDesktop);
  console.log(JSON.stringify({ schema: "keryx-native-task-creation-test-v1", platform: process.platform,
    workspace: 1, cliCreate: 1, collisionRefusals: 1, nativeReopens: 1, tsReopens: 1,
    desktopCreates: 1, desktopReopens: 2, publicationState: expectedState }));
} catch (error) {
  if (error && typeof error === "object" && "state" in error
    && ["unknown", "retained_partial", "complete_unconfirmed"].includes(String(error.state))) outcomeUncertain = true;
  throw error;
} finally {
  if (outcomeUncertain) console.error(`Unconfirmed creation exit; retain synthetic fixture ${root}`);
  else { assert((await lstat(root)).isDirectory()); await rm(root, { recursive: true }); }
}

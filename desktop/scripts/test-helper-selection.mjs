import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const dist = resolve(process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url)));
const node = join(dist, "runtime", "node.exe");
const helper = join(dist, "helper.cjs");
const sourceCommit = (await readFile(join(dist, "source-commit.txt"), "utf8")).trim();
if (process.platform !== "win32" || !/^[a-f0-9]{40}$/.test(sourceCommit)) {
  throw Error("This integration check needs a built Windows desktop helper");
}
const temporary = await mkdtemp(join(tmpdir(), "keryx-helper-selection-"));
const legacyWorkspace = join(temporary, "old-workspace");
const currentWorkspace = join(temporary, "new-workspace");
const legacySelectionFile = join(temporary, "old-app-data", "workspace.json");
await mkdir(legacyWorkspace);
await mkdir(currentWorkspace);
await mkdir(join(temporary, "old-app-data"));
await writeFile(legacySelectionFile, JSON.stringify({ path: legacyWorkspace }));

async function runCase(label, initialSelection, expectedPath, expectSelectionWrite) {
  const selectionDirectory = join(temporary, label);
  await mkdir(selectionDirectory);
  const selectionFile = join(selectionDirectory, "workspace.json");
  const initialBytes = initialSelection === undefined ? null : JSON.stringify({ path: initialSelection });
  if (initialSelection !== undefined) {
    await writeFile(selectionFile, initialBytes);
  }
  const permitted = new Set(["systemroot", "windir", "temp", "tmp", "userprofile", "appdata", "localappdata"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => permitted.has(name.toLowerCase())));
  env.NODE_ENV = "production";
  const child = spawn(node, [helper], { cwd: join(dist, "runtime"), env, windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"] });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
  let nextId = 0;
  async function call(action, payload) {
    const id = ++nextId;
    const answer = lines.next();
    child.stdin.write(JSON.stringify({ id, action, payload: JSON.stringify(payload) }) + "\n");
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`${label}: helper timed out`)), 10000);
    });
    let frame;
    try { frame = await Promise.race([answer, timeout]); }
    finally { clearTimeout(timer); }
    if (frame.done) throw Error(`${label}: helper exited before answering`);
    const response = JSON.parse(frame.value);
    if (response.id !== id || response.ok !== true || typeof response.result !== "string") {
      throw Error(`${label}: helper refused ${action}: ${response.error ?? "invalid frame"}`);
    }
    return JSON.parse(response.result);
  }
  try {
    await call("init", { sourceCommit,
      nativeBinary: join(dist, "native", "keryx-engine.exe"),
      nativeManifest: join(dist, "native", "manifest.json"),
      selectionFile, legacySelectionFile });
    const view = await call("refresh", {});
    const actualPath = view?.path ? (await realpath(view.path)).toLowerCase() : null;
    const expectedCanonical = expectedPath ? (await realpath(expectedPath)).toLowerCase() : null;
    if (actualPath !== expectedCanonical) {
      throw Error(`${label}: selected ${view?.path ?? "none"} instead of ${expectedPath ?? "none"}`);
    }
    const selectedBytes = await readFile(selectionFile, "utf8").catch(() => null);
    const selected = selectedBytes === null ? null : JSON.parse(selectedBytes);
    if (expectSelectionWrite && (!selected?.path ||
      (await realpath(selected.path)).toLowerCase() !== expectedCanonical)) {
      throw Error(`${label}: legacy selection was not copied into new app data`);
    }
    if (!expectSelectionWrite && selectedBytes !== initialBytes) {
      throw Error(`${label}: existing new selection bytes changed unexpectedly`);
    }
  } finally {
    child.stdin.end();
    child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", resolve);
    });
  }
}

let passed = false;
try {
  await runCase("legacy-fallback", undefined, legacyWorkspace, true);
  await runCase("new-selection-wins", currentWorkspace, currentWorkspace, false);
  await runCase("invalid-new-does-not-import-legacy", join(temporary, "moved-workspace"), null, false);
  passed = true;
  console.log(JSON.stringify({ helperSelection: "passed", cases: 3, syntheticOnly: true }));
} finally {
  const target = resolve(temporary);
  const base = resolve(tmpdir());
  if (passed && target.startsWith(base + sep) && basename(target).startsWith("keryx-helper-selection-")) {
    await rm(target, { recursive: true, force: true });
  }
}

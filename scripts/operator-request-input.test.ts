/** Actual CLI request-file admission using only owned synthetic paths. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { it } from "vitest";

const repo = resolve(import.meta.dirname, "..");
const operator = join(repo, "scripts", "operator.mts");
const payee = "0x" + "a".repeat(40);
const request = { question: "Synthetic FIFO request admission", budget: 0.05,
  researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" };
const childEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH ?? "", PATHEXT: process.env.PATHEXT ?? "",
  SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" };

type Exit = { code: number | null; signal: NodeJS.Signals | null; stdout: string;
  stderr: string; timedOut: boolean };

function createFromFile(requestPath: string, state: string,
  onUnconfirmedExit: () => void): Promise<Exit> {
  return new Promise((resolveExit, rejectExit) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--no-warnings", operator,
      "create", "--request", requestPath, "--payee", payee, "--max-total", "0.10",
      "--state", state], { cwd: repo, env: childEnv, windowsHide: true,
      shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let tooLarge = false;
    let settled = false;
    let processError: Error | null = null;
    const stop = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 10_000);
    const reap = setTimeout(() => {
      onUnconfirmedExit();
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      finish(new Error("CLI exit unconfirmed after the watchdog kill; synthetic fixture retained"));
    }, 13_000);
    function finish(error?: Error, result?: Exit) {
      if (settled) return;
      settled = true;
      clearTimeout(stop);
      clearTimeout(reap);
      if (error) rejectExit(error);
      else resolveExit(result!);
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (tooLarge) return;
      const next = stdout + chunk;
      if (Buffer.byteLength(next) > 128_000) { tooLarge = true; child.kill("SIGKILL"); }
      else stdout = next;
    });
    child.stderr.on("data", (chunk: string) => {
      if (tooLarge) return;
      const next = stderr + chunk;
      if (Buffer.byteLength(next) > 128_000) { tooLarge = true; child.kill("SIGKILL"); }
      else stderr = next;
    });
    child.once("error", error => { processError = error; child.kill("SIGKILL"); });
    child.once("close", (code, signal) => {
      if (processError) finish(processError);
      else if (tooLarge) finish(new Error("CLI emitted oversized test output"));
      else finish(undefined, { code, signal, stdout, stderr, timedOut });
    });
  });
}

async function treeDigest(directory: string): Promise<string> {
  const entries: string[] = [];
  async function walk(path: string, prefix: string) {
    for (const name of (await readdir(path)).sort()) {
      const file = join(path, name);
      const relative = join(prefix, name);
      const kind = await lstat(file);
      if (kind.isDirectory()) { entries.push("dir " + relative); await walk(file, relative); }
      else if (kind.isFile()) entries.push("file " + relative + " " +
        createHash("sha256").update(await readFile(file)).digest("hex"));
      else if (kind.isSymbolicLink()) entries.push("link " + relative + " " + await readlink(file));
      else if (kind.isFIFO()) entries.push("fifo " + relative);
      else throw new Error("Unexpected synthetic fixture entry: " + relative);
    }
  }
  await walk(directory, "");
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

it("rejects a Unix FIFO before blocking while regular and linked requests still create", async () => {
  const tempParent = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(tempParent, "keryx-operator-request-")));
  assert.equal(dirname(root), tempParent);
  assert(basename(root).startsWith("keryx-operator-request-"));
  const regular = join(root, "request.json");
  const linked = join(root, "linked-request.json");
  let linkedCreated = false;
  let preserveFixture = false;
  try {
    await writeFile(regular, JSON.stringify(request) + "\n", { flag: "wx" });
    const ordinary = await createFromFile(regular, join(root, "ordinary-task"),
      () => { preserveFixture = true; });
    assert.equal(ordinary.timedOut, false, "ordinary request hit CLI watchdog");
    assert.equal(ordinary.code, 0, ordinary.stderr);
    assert.equal(ordinary.stderr, "");
    assert.equal(JSON.parse(ordinary.stdout).status, "ready");
    assert.deepEqual(JSON.parse(await readFile(join(root, "ordinary-task", "request.json"), "utf8")), request);

    try {
      await symlink(regular, linked, "file");
      linkedCreated = true;
    } catch (error) {
      if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      console.log("Windows file-symlink control unavailable (EPERM); Linux CI exercises it");
    }
    if (linkedCreated) {
      const linkedResult = await createFromFile(linked, join(root, "linked-task"),
        () => { preserveFixture = true; });
      assert.equal(linkedResult.timedOut, false, "linked regular request hit CLI watchdog");
      assert.equal(linkedResult.code, 0, linkedResult.stderr);
      assert.equal(linkedResult.stderr, "");
      assert.equal(JSON.parse(linkedResult.stdout).status, "ready");
      assert.deepEqual(await readFile(join(root, "linked-task", "request.json")),
        await readFile(join(root, "ordinary-task", "request.json")));
    }

    if (process.platform !== "win32") {
      const fifo = join(root, "request.fifo");
      const make = spawnSync("mkfifo", [fifo], { cwd: root, env: childEnv, encoding: "utf8",
        timeout: 3_000, windowsHide: true });
      if (make.error) throw make.error;
      assert.equal(make.status, 0, make.stderr);
      assert((await lstat(fifo)).isFIFO(), "mkfifo did not create a named pipe");
      const before = await treeDigest(root);
      const state = join(root, "fifo-task");
      await assert.rejects(lstat(state), { code: "ENOENT" });
      const denied = await createFromFile(fifo, state, () => { preserveFixture = true; });
      assert.equal(denied.timedOut, false, "FIFO open waited for an absent writer");
      assert.equal(denied.code, 1, "FIFO refusal did not use the CLI catch exit");
      assert.equal(denied.signal, null, "FIFO refusal terminated by signal");
      assert.equal(denied.stdout, "", "refused FIFO emitted a create receipt");
      assert.match(denied.stderr, /Operator task refused or unavailable/);
      await assert.rejects(lstat(state), { code: "ENOENT" });
      assert.equal(await treeDigest(root), before, "FIFO refusal changed the owned fixture");
    }
  } finally {
    if (preserveFixture) {
      console.error("Owned synthetic fixture retained while CLI exit is unconfirmed: " + root);
    } else {
      if (linkedCreated) {
        assert((await lstat(linked)).isSymbolicLink());
        assert((await realpath(linked)).startsWith(root + sep));
        await unlink(linked);
      }
      assert.equal(dirname(root), tempParent);
      assert(basename(root).startsWith("keryx-operator-request-"));
      await rm(root, { recursive: true, force: true });
    }
  }
}, 50_000);

import { spawn } from "node:child_process";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const loader = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
const moduleUrl = pathToFileURL(resolve("lib/a2a/private-worker-lock.ts")).href;
const source = `
  const { withPrivateWorkerLock } = await import(${JSON.stringify(moduleUrl)});
  try {
    await withPrivateWorkerLock(process.argv[1], async () => {
      process.stdout.write("entered\\n");
      if (process.argv[2] === "hold") await new Promise(() => setInterval(() => {}, 1000));
    });
  } catch { process.stdout.write("refused\\n"); process.exitCode = 2; }
`;

function contender(directory: string, mode: "hold" | "finish") {
  const env: Record<string, string | undefined> = {};
  for (const name of ["SystemRoot", "SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP"])
    if (process.env[name]) env[name] = process.env[name];
  const child = spawn(process.execPath, ["--no-warnings", "--import", loader,
    "--input-type=module", "-e", source, directory, mode], { env: { ...env, NODE_ENV: "test" }, windowsHide: true });
  let stdout = "", stderr = "";
  let ready!: (entered: boolean) => void;
  const entered = new Promise<boolean>(resolve => { ready = resolve; });
  child.stdout.on("data", data => { stdout += String(data); if (stdout.includes("entered\n")) ready(true); });
  child.stderr.on("data", data => { stderr += String(data); });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
  child.on("error", () => { ready(false); });
  const closed = new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
    child.once("close", code => { clearTimeout(timeout); ready(false); resolve({ code, stdout, stderr }); });
  });
  return { child, entered, closed };
}

it("excludes a real second process and preserves a crash lock until verified-stop cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "keryx-lock-process-")), file = join(root, "private-worker.lock");
  const holder = contender(root, "hold");
  try {
    expect(await holder.entered).toBe(true);
    const record = await readFile(file, "utf8");
    expect(JSON.parse(record).pid).toBe(holder.child.pid);
    expect(await contender(root, "finish").closed).toEqual({ code: 2, stdout: "refused\n", stderr: "" });
    expect(await readFile(file, "utf8")).toBe(record);
    holder.child.kill("SIGKILL");
    await holder.closed; // Authoritative process completion, not elapsed lock age.
    expect(await readFile(file, "utf8")).toBe(record);
    expect(await contender(root, "finish").closed).toEqual({ code: 2, stdout: "refused\n", stderr: "" });
    // Only the uniquely owned test lock is removed, after the holder has exited.
    await unlink(file);
    expect(await contender(root, "finish").closed).toEqual({ code: 0, stdout: "entered\n", stderr: "" });
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (holder.child.exitCode === null && holder.child.signalCode === null) holder.child.kill("SIGKILL");
    await holder.closed;
    await unlink(file).catch(() => undefined); await rmdir(root);
  }
}, 25000);

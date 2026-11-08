import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
const DOWNLOADS = new Set([
  "https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip",
  "https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll",
]);
const MAX_ATTEMPTS = 3;
const TAIL_CHARACTERS = 65536;

function transientToolDownload(output) {
  const lines = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const last = lines.at(-1);
  if (!last || !/^(?:Error\s+)?failed to bundle project: `http status: (?:429|500|502|503|504)`$/.test(last)) return false;
  const download = lines.filter(line => line.startsWith("Downloading ")).at(-1)?.slice("Downloading ".length);
  // Only the two pinned, observed NSIS tool downloads qualify. Tauri itself
  // downloads and verifies them again; no mirror, cache or checksum is supplied.
  return DOWNLOADS.has(download);
}

/** @returns {Promise<{code: number, interrupted: boolean, output: string}>} */
function attempt(cliPath, cwd, signal) {
  return new Promise(resolveAttempt => {
    const taskkill = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe") : null;
    if (taskkill && !existsSync(taskkill)) throw new Error("Windows process-tree termination is unavailable");
    const child = spawn(process.execPath, [cliPath, "build", "--", "--locked"], {
      cwd, stdio: ["inherit", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true,
    });
    let output = "", spawnFailed = false, interrupted = false;
    let stopping = Promise.resolve();
    const stop = () => {
      if (interrupted) return;
      interrupted = true;
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      if (taskkill) {
        // This still-owned root and its compiler children are the only targets.
        stopping = new Promise(done => {
          const killer = spawn(taskkill, ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
          killer.on("error", error => { process.stderr.write(`Could not stop Tauri process tree: ${error.message}\n`); });
          killer.on("close", () => done());
        });
      } else {
        // A fresh owned process group contains only this attempt and its children.
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if (error.code !== "ESRCH") process.stderr.write(`Could not stop Tauri process group: ${error.message}\n`); }
      }
    };
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    const collect = chunk => { output = (output + chunk.toString()).slice(-TAIL_CHARACTERS); };
    child.stdout.on("data", collect); child.stdout.pipe(process.stdout, { end: false });
    child.stderr.on("data", collect); child.stderr.pipe(process.stderr, { end: false });
    child.on("error", error => {
      spawnFailed = true;
      if (error.name !== "AbortError") process.stderr.write(`Could not start Tauri: ${error.message}\n`);
    });
    child.on("close", async (code, childSignal) => {
      signal?.removeEventListener("abort", stop); await stopping;
      resolveAttempt({ code: Number.isInteger(code) && code >= 0 ? code : 1,
        interrupted: interrupted || spawnFailed || !!childSignal || signal?.aborted === true, output });
    });
  });
}

/**
 * Fixed build arguments and attempt ceiling; options allow real-process tests.
 * @param {{cliPath?: string, cwd?: string, backoffMs?: number, signal?: AbortSignal}} options
 */
export async function bundleTauri({ cliPath = cli, cwd = desktop, backoffMs = 5000, signal } = {}) {
  if (!Number.isSafeInteger(backoffMs) || backoffMs < 0 || backoffMs > 10000) throw new Error("Invalid Tauri retry backoff");
  for (let number = 1; number <= MAX_ATTEMPTS; number++) {
    if (signal?.aborted) return { code: 1, attempts: number - 1 };
    const result = await attempt(cliPath, cwd, signal);
    if (result.interrupted || signal?.aborted) return { code: 1, attempts: number };
    if (result.code === 0 || number === MAX_ATTEMPTS || !transientToolDownload(result.output))
      return { code: result.code, attempts: number };
    process.stderr.write(`Transient pinned Tauri tool download failure; retrying build (${number + 1}/${MAX_ATTEMPTS}).\n`);
    try { await pause(backoffMs * number, undefined, { signal }); }
    catch (error) { if (error.name === "AbortError") return { code: 1, attempts: number }; throw error; }
  }
  throw new Error("Tauri attempt bound exceeded");
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const result = await bundleTauri({ signal: controller.signal });
    process.exitCode = controller.signal.aborted ? 1 : result.code;
  }
  catch (error) { console.error(error); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}

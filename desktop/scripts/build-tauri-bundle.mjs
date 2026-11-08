import { spawn } from "node:child_process";
import { closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, ftruncateSync, lstatSync, openSync, readSync, realpathSync, writeSync } from "node:fs";
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
const MAX_PORTABLE_BYTES = 128 * 1024 * 1024;
const PORTABLE_MARKER = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK");
const NSIS_MARKER = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_NSS");

function openPortable(path, flags) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("Native portable output is not a regular file");
  const fd = openSync(path, flags | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
  try {
    const info = fstatSync(fd), current = lstatSync(path);
    if (!info.isFile() || current.isSymbolicLink() || info.dev !== current.dev || info.ino !== current.ino || info.size > MAX_PORTABLE_BYTES)
      throw new Error("Native portable output changed or exceeds the byte bound");
    return { fd, info };
  } catch (error) { closeSync(fd); throw error; }
}

function capturePortable(path) {
  const { fd, info } = openPortable(path, constants.O_RDONLY);
  try {
    const bytes = Buffer.alloc(info.size); let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!read) throw new Error("Incomplete native portable read"); offset += read;
    }
    const marker = bytes.indexOf(PORTABLE_MARKER);
    if (fstatSync(fd).size !== info.size || bytes.subarray(0, 2).toString() !== "MZ" || marker < 0 ||
        bytes.indexOf(PORTABLE_MARKER, marker + PORTABLE_MARKER.length) >= 0 || bytes.includes(NSIS_MARKER))
      throw new Error("Native portable output does not contain its unique original UNK marker");
    return { bytes, mode: info.mode & 0o777 };
  } finally { closeSync(fd); }
}

function restorePortable(path, original) {
  // Restore the exact freshly compiled bytes, never rewrite a marker or touch
  // the installed/bundled executable. Refuse missing or redirected targets.
  const { fd } = openPortable(path, constants.O_RDWR);
  try {
    let offset = 0;
    while (offset < original.bytes.length) {
      const written = writeSync(fd, original.bytes, offset, original.bytes.length - offset, offset);
      if (!written) throw new Error("Incomplete native portable restoration"); offset += written;
    }
    ftruncateSync(fd, original.bytes.length); fchmodSync(fd, original.mode); fsyncSync(fd);
    if (fstatSync(fd).size !== original.bytes.length) throw new Error("Native portable restoration size mismatch");
    const chunk = Buffer.alloc(Math.min(TAIL_CHARACTERS, original.bytes.length)); offset = 0;
    while (offset < original.bytes.length) {
      const length = Math.min(chunk.length, original.bytes.length - offset);
      const read = readSync(fd, chunk, 0, length, offset);
      if (read !== length || !chunk.subarray(0, length).equals(original.bytes.subarray(offset, offset + length)))
        throw new Error("Native portable restoration bytes mismatch");
      offset += length;
    }
  } finally { closeSync(fd); }
}

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
function attempt(cliPath, args, cwd, signal) {
  return new Promise(resolveAttempt => {
    const taskkill = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe") : null;
    if (taskkill && !existsSync(taskkill)) throw new Error("Windows process-tree termination is unavailable");
    const child = spawn(process.execPath, [cliPath, ...args], {
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
 * One locked compile, bounded bundle attempts and exact portable preservation.
 * @param {{cliPath?: string, cwd?: string, backoffMs?: number, signal?: AbortSignal}} options
 */
export async function bundleTauri({ cliPath = cli, cwd = desktop, backoffMs = 5000, signal } = {}) {
  if (!Number.isSafeInteger(backoffMs) || backoffMs < 0 || backoffMs > 10000) throw new Error("Invalid Tauri retry backoff");
  if (signal?.aborted) return { code: 1, attempts: 0 };
  const build = await attempt(cliPath, ["build", "--no-bundle", "--", "--locked"], cwd, signal);
  if (build.interrupted || signal?.aborted) return { code: 1, attempts: 0 };
  if (build.code !== 0) return { code: build.code, attempts: 0 };
  const executable = join(cwd, "src-tauri", "target", "release", "KeryxOperator.exe");
  let original;
  try { original = capturePortable(executable); }
  catch (error) { process.stderr.write(`Cannot retain native portable original: ${error.message}\n`); return { code: 1, attempts: 0 }; }
  for (let number = 1; number <= MAX_ATTEMPTS; number++) {
    if (signal?.aborted) return { code: 1, attempts: number - 1 };
    let result;
    try { result = await attempt(cliPath, ["bundle"], cwd, signal); }
    finally { restorePortable(executable, original); }
    if (result.interrupted || signal?.aborted) return { code: 1, attempts: number };
    if (result.code === 0 || number === MAX_ATTEMPTS || !transientToolDownload(result.output))
      return { code: result.code, attempts: number };
    process.stderr.write(`Transient pinned Tauri tool download failure; retrying bundle (${number + 1}/${MAX_ATTEMPTS}).\n`);
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

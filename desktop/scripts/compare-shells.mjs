import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir, cpus, release, totalmem } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const baselineOnly = process.argv[2] === "--electron-only";
if (process.platform !== "win32" || process.argv.length < 4) {
  throw Error("Usage: node desktop/scripts/compare-shells.mjs [--electron-only] <Electron-v0.2.exe> [Tauri.exe]");
}
const artifacts = [{ name: "electron", exe: resolve(process.argv[baselineOnly ? 3 : 2]) }];
if (!baselineOnly) artifacts.push({ name: "tauri", exe: resolve(process.argv[3]) });
const repository = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const resultPath = join(repository, ".artifacts", "desktop-shell-benchmark.json");
const permitted = new Set(["systemroot", "windir", "userprofile", "appdata", "localappdata",
  "temp", "tmp", "comspec", "homedrive", "homepath", "pathext"]);

async function packageBytes(directory) {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error(`Package contains a link: ${path}`);
    if (entry.isDirectory()) {
      const child = await packageBytes(path);
      bytes += child.bytes;
      files += child.files;
    } else if (entry.isFile()) {
      bytes += (await stat(path)).size;
      files++;
    }
  }
  return { bytes, files };
}

async function unusedPort() {
  const server = createServer();
  await new Promise((yes, no) => server.listen(0, "127.0.0.1", yes).once("error", no));
  const port = server.address().port;
  await new Promise(yes => server.close(yes));
  return port;
}

async function processTreeMemory(rootPid) {
  const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { maxBuffer: 4 * 1024 * 1024, timeout: 15000 });
  const parsed = JSON.parse(stdout);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const selected = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (selected.has(Number(row.ParentProcessId)) && !selected.has(Number(row.ProcessId))) {
        selected.add(Number(row.ProcessId));
        changed = true;
      }
    }
  }
  const members = rows.filter(row => selected.has(Number(row.ProcessId)));
  if (!members.some(row => Number(row.ProcessId) === rootPid)) throw Error("Benchmark app exited before memory sample");
  return { processes: members.length,
    rssBytes: members.reduce((sum, row) => sum + Number(row.WorkingSetSize), 0),
    privateBytes: members.reduce((sum, row) => sum + Number(row.PrivatePageCount), 0) };
}

async function connect(port, kind, child) {
  const deadline = Date.now() + 30000;
  let browser;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw Error(`${kind} exited before UI readiness (${child.exitCode})`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1500 }); break; }
    catch { await delay(250); }
  }
  if (!browser) throw Error(`${kind} did not expose its benchmark CDP endpoint`);
  let page;
  while (Date.now() < deadline && !page) {
    page = browser.contexts().flatMap(context => context.pages()).find(candidate =>
      kind === "tauri" ? candidate.url().startsWith("http://tauri.localhost") :
        candidate.url().startsWith("keryx-app://desktop"));
    if (!page) await delay(100);
  }
  if (!page) { await browser.close(); throw Error(`${kind} did not load its local page`); }
  return { browser, page };
}

async function stop(child, browser) {
  await browser?.close().catch(() => undefined);
  if (Number.isInteger(child.pid) && child.pid > 0 && child.exitCode === null && child.signalCode === null) {
    await execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { timeout: 15000 }).catch(() => undefined);
  }
  await Promise.race([new Promise(yes => { if (child.exitCode !== null || child.signalCode !== null) yes(); else child.once("exit", yes); }), delay(10000)]);
  if (child.exitCode === null && child.signalCode === null) throw Error("Benchmark app process did not exit");
}

async function removeAfterWebViewExit(path) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await rm(path, { recursive: true, force: true }); return; }
    catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error?.code) || attempt === 39) throw error;
      await delay(250);
    }
  }
}

async function sample(artifact, index) {
  const temporary = await mkdtemp(join(tmpdir(), "keryx-tauri-smoke-benchmark-"));
  const port = await unusedPort();
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => permitted.has(name.toLowerCase())));
  let child;
  let browser;
  let success = false;
  try {
    let args = [];
    if (artifact.name === "electron") {
      env.KERYX_DESKTOP_TEST_USER_DATA = join(temporary, "electron-data");
      await mkdir(env.KERYX_DESKTOP_TEST_USER_DATA);
      args = [`--remote-debugging-port=${port}`];
    } else {
      const config = join(temporary, "smoke.json");
      await writeFile(config, JSON.stringify({ root: temporary }));
      env.KERYX_DESKTOP_SMOKE_CONFIG = config;
      env.WEBVIEW2_USER_DATA_FOLDER = join(temporary, "webview-data");
      env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port} --remote-allow-origins=*`;
    }
    const started = performance.now();
    child = spawn(artifact.exe, args, { env, windowsHide: true, stdio: "ignore" });
    const connected = await connect(port, artifact.name, child);
    browser = connected.browser;
    await connected.page.getByRole("heading", { name: "Your work, in one place." }).waitFor({ timeout: 30000 });
    await connected.page.locator(".loading-state").waitFor({ state: "hidden", timeout: 30000 });
    if (await connected.page.getByRole("alert").count()) throw Error(`${artifact.name} reported a startup error`);
    const readyMs = Math.round(performance.now() - started);
    const memory = [];
    for (const waitMs of [3000, 2000, 2000]) {
      await delay(waitMs);
      memory.push(await processTreeMemory(child.pid));
    }
    success = true;
    return { run: index, uiReadyMs: readyMs, idleMemory: memory };
  } finally {
    if (child) await stop(child, browser).catch(() => undefined);
    const normalized = resolve(temporary);
    const tempRoot = resolve(tmpdir());
    if (success && normalized.startsWith(tempRoot + sep) && basename(normalized).startsWith("keryx-tauri-smoke-benchmark-")) {
      await removeAfterWebViewExit(normalized);
    }
  }
}

for (const artifact of artifacts) {
  if (!(await stat(artifact.exe)).isFile()) throw Error(`${artifact.name} executable is missing`);
  artifact.package = await packageBytes(dirname(artifact.exe));
}
const measurements = [];
for (let run = 1; run <= 3; run++) {
  for (const artifact of artifacts) measurements.push({ name: artifact.name, ...await sample(artifact, run) });
}
const result = { schema: "keryx-desktop-shell-benchmark-v1", platform: process.platform,
  osRelease: release(), cpu: cpus()[0]?.model ?? "unknown", logicalCpus: cpus().length,
  totalMemoryBytes: totalmem(), measuredAt: new Date().toISOString(),
  packages: artifacts.map(({ name, exe, package: size }) => ({ name, exe, ...size })), measurements };
await mkdir(dirname(resultPath), { recursive: true });
await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ resultPath, packages: result.packages, measurements: measurements.length }));

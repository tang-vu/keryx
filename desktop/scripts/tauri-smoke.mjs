import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdtemp, mkdir, readFile, realpath, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { createBuyerJournal, readBuyerJournal } from "../../lib/buyer/journal.ts";
import { resumeResearch } from "../../lib/buyer/resume.ts";
import { authorizationWithNonce, BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC } from "../../lib/buyer/protocol.ts";
import { buyerJobId } from "../../lib/buyer/policy.ts";
import { a2aResearchPackage } from "../../lib/a2a/research-package-definition.ts";
import { RESEARCH_RECEIPT_CANONICALIZATION, RESEARCH_RECEIPT_SCHEMA } from "../../lib/research-receipt-types.ts";
import { researchReceiptDigest, sha256 } from "../../lib/research-receipt-integrity.ts";
import { resumeOperatorTask } from "../../lib/operator/task.ts";

if (process.platform !== "win32" || !process.argv[2]) throw Error("Pass one packaged Windows Tauri executable");
const exe = resolve(process.argv[2]);
const screenshotOverride = process.env.KERYX_DESKTOP_SMOKE_SCREENSHOT;
if (screenshotOverride && !isAbsolute(screenshotOverride)) throw Error("Smoke screenshot destination must be absolute");
const temporary = await mkdtemp(join(tmpdir(), "keryx-tauri-smoke-"));
const screenshotPath = screenshotOverride ?? join(temporary, "packaged-tauri.png");
const parent = join(temporary, "parent");
const reference = join(temporary, "reference.md");
const statusPath = join(temporary, "status.json");
const briefPath = join(temporary, "brief.md");
const configPath = join(temporary, "smoke.json");
await mkdir(parent);
await writeFile(reference, "# Local acceptance reference\nNo upload or payment.\n");

function fixture(answer, intent) {
  const job = { queryId: intent.queryId, status: "completed", answer,
    researchPackage: a2aResearchPackage(intent.request.researchMode),
    pricing: { totalPriceUsdc: 0.05, serviceFeeUsdc: 0.04, creatorBudgetUsdc: 0.01,
      settledCreatorSpendUsdc: 0.005, pendingCreatorSpendUsdc: 0, unusedCreatorReserveUsdc: 0.005 } };
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA,
    dispatch: { id: intent.queryId, question: intent.request.question, answer,
      answerSha256: sha256(answer), budgetUsdc: intent.request.budget, researchMode: intent.request.researchMode },
    citations: [{ marker: "[1]", sourceId: "synthetic", sourceName: "Synthetic acceptance source",
      itemId: "article", itemTitle: "Synthetic article", itemUrl: "https://example.org/article", contentVersion: "v1", weight: 1, rewardPlannedUsdc: 0.005, rationale: "read" }],
    claims: [{ claimIndex: 0, claim: "Synthetic claim", evidence: [{ marker: "[1]", sourceId: "synthetic", sourceName: "Synthetic acceptance source", itemId: "article", contentVersion: "v1", quote: "Synthetic bounded evidence", support: 0.8, qualifiesForAnswer: true, qualifiesForReward: true }] }],
    settlement: { mode: "real", ledgerCompleteness: "complete", settledCreatorUsdc: 0.005,
      pendingCreatorUsdc: 0, simulatedCreatorUsdc: 0 } };
  const digest = researchReceiptDigest(payload);
  return { job, receipt: { payload, integrity: { algorithm: "sha256", canonicalization: RESEARCH_RECEIPT_CANONICALIZATION,
    scope: "payload", digest } }, digest };
}

async function createSyntheticSavedResult(taskDirectory) {
  const task = JSON.parse(await readFile(join(taskDirectory, "task.json"), "utf8"));
  const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC,
    amount: "50000", payTo: task.payee, maxTimeoutSeconds: 604860,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
  const authorization = authorizationWithNonce("0x1111111111111111111111111111111111111111", requirement,
    `0x${"a".repeat(64)}`);
  const buyerDirectory = join(taskDirectory, "buyer");
  await createBuyerJournal(buyerDirectory, { schema: "keryx-buyer-intent-v1", request: task.request,
    requirement, authorization, queryId: buyerJobId(authorization) });
  const intent = await readBuyerJournal(buyerDirectory);
  const completed = fixture("Synthetic acceptance answer [1]", intent);
  const recover = async (buyer) => resumeResearch(buyer, async (url, init) => {
    if (init?.method && init.method !== "GET") throw Error("Non-GET acceptance request");
    if (url === `https://keryx.cc/api/agent/ask?queryId=${intent.queryId}`) return Response.json(completed.job);
    if (url === `https://keryx.cc/api/dispatch/${intent.queryId}/receipt`) return Response.json(completed.receipt,
      { headers: { "x-keryx-receipt-digest": completed.digest } });
    throw Error("Unexpected acceptance URL");
  });
  const result = await resumeOperatorTask(taskDirectory, recover);
  if (result.localResult.state !== "saved") throw Error("Synthetic result was not saved");
}

async function unusedPort() {
  const server = createServer();
  await new Promise((yes, no) => server.listen(0, "127.0.0.1", yes).once("error", no));
  const port = server.address().port;
  await new Promise(yes => server.close(yes));
  return port;
}

async function launchDiagnostic(child, profile, port, lastConnectionError) {
  let processes = [];
  let mainWindowHandle = null;
  let diagnosticError = null;
  let browserLaunchFlags = [];
  let browserLaunchFlagsError = null;
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | Select-Object Name,ProcessId,ParentProcessId,SessionId | ConvertTo-Json -Compress"],
    { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(output);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const selected = new Set([child.pid]);
    let added = true;
    while (added) {
      added = false;
      for (const row of rows) {
        if (selected.has(row.ParentProcessId) && !selected.has(row.ProcessId)) {
          selected.add(row.ProcessId);
          added = true;
        }
      }
    }
    processes = rows.filter(row => selected.has(row.ProcessId));
    const windowOutput = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `(Get-Process -Id ${Number(child.pid)} -ErrorAction Stop).MainWindowHandle`],
    { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 1024 });
    mainWindowHandle = Number(windowOutput.trim());
  } catch (error) { diagnosticError = String(error).slice(0, 300); }
  const browserPids = processes.filter(row => row.Name?.toLowerCase() === "msedgewebview2.exe")
    .map(row => Number(row.ProcessId)).filter(pid => Number.isSafeInteger(pid) && pid > 0);
  if (browserPids.length) {
    try {
      const script = String.raw`
        $pids = $env:KERYX_DIAG_BROWSER_PIDS.Split(',')
        $expectedPort = $env:KERYX_DIAG_DEBUG_PORT
        $expectedProfile = [IO.Path]::GetFullPath($env:KERYX_DIAG_PROFILE)
        $expectedEbWebView = [IO.Path]::GetFullPath([IO.Path]::Combine($expectedProfile, 'EBWebView'))
        $flags = foreach ($browserPid in $pids) {
          $process = Get-CimInstance Win32_Process -Filter "ProcessId = $browserPid" -ErrorAction Stop
          if (-not $process -or [string]::IsNullOrWhiteSpace($process.CommandLine)) { continue }
          $line = [string]$process.CommandLine
          if ($line -match '(?<!\S)--type=') { continue }
          $portFlag = [regex]::Match($line, '(?<!\S)--remote-debugging-port=(\d+)(?=\s|$)')
          $profileFlag = [regex]::Match($line, '(?<!\S)--user-data-dir=(?:"([^"]+)"|(\S+))')
          $profileMatches = $false
          $profileIsEbWebViewChild = $false
          if ($profileFlag.Success) {
            $profileValue = if ($profileFlag.Groups[1].Success) { $profileFlag.Groups[1].Value } else { $profileFlag.Groups[2].Value }
            try {
              $actualProfile = [IO.Path]::GetFullPath($profileValue)
              $profileIsEbWebViewChild = [string]::Equals($actualProfile, $expectedEbWebView, [StringComparison]::OrdinalIgnoreCase)
              $profileMatches = $profileIsEbWebViewChild -or
                [string]::Equals($actualProfile, $expectedProfile, [StringComparison]::OrdinalIgnoreCase)
            }
            catch { $profileMatches = $false }
          }
          [pscustomobject]@{
            pid = [int]$browserPid
            remoteDebuggingPortFlagPresent = $portFlag.Success
            remoteDebuggingPortMatches = $portFlag.Success -and $portFlag.Groups[1].Value -eq $expectedPort
            userDataFolderFlagPresent = $profileFlag.Success
            userDataFolderMatches = $profileMatches
            userDataFolderIsEbWebViewChild = $profileIsEbWebViewChild
          }
        }
        $flags | ConvertTo-Json -Compress`;
      const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 4096,
        env: { ...process.env, KERYX_DIAG_BROWSER_PIDS: browserPids.join(","),
          KERYX_DIAG_DEBUG_PORT: String(port), KERYX_DIAG_PROFILE: profile },
      });
      if (output.trim()) {
        const parsed = JSON.parse(output);
        browserLaunchFlags = Array.isArray(parsed) ? parsed : [parsed];
      }
    } catch (error) { browserLaunchFlagsError = String(error).slice(0, 300); }
  }
  const profileEntries = await readdir(profile).catch(() => []);
  return { childPid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode,
    lastConnectionError: lastConnectionError?.message?.slice(0, 500) ?? null, mainWindowHandle,
    processes, profileEntries, diagnosticError, browserLaunchFlags, browserLaunchFlagsError };
}

async function launch(config, executable = exe) {
  await writeFile(configPath, JSON.stringify({ root: temporary, ...config }));
  const port = await unusedPort();
  const allowed = new Set(["systemroot", "windir", "userprofile", "appdata", "localappdata",
    "temp", "tmp", "comspec", "homedrive", "homepath", "pathext"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name.toLowerCase())));
  env.KERYX_DESKTOP_SMOKE_CONFIG = configPath;
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port} --remote-allow-origins=*`;
  const profile = join(temporary, "webview-data");
  env.WEBVIEW2_USER_DATA_FOLDER = profile;
  const child = spawn(executable, [], { env, windowsHide: true, stdio: "ignore" });
  let spawnError;
  child.once("error", error => { spawnError = error; });
  let browser;
  let lastConnectionError;
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw Error(`Packaged app exited early (${child.exitCode ?? child.signalCode})`);
      }
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1500 }); break; }
      catch (error) { lastConnectionError = error; await delay(250); }
    }
    if (!browser) {
      const diagnostic = await launchDiagnostic(child, profile, port, lastConnectionError);
      throw Error(`Packaged WebView2 did not expose its test CDP endpoint: ${JSON.stringify(diagnostic)}`);
    }
    let page;
    while (Date.now() < deadline && !page) {
      page = browser.contexts().flatMap(context => context.pages())
        .find(candidate => candidate.url().startsWith("http://tauri.localhost"));
      if (!page) await delay(100);
    }
    if (!page) throw Error("Packaged Keryx WebView2 page did not load");
    await page.waitForFunction(() => !!window.keryxDesktop, { timeout: 15000 });
    await page.locator(".app-shell").waitFor({ state: "visible", timeout: 15000 });
    await page.locator(".loading-state").waitFor({ state: "hidden", timeout: 15000 });
    return { child, browser, page };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    child.kill();
    throw error;
  }
}

async function stop(app) {
  await app.browser.close().catch(() => undefined);
  app.child.kill();
  await Promise.race([new Promise(yes => {
    if (app.child.exitCode !== null || app.child.signalCode !== null) yes();
    else app.child.once("exit", yes);
  }), delay(10000)]);
  if (app.child.exitCode === null && app.child.signalCode === null) throw Error("Packaged app did not exit");
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

let active;
let passed = false;
try {
  active = await launch({ createWorkspaceParent: parent, importReference: reference,
    exportTask: statusPath, exportBrief: briefPath });
  const { page } = active;
  await page.getByRole("heading", { name: "Your work, in one place." }).waitFor();
  const localAssets = await page.evaluate(async () => {
    await document.fonts.ready;
    const font = [...document.fonts].some(face => face.family === "Spectral" && face.status === "loaded");
    const resources = performance.getEntriesByType("resource").map(entry => entry.name)
      .filter(name => /\.(?:css|js|png|woff2)(?:[?#]|$)/i.test(name));
    return { font, resources, origin: location.origin, bridge: typeof window.keryxDesktop?.refresh === "function" };
  });
  if (!localAssets.font || !localAssets.bridge || !localAssets.resources.some(name => name.includes("spectral-latin"))
    || localAssets.resources.some(name => new URL(name).origin !== localAssets.origin)) {
    throw Error("Packaged WebView2 did not load its local bridge, font, and assets exclusively from the app origin");
  }
  if (await page.evaluate(() => window.keryxDesktop.refresh()) !== null) throw Error("Fresh app selected an unexpected workspace");
  await page.getByRole("button", { name: /Create workspace/ }).click();
  await page.getByRole("heading", { name: "Prepare paid research" }).waitFor();
  await page.locator(".activity").waitFor({ state: "hidden" });
  const view = await page.evaluate(() => window.keryxDesktop.refresh());
  const canonicalParent = (await realpath(parent)).toLowerCase();
  const canonicalWorkspace = view?.path ? (await realpath(view.path)).toLowerCase() : "";
  if (!canonicalWorkspace.startsWith(canonicalParent + sep)) {
    throw Error("Workspace was created outside synthetic parent");
  }
  await page.getByRole("textbox", { name: "Research question" }).fill("Synthetic Tauri IPC question");
  await page.getByPlaceholder("0x... independently verified").fill("0x1111111111111111111111111111111111111111");
  await page.getByRole("button", { name: /Save task/ }).click();
  await page.getByText("Synthetic Tauri IPC question", { exact: true }).last().waitFor();
  await page.locator(".activity").waitFor({ state: "hidden" });
  const created = (await page.evaluate(() => window.keryxDesktop.refresh())).tasks[0];
  if (created.question !== "Synthetic Tauri IPC question") throw Error("Task create IPC returned wrong task");
  const taskDirectory = join(view.path, created.directoryName);
  const persisted = JSON.parse(await readFile(join(taskDirectory, "task.json"), "utf8"));
  if (persisted.request.question !== created.question) throw Error("Native-created task bytes differ from UI");
  if (persisted.network !== "eip155:5042" || BUYER_NETWORK !== persisted.network) {
    throw Error("Fresh packaged mainnet task and synthetic buyer fixture must use the same profile");
  }
  const referenceRow = await page.evaluate(() => window.keryxDesktop.importReference());
  if (referenceRow.name !== basename(reference)) throw Error("Reference import did not return the synthetic file");
  const denied = await page.evaluate(async () => {
    try { await window.keryxDesktop.createTask({ question: "Invalid", mode: "quick", creatorBudget: "0.01",
      totalCap: "0.10", payee: "../../private" }); return false; } catch { return true; }
  });
  if (!denied) throw Error("Invalid task payload was accepted");
  await createSyntheticSavedResult(taskDirectory);
  const refreshed = await page.evaluate(() => window.keryxDesktop.refresh());
  if (refreshed.tasks.length !== 1 || refreshed.references.length !== 1) throw Error("Workspace refresh lost synthetic items");
  const saved = await page.evaluate(handle => window.keryxDesktop.readResult(handle), created.handle);
  if (saved?.answer !== "Synthetic acceptance answer [1]") throw Error("Offline saved result did not reopen through helper");
  if (!await page.evaluate(handle => window.keryxDesktop.exportTask(handle), created.handle)) throw Error("Status export canceled");
  if (JSON.parse(await readFile(statusPath, "utf8")).payment !== "unknown") throw Error("Status export changed payment authority");
  if (!await page.evaluate(handle => window.keryxDesktop.exportBrief(handle), created.handle)) throw Error("Brief export canceled");
  if (!(await readFile(briefPath, "utf8")).includes("Synthetic acceptance answer")) throw Error("Brief export lost saved answer");
  const overwriteRejected = await page.evaluate(async handle => {
    try { await window.keryxDesktop.exportTask(handle); return false; } catch { return true; }
  }, created.handle);
  if (!overwriteRejected) throw Error("Status export overwrote an existing destination");
  for (const [format, expected] of [["bibtex", "@misc"], ["ris", "TY  - WEB"], ["csl-json", '"type": "webpage"'], ["evidence-csv", "Synthetic bounded evidence"]]) {
    await unlink(briefPath);
    if (!await page.evaluate(({ handle, format }) => window.keryxDesktop.exportBrief(handle, format), { handle: created.handle, format })) throw Error(`${format} export canceled`);
    if (!(await readFile(briefPath, "utf8")).includes(expected)) throw Error(`${format} lost checked receipt content`);
    const refused = await page.evaluate(async ({ handle, format }) => {
      try { await window.keryxDesktop.exportBrief(handle, format); return false; } catch { return true; }
    }, { handle: created.handle, format });
    if (!refused) throw Error(`${format} overwrote existing export`);
  }
  const invalidFormatRefused = await page.evaluate(async handle => {
    try { await window.keryxDesktop.exportBrief(handle, "invalid"); return false; } catch { return true; }
  }, created.handle);
  if (!invalidFormatRefused) throw Error("Unknown export format accepted");
  const genericDenied = await page.evaluate(async () => {
    try { await window.__TAURI_INTERNALS__.invoke("plugin:shell|execute", { command: "cmd" }); return false; }
    catch { return true; }
  });
  if (!genericDenied) throw Error("Renderer gained a generic shell command");
  if (await page.evaluate(() => typeof window.require !== "undefined" || typeof window.process !== "undefined")) {
    throw Error("Renderer gained Node access");
  }
  await stop(active); active = null;
  active = await launch({ openWorkspace: view.path });
  const restored = await active.page.evaluate(() => window.keryxDesktop.refresh());
  if (restored.tasks.length !== 1 || restored.tasks[0].question !== created.question) throw Error("Workspace did not reopen after app restart");
  for (const format of ["brief", "bibtex", "ris", "csl-json", "evidence-csv"]) {
    if (await active.page.evaluate(({ handle, format }) => window.keryxDesktop.exportBrief(handle, format), { handle: created.handle, format })) throw Error(`${format} cancellation wrote an export`);
  }
  await active.page.screenshot({ path: screenshotPath });
  await stop(active); active = null;
  const tamperedPackage = join(temporary, "tampered-package");
  await cp(dirname(exe), tamperedPackage, { recursive: true });
  const helperPath = join(tamperedPackage, "dist", "helper.cjs");
  const helperBytes = await readFile(helperPath);
  helperBytes[0] ^= 1;
  await writeFile(helperPath, helperBytes);
  active = await launch({}, join(tamperedPackage, basename(exe)));
  await active.page.getByRole("alert").getByText(/Packaged helper resource has changed/).waitFor();
  const unavailable = await active.page.evaluate(async () => {
    try { await window.keryxDesktop.refresh(); return false; } catch { return true; }
  });
  if (!unavailable) throw Error("Tampered packaged helper was allowed to serve desktop commands");
  await stop(active); active = null;
  await cp(join(dirname(exe), "dist", "helper.cjs"), helperPath);
  const nativePath = join(tamperedPackage, "dist", "native", "keryx-engine.exe");
  const nativeBytes = await readFile(nativePath);
  nativeBytes[0] ^= 1;
  await writeFile(nativePath, nativeBytes);
  const beforeTree = (await readdir(view.path)).sort();
  const beforeTask = await readFile(join(taskDirectory, "task.json"));
  for (const fault of ["tampered", "missing"]) {
    if (fault === "missing") await rm(nativePath);
    active = await launch({}, join(tamperedPackage, basename(exe)));
    const offlineView = await active.page.evaluate(() => window.keryxDesktop.refresh());
    if (offlineView?.path !== view.path || offlineView.tasks.length !== 1) {
      throw Error(`${fault} native writer lost the existing workspace`);
    }
    const offlineAnswer = await active.page.evaluate(handle => window.keryxDesktop.readResult(handle),
      offlineView.tasks[0].handle);
    if (offlineAnswer?.answer !== "Synthetic acceptance answer [1]") {
      throw Error(`${fault} native writer blocked an existing offline result`);
    }
    const refusal = await active.page.evaluate(async () => {
      try {
        await window.keryxDesktop.createTask({ question: "Must be refused before creation", mode: "quick",
          creatorBudget: "0.01", totalCap: "0.10", payee: "0x1111111111111111111111111111111111111111" });
        return null;
      } catch (error) { return String(error); }
    });
    if (!/trusted task writer is missing or its files changed/i.test(refusal ?? "")) {
      throw Error(`${fault} native writer was not refused with the trusted artifact error: ${refusal}`);
    }
    if (JSON.stringify((await readdir(view.path)).sort()) !== JSON.stringify(beforeTree)
      || !beforeTask.equals(await readFile(join(taskDirectory, "task.json")))) {
      throw Error(`${fault} native writer changed the existing workspace`);
    }
    await stop(active); active = null;
  }
  passed = true;
  console.log(JSON.stringify({ packagedTauriSmoke: "passed", taskCreation: "persisted_and_reopened",
    offlineReopen: true, tamperedHelperRefused: true, nativeArtifactRefusals: ["tampered", "missing"],
    exports: ["status", "brief"], ...(screenshotOverride ? { screenshot: screenshotPath } : {}) }));
} finally {
  if (active) await stop(active).catch(() => undefined);
  const normalized = resolve(temporary);
  const tempRoot = resolve(tmpdir());
  if (passed && normalized.startsWith(tempRoot + sep) && basename(normalized).startsWith("keryx-tauri-smoke-")) {
    await removeAfterWebViewExit(normalized);
  }
}

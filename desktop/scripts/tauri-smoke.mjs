import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdtemp, mkdir, readFile, realpath, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { createBuyerJournal, readBuyerJournal } from "../../lib/buyer/journal.ts";
import { resumeResearch } from "../../lib/buyer/client.ts";
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
    citations: [{ marker: "[1]", sourceName: "Synthetic acceptance source" }],
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

async function launch(config, executable = exe) {
  await writeFile(configPath, JSON.stringify({ root: temporary, ...config }));
  const port = await unusedPort();
  const allowed = new Set(["systemroot", "windir", "userprofile", "appdata", "localappdata",
    "temp", "tmp", "comspec", "homedrive", "homepath", "pathext"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name.toLowerCase())));
  env.KERYX_DESKTOP_SMOKE_CONFIG = configPath;
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port} --remote-allow-origins=*`;
  env.WEBVIEW2_USER_DATA_FOLDER = join(temporary, "webview-data");
  const child = spawn(executable, [], { env, windowsHide: true, stdio: "ignore" });
  let browser;
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw Error(`Packaged app exited early (${child.exitCode})`);
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1500 }); break; }
      catch { await delay(250); }
    }
    if (!browser) throw Error("Packaged WebView2 did not expose its test CDP endpoint");
    let page;
    while (Date.now() < deadline && !page) {
      page = browser.contexts().flatMap(context => context.pages())
        .find(candidate => candidate.url().startsWith("http://tauri.localhost"));
      if (!page) await delay(100);
    }
    if (!page) throw Error("Packaged Keryx WebView2 page did not load");
    await page.waitForFunction(() => !!window.keryxDesktop, { timeout: 15000 });
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
  const created = (await page.evaluate(() => window.keryxDesktop.refresh())).tasks[0];
  if (created.question !== "Synthetic Tauri IPC question") throw Error("Task create IPC returned wrong task");
  const taskDirectory = join(view.path, created.directoryName);
  const persisted = JSON.parse(await readFile(join(taskDirectory, "task.json"), "utf8"));
  if (persisted.request.question !== created.question) throw Error("Native-created task bytes differ from UI");
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
    await rm(normalized, { recursive: true, force: true });
  }
}

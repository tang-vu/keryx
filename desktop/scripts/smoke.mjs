import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { createBuyerJournal, readBuyerJournal } from "../../lib/buyer/journal.ts";
import { resumeResearch } from "../../lib/buyer/client.ts";
import { authorizationWithNonce, BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC } from "../../lib/buyer/protocol.ts";
import { buyerJobId } from "../../lib/buyer/policy.ts";
import { a2aResearchPackage } from "../../lib/a2a/research-package-definition.ts";
import { RESEARCH_RECEIPT_CANONICALIZATION, RESEARCH_RECEIPT_SCHEMA } from "../../lib/research-receipt-types.ts";
import { researchReceiptDigest, sha256 } from "../../lib/research-receipt-integrity.ts";
import { resumeOperatorTask } from "../../lib/operator/task.ts";

const execFile = promisify(execFileCallback);

const desktop = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packaged = process.argv[2] && process.argv[2] !== "--dev";
const exe = packaged ? resolve(process.argv[2]) : join(desktop, "node_modules/electron/dist/electron.exe");
const args = packaged ? [] : [desktop];
const screenshotPath = process.argv[3] || null;
const temp = await mkdtemp(join(tmpdir(), "keryx-desktop-smoke-"));
const parent = join(temp, "parent");
const userData = join(temp, "user-data");
const source = join(temp, "reference.md");
await mkdir(parent); await mkdir(userData);
await writeFile(join(userData, "workspace.json"), Buffer.alloc(4097, 65));
await writeFile(source, "# Local source\nA bounded immutable reference.\n");
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ["systemroot", "windir", "userprofile", "appdata", "localappdata", "temp", "tmp", "comspec", "homedrive", "homepath", "pathext"]
    .includes(key.toLowerCase())));
environment.Path = [join(process.env.SystemRoot ?? "C:\\Windows", "System32"), process.env.SystemRoot ?? "C:\\Windows",
  join(process.env.SystemRoot ?? "C:\\Windows", "System32", "Wbem")].join(";");
environment.KERYX_DESKTOP_TEST_USER_DATA = userData;
environment.KERYX_DESKTOP_SMOKE_HIDDEN = "1";
let application;
let passed = false;
function completedFixture(intent, answer) {
  const job = { queryId: intent.queryId, status: "completed", answer,
    researchPackage: a2aResearchPackage(intent.request.researchMode),
    pricing: { totalPriceUsdc: 0.05, serviceFeeUsdc: 0.04, creatorBudgetUsdc: 0.01,
      settledCreatorSpendUsdc: 0.005, pendingCreatorSpendUsdc: 0, unusedCreatorReserveUsdc: 0.005 } };
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA,
    dispatch: { id: intent.queryId, question: intent.request.question, answer,
      answerSha256: sha256(answer), budgetUsdc: intent.request.budget, researchMode: intent.request.researchMode },
    citations: [{ marker: "[1]", sourceName: "Acceptance test source" }],
    settlement: { mode: "real", ledgerCompleteness: "complete", settledCreatorUsdc: 0.005,
      pendingCreatorUsdc: 0, simulatedCreatorUsdc: 0 } };
  const digest = researchReceiptDigest(payload);
  return { job, receipt: { payload, integrity: { algorithm: "sha256", canonicalization: RESEARCH_RECEIPT_CANONICALIZATION,
    scope: "payload", digest } }, digest };
}

async function makeTestJournal(taskDirectory) {
  const task = JSON.parse(await readFile(join(taskDirectory, "task.json"), "utf8"));
  const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC,
    amount: "50000", payTo: task.payee, maxTimeoutSeconds: 604860,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
  const authorization = authorizationWithNonce("0x1111111111111111111111111111111111111111", requirement, `0x${"a".repeat(64)}`);
  const buyerDirectory = join(taskDirectory, "buyer");
  await createBuyerJournal(buyerDirectory, { schema: "keryx-buyer-intent-v1", request: task.request,
    requirement, authorization, queryId: buyerJobId(authorization) });
  return readBuyerJournal(buyerDirectory);
}

function fixtureHttp(fixture, queryId) {
  return async (url, init) => {
    if (init?.method && init.method !== "GET") throw new Error("Unexpected non-GET fixture request");
    if (url === `https://keryx.cc/api/agent/ask?queryId=${queryId}`) return Response.json(fixture.job);
    if (url === `https://keryx.cc/api/dispatch/${queryId}/receipt`) return Response.json(fixture.receipt,
      { headers: { "x-keryx-receipt-digest": fixture.digest } });
    throw new Error("Unexpected fixture URL");
  };
}
try {
  application = await electron.launch({ executablePath: exe, args, cwd: desktop, env: environment, timeout: 30000 });
  console.log("launched");
  let page = await application.firstWindow();
  console.log("first window", page.url());
  await page.waitForSelector("text=Your work, in one place.");
  await application.evaluate(({ dialog }, parentPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parentPath] }); }, parent);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByText("Prepare paid research").waitFor();
  await page.getByText("Workspace created and visible. Keep a backup of important local work.").waitFor();
  await page.getByPlaceholder("What would you like to investigate?").fill("Acceptance test: Arc research question one");
  await page.getByPlaceholder("0x... independently verified").fill("0x1111111111111111111111111111111111111111");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.getByText("1 research tasks", { exact: true }).waitFor();
  await page.getByText("Research task created and visible. Keep a backup of important local work.").waitFor();
  await page.getByText("Acceptance test: Arc research question one", { exact: true }).last().waitFor();
  await page.getByRole("button", { name: "New research task" }).click();
  await page.getByPlaceholder("What would you like to investigate?").fill("Acceptance test: second task");
  await page.getByPlaceholder("0x... independently verified").fill("0x1111111111111111111111111111111111111111");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.getByText("2 research tasks", { exact: true }).waitFor();
  await page.getByText("Acceptance test: second task", { exact: true }).last().waitFor();
  const savedWorkspace = JSON.parse(await readFile(join(userData, "workspace.json"), "utf8")).path;
  const persisted = await page.evaluate(async () => (await window.keryxDesktop.refresh()).tasks
    .map(task => ({ directoryName: task.directoryName, question: task.question })));
  const expectedQuestions = ["Acceptance test: Arc research question one", "Acceptance test: second task"];
  if (persisted.length !== 2 || expectedQuestions.some(question => !persisted.some(task => task.question === question))) {
    throw new Error("Both acceptance tasks were not visible through persisted workspace refresh");
  }
  for (const row of persisted) {
    const file = JSON.parse(await readFile(join(savedWorkspace, row.directoryName, "task.json"), "utf8"));
    if (file.request.question !== row.question) throw new Error("Persisted task file differs from workspace view");
  }
  const selectedTask = join(savedWorkspace, persisted.find(row => row.question === expectedQuestions[1]).directoryName);
  const intent = await makeTestJournal(selectedTask);
  const firstFixture = completedFixture(intent, "Acceptance test answer one [1]");
  const first = await resumeOperatorTask(selectedTask, buyer => resumeResearch(buyer, fixtureHttp(firstFixture, intent.queryId)));
  if (first.localResult.state !== "saved") throw new Error("Verified test answer was not saved");
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByText("Acceptance test answer one [1]").waitFor();
  if (await page.evaluate(() => typeof window.require !== "undefined" || typeof window.process !== "undefined")) {
    throw new Error("Renderer gained Node access");
  }
  const rejected = await page.evaluate(async () => {
    try { await window.keryxDesktop.createTask({ question: "Invalid", mode: "quick", payee: "../../etc/passwd", creatorBudget: "0.01", totalCap: "0.10" }); return false; }
    catch { return true; }
  });
  if (!rejected) throw new Error("Main accepted an invalid create payload");
  const exportPath = join(temp, "export.json");
  await application.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, exportPath);
  await page.getByRole("button", { name: "Export status JSON" }).click();
  await page.getByText("Private status JSON saved.").waitFor();
  const statusJson = await readFile(exportPath, "utf8");
  if (JSON.parse(statusJson).payment !== "unknown") throw new Error("Export changed payment authority");
  await page.getByRole("button", { name: "Export status JSON" }).click();
  await page.getByText("Could not complete action").waitFor();
  if (await readFile(exportPath, "utf8") !== statusJson || await page.getByText("Private status JSON saved.").count()) {
    throw new Error("Repeated status export overwrote an existing file or showed false success");
  }
  const canceledPath = join(temp, "canceled.json");
  await application.evaluate(({ dialog }, destination) => {
    globalThis.saveDialogEntered = new Promise(entered => {
      dialog.showSaveDialog = () => new Promise(resolve => {
        globalThis.releaseSaveCancellation = () => resolve({ canceled: true, filePath: destination });
        entered();
      });
    });
  }, canceledPath);
  const statusButton = page.getByRole("button", { name: "Export status JSON" });
  await statusButton.click();
  await page.waitForFunction(() => [...document.querySelectorAll("button")]
    .some(button => button.textContent === "Export status JSON" && button.disabled));
  await application.evaluate(() => globalThis.saveDialogEntered);
  await application.evaluate(() => {
    if (!globalThis.releaseSaveCancellation) throw new Error("Native save dialog was not called");
    globalThis.releaseSaveCancellation();
    delete globalThis.releaseSaveCancellation;
    delete globalThis.saveDialogEntered;
  });
  await page.waitForFunction(() => [...document.querySelectorAll("button")]
    .some(button => button.textContent === "Export status JSON" && !button.disabled));
  if (await page.getByText("Private status JSON saved.").count() || await page.getByText("Could not complete action").count()) {
    throw new Error("Canceled status export showed a success or failure notice");
  }
  try { await readFile(canceledPath); throw new Error("Canceled status export wrote a file"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if ((await readdir(temp)).some(name => name.startsWith(".keryx-brief-"))) {
    throw new Error("Canceled status export left a staging file");
  }
  const briefPath = join(temp, "private-brief.md");
  await application.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, briefPath);
  await page.getByRole("button", { name: "Export private brief" }).click();
  await page.getByText("Private research brief saved.").waitFor();
  const brief = await readFile(briefPath, "utf8");
  if (!brief.includes("Acceptance test answer one") || !brief.includes("Acceptance test source")
    || brief.includes(intent.queryId)) throw new Error("Private brief omitted answer/citation or leaked job ID");
  await page.getByRole("button", { name: "Export private brief" }).click();
  await page.getByText("Could not complete action").waitFor();
  if (await readFile(briefPath, "utf8") !== brief || await page.getByText("Private research brief saved.").count()) {
    throw new Error("Repeated brief export overwrote an existing file or showed false success");
  }
  const { stdout: cliResult } = await execFile(process.execPath, ["--import", "tsx", "scripts/operator.mts", "result", "--state", selectedTask],
    { cwd: resolve(desktop, ".."), env: environment });
  if (JSON.parse(cliResult).answer !== "Acceptance test answer one [1]") throw new Error("CLI offline result differs");
  const cliBriefPath = join(temp, "cli-brief.md");
  await execFile(process.execPath, ["--import", "tsx", "scripts/operator.mts", "brief", "--state", selectedTask, "--file", cliBriefPath],
    { cwd: resolve(desktop, ".."), env: environment });
  if (!(await readFile(cliBriefPath, "utf8")).includes("Acceptance test answer one")) throw new Error("CLI brief differs");
  await application.evaluate(({ dialog }, sourcePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] }); }, source);
  await page.getByRole("button", { name: "Import file" }).click();
  await page.getByText("reference.md").waitFor();
  if (screenshotPath) {
    await mkdir(resolve(screenshotPath, ".."), { recursive: true });
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].showInactive(); });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].hide(); });
  }
  const state = JSON.parse(await readFile(join(userData, "workspace.json"), "utf8"));
  const workspace = state.path;
  const filenames = await (await import("node:fs/promises")).readdir(workspace);
  if (filenames.filter(name => name.startsWith("task-")).length !== 2 || !filenames.includes("references")) throw new Error("Persisted workspace is incomplete");
  await application.close(); application = undefined;
  application = await electron.launch({ executablePath: exe, args, cwd: desktop, env: environment, timeout: 30000 });
  page = await application.firstWindow();
  await page.getByText("2 research tasks").waitFor();
  await page.getByText("reference.md").waitFor();
  await page.getByText("Acceptance test: second task", { exact: true }).first().click();
  await page.getByText("Acceptance test answer one [1]").waitFor();
  const secondFixture = completedFixture(intent, "Acceptance test answer two [1]");
  await application.evaluate((_electron, fixture) => {
    globalThis.fetch = async (url, init) => {
      if (init?.method && init.method !== "GET") throw new Error("Unexpected non-GET fixture request");
      if (url === `https://keryx.cc/api/agent/ask?queryId=${fixture.queryId}`) return Response.json(fixture.job);
      if (url === `https://keryx.cc/api/dispatch/${fixture.queryId}/receipt`) return Response.json(fixture.receipt,
        { headers: { "x-keryx-receipt-digest": fixture.digest } });
      throw new Error("Unexpected fixture URL");
    };
  }, { ...secondFixture, queryId: intent.queryId });
  await page.getByRole("button", { name: "Check original job" }).click();
  await page.getByText("Acceptance test answer two [1]").waitFor();
  if (await page.getByText("Acceptance test answer one [1]").count()) throw new Error("UI retained stale saved answer");
  await application.evaluate(() => { globalThis.fetch = async () => new Response("{}", { status: 404 }); });
  await page.getByRole("button", { name: "Check original job" }).click();
  await page.getByText("PREVIOUS SAVED RESULT", { exact: false }).waitFor();
  await page.getByText("Acceptance test answer two [1]").waitFor();
  await writeFile(join(selectedTask, "result.json"), "{malformed");
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByText("Saved result cannot be opened:", { exact: false }).waitFor();
  await page.getByText("2 research tasks").waitFor();
  console.log(JSON.stringify({ mode: packaged ? "packaged" : "development", persistedTasks: 2,
    importedReference: true, verifiedSavedResult: true, offlineReopen: true, briefExport: true,
    statusExport: true, refusedOverwrite: true, canceledExport: true,
    repeatedCheckRefresh: true, previousResultPreserved: true, corruptResultTaskVisible: true,
    relaunch: true, screenshot: screenshotPath }));
  passed = true;
} finally {
  if (application) await application.close().catch(() => undefined);
  if (passed) await rm(temp, { recursive: true, force: true });
  else console.error("Smoke temp retained for diagnosis:", temp);
}

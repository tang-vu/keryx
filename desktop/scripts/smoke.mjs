import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packaged = process.argv[2] && process.argv[2] !== "--dev";
const exe = packaged ? process.argv[2] : join(desktop, "node_modules/electron/dist/electron.exe");
const args = packaged ? [] : [desktop];
const screenshotPath = process.argv[3] || join(desktop, "release/smoke.png");
const temp = await mkdtemp(join(tmpdir(), "keryx-desktop-smoke-"));
const parent = join(temp, "parent");
const userData = join(temp, "user-data");
const source = join(temp, "reference.md");
await mkdir(parent); await mkdir(userData);
await writeFile(join(userData, "workspace.json"), Buffer.alloc(4097, 65));
await writeFile(source, "# Local source\nA bounded immutable reference.\n");
const environment = { ...process.env, KERYX_DESKTOP_TEST_USER_DATA: userData, KERYX_DESKTOP_SMOKE_HIDDEN: "1" };
delete environment.KERYX_BUYER_PRIVATE_KEY;
let application;
let passed = false;
try {
  application = await electron.launch({ executablePath: exe, args, cwd: desktop, env: environment, timeout: 30000 });
  console.log("launched");
  let page = await application.firstWindow();
  console.log("first window", page.url());
  await page.waitForSelector("text=Your work, in one place.");
  await application.evaluate(({ dialog }, parentPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parentPath] }); }, parent);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByText("Prepare paid research").waitFor();
  await page.getByPlaceholder("What would you like to investigate?").fill("Acceptance test: Arc research question one");
  await page.getByPlaceholder("0x... independently verified").fill("0x1111111111111111111111111111111111111111");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.getByText("Acceptance test: Arc research question one", { exact: true }).last().waitFor();
  await page.getByRole("button", { name: "New research task" }).click();
  await page.getByPlaceholder("What would you like to investigate?").fill("Acceptance test: second task");
  await page.getByPlaceholder("0x... independently verified").fill("0x1111111111111111111111111111111111111111");
  await page.getByRole("button", { name: "Save task" }).click();
  await page.getByText("Acceptance test: second task", { exact: true }).last().waitFor();
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
  if (JSON.parse(await readFile(exportPath, "utf8")).payment !== "unknown") throw new Error("Export changed payment authority");
  await application.evaluate(({ dialog }, sourcePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] }); }, source);
  await page.getByRole("button", { name: "Import file" }).click();
  await page.getByText("reference.md").waitFor();
  await mkdir(resolve(screenshotPath, ".."), { recursive: true });
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].showInactive(); });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].hide(); });
  const state = JSON.parse(await readFile(join(userData, "workspace.json"), "utf8"));
  const workspace = state.path;
  const filenames = await (await import("node:fs/promises")).readdir(workspace);
  if (filenames.filter(name => name.startsWith("task-")).length !== 2 || !filenames.includes("references")) throw new Error("Persisted workspace is incomplete");
  await application.close(); application = undefined;
  application = await electron.launch({ executablePath: exe, args, cwd: desktop, env: environment, timeout: 30000 });
  page = await application.firstWindow();
  await page.getByText("2 research tasks").waitFor();
  await page.getByText("reference.md").waitFor();
  console.log(JSON.stringify({ mode: packaged ? "packaged" : "development", persistedTasks: 2,
    importedReference: true, relaunch: true, screenshot: screenshotPath }));
  passed = true;
} finally {
  if (application) await application.close().catch(() => undefined);
  if (passed) await rm(temp, { recursive: true, force: true });
  else console.error("Smoke temp retained for diagnosis:", temp);
}

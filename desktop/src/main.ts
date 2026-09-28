import { app, BrowserWindow, dialog, ipcMain, protocol, session } from "electron";
import { open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WorkspaceStore } from "./workspace";

const APP_ORIGIN = "keryx-app://desktop";
const allowedAssets = new Set(["index.html", "renderer.js", "style.css"]);
protocol.registerSchemesAsPrivileged([{ scheme: "keryx-app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (process.env.KERYX_DESKTOP_TEST_USER_DATA) app.setPath("userData", process.env.KERYX_DESKTOP_TEST_USER_DATA);
const store = new WorkspaceStore();
let window: BrowserWindow;

function validateSender(event: Electron.IpcMainInvokeEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
    || event.senderFrame.url !== `${APP_ORIGIN}/index.html`) throw new Error("Untrusted window");
}

function handle(channel: string, fn: (...args: unknown[]) => Promise<unknown>) {
  ipcMain.handle(channel, async (event, ...args) => {
    validateSender(event);
    return fn(...args);
  });
}

async function saveSelection() {
  const path = store.selectedPath;
  if (!path) return;
  await writeFile(join(app.getPath("userData"), "workspace.json"), JSON.stringify({ path }), { mode: 0o600 });
}

async function loadSelection() {
  try {
    const file = await open(join(app.getPath("userData"), "workspace.json"), "r");
    let data: string;
    try {
      const buffer = Buffer.alloc(4097);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > 4096) return;
      data = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
    } finally { await file.close(); }
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === "object" && "path" in parsed && typeof parsed.path === "string") {
      await store.select(parsed.path);
    }
  } catch { /* A moved workspace returns to the chooser. */ }
}

function registerIpc() {
  handle("workspace:open", async (...args) => {
    if (args.length) throw new Error("Invalid arguments");
    const choice = await dialog.showOpenDialog(window, { title: "Open Operator workspace", properties: ["openDirectory"] });
    if (choice.canceled || choice.filePaths.length !== 1) return null;
    const view = await store.select(choice.filePaths[0]);
    await saveSelection();
    return view;
  });
  handle("workspace:create", async (...args) => {
    if (args.length) throw new Error("Invalid arguments");
    const choice = await dialog.showOpenDialog(window, { title: "Choose a private parent folder", properties: ["openDirectory", "createDirectory"] });
    if (choice.canceled || choice.filePaths.length !== 1) return null;
    const view = await store.create(choice.filePaths[0]);
    await saveSelection();
    return view;
  });
  handle("workspace:refresh", async (...args) => { if (args.length) throw new Error("Invalid arguments"); return store.view(); });
  handle("task:create", async (...args) => { if (args.length !== 1) throw new Error("Invalid arguments"); return store.createTask(args[0]); });
  handle("task:resume", async (...args) => { if (args.length !== 1) throw new Error("Invalid arguments"); return store.resumeTask(args[0]); });
  handle("task:result", async (...args) => { if (args.length !== 1) throw new Error("Invalid arguments"); return store.readResult(args[0]); });
  handle("task:brief", async (...args) => {
    if (args.length !== 1) throw new Error("Invalid arguments");
    const data = await store.exportBrief(args[0]);
    const choice = await dialog.showSaveDialog(window, { title: "Export private research brief",
      defaultPath: "private-research-brief.md", filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (choice.canceled || !choice.filePath) return false;
    const file = await open(choice.filePath, "wx", 0o600);
    try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
    return true;
  });
  handle("task:export", async (...args) => {
    if (args.length !== 1) throw new Error("Invalid arguments");
    const data = await store.exportTask(args[0]);
    const choice = await dialog.showSaveDialog(window, { title: "Export private task status", defaultPath: "operator-task-status.json",
      filters: [{ name: "JSON", extensions: ["json"] }] });
    if (choice.canceled || !choice.filePath) return false;
    const file = await open(choice.filePath, "wx", 0o600);
    try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
    return true;
  });
  handle("reference:import", async (...args) => {
    if (args.length) throw new Error("Invalid arguments");
    const choice = await dialog.showOpenDialog(window, { title: "Import a local reference", properties: ["openFile"],
      filters: [{ name: "Text or Markdown", extensions: ["txt", "md", "markdown"] }] });
    if (choice.canceled || choice.filePaths.length !== 1) return null;
    return store.importReference(choice.filePaths[0]);
  });
}

async function createWindow() {
  window = new BrowserWindow({ width: 1240, height: 850, minWidth: 900, minHeight: 650,
    backgroundColor: "#0c1423", show: process.env.KERYX_DESKTOP_SMOKE_HIDDEN !== "1",
    webPreferences: { preload: join(__dirname, "preload.cjs"), sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  await window.loadURL(`${APP_ORIGIN}/index.html`);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(`${APP_ORIGIN}/`) }));
  protocol.handle("keryx-app", async (request) => {
    const url = new URL(request.url);
    const asset = url.pathname.slice(1);
    if (url.host !== "desktop" || !allowedAssets.has(asset) || url.search || url.hash) return new Response("Not found", { status: 404 });
    const mime = asset.endsWith(".html") ? "text/html; charset=utf-8" : asset.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/css; charset=utf-8";
    return new Response(await readFile(join(__dirname, asset)), { headers: { "content-type": mime } });
  });
  await loadSelection();
  registerIpc();
  await createWindow();
}).catch(async (error) => {
  if (process.env.KERYX_DESKTOP_TEST_USER_DATA) {
    await writeFile(join(app.getPath("userData"), "startup-error.txt"), String(error)).catch(() => undefined);
  } else dialog.showErrorBox("Keryx Operator could not start", String(error));
  app.quit();
});

app.on("window-all-closed", () => app.quit());

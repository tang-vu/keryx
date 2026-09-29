// Hermetic renderer check. This exercises presentation with a fake DesktopAPI;
// packaged Tauri/stdio authority is covered by separate acceptance checks.
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const output = join(root, ".artifacts", "desktop-ui");
await mkdir(output, { recursive: true });
await build({ entryPoints: [join(root, "desktop/src/renderer.tsx")], bundle: true,
  platform: "browser", format: "iife", outfile: join(output, "renderer.js"), logLevel: "silent" });
await build({ entryPoints: [join(root, "desktop/src/style.css")], bundle: true,
  external: ["./fonts/*"], outfile: join(output, "style.css"), logLevel: "silent" });

const pageHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/renderer.js"></script></html>`;
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path === "/") { response.setHeader("Content-Type", "text/html"); response.end(pageHtml); return; }
  const file = path.startsWith("/fonts/") ? join(root, "desktop/assets", path.slice(1))
    : path === "/renderer.js" || path === "/style.css" ? join(output, path.slice(1)) : null;
  if (!file) { response.writeHead(404).end(); return; }
  try {
    response.setHeader("Content-Type", path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" : "font/woff2");
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolveServer => server.listen(0, "127.0.0.1", resolveServer));
const address = server.address();
const browser = await chromium.launch({ headless: true });
const screenshots = [];
const task = { handle: "task-1", directoryName: "task-1", question: "How does Arc settle a citation toll?", mode: "deep",
  payee: "0x1111111111111111111111111111111111111111", createdAt: "2026-09-29T09:00:00Z",
  status: { stage: "buyer_journaled", creatorBudgetMicros: 10000, maxTotalMicros: 100000,
    savedResult: "present_unchecked", lastObservation: { status: "completed", observedAt: "2026-09-29T09:05:00Z", payment: "seller_reported" } } };
const view = { name: "Operator research", path: "C:\\private\\operator", tasks: [task],
  references: [{ handle: "ref-1", name: "Background reading.md", importedAt: "2026-09-29T08:00:00Z",
    bytes: 1024, sha256: "a".repeat(64) }], invalidDirectories: 0 };
const result = { answer: "A cited result grounded in the saved receipt [1].", citations: [{ marker: "[1]", sourceName: "Acceptance source" }],
  savedAt: "2026-09-29T09:06:00Z" };
async function openPage(scenario, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.addInitScript(({ scenario, view, result }) => {
    const initial = scenario === "empty" || scenario === "startup-error" ? null : view;
    window.keryxDesktop = {
      refresh: async () => { if (scenario === "startup-error") throw Error("Local helper unavailable"); return initial; },
      chooseWorkspace: async () => view, createWorkspace: async () => view,
      createTask: async () => ({ ...view.tasks[0], publicationState: "windows_visible_entry_unproven" }),
      resumeTask: () => scenario === "pending-resume" ? new Promise(() => {}) : Promise.reject(Error("Offline UI fixture")),
      readResult: () => scenario === "pending-result" ? new Promise(() => {}) : Promise.resolve(result),
      exportBrief: async () => true, exportTask: async () => true,
      importReference: async () => view.references[0],
    };
  }, { scenario, view, result });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.locator(".loading-state").waitFor({ state: "hidden" });
  const fontsReady = await page.evaluate(async () => {
    await document.fonts.ready;
    return ["Bodoni Moda", "Spectral", "Spline Sans Mono"]
      .every(name => document.fonts.check(`12px "${name}"`));
  });
  if (!fontsReady) throw Error(`Bundled Mint fonts failed to load in ${scenario}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw Error(`Horizontal overflow in ${scenario} at ${width}×${height}`);
  return page;
}
try {
  const empty = await openPage("empty", 1240, 850);
  await empty.getByRole("heading", { name: "Your work, in one place." }).waitFor();
  screenshots.push(join(output, "onboarding-1240.png"));
  await empty.screenshot({ path: screenshots.at(-1), fullPage: true });
  await empty.close();

  for (const [width, height] of [[1240, 850], [760, 600]]) {
    const page = await openPage("workspace", width, height);
    const question = page.getByRole("textbox", { name: "Research question" });
    await question.waitFor();
    const questionY = (await question.boundingBox())?.y ?? Infinity;
    if (questionY > 400) throw Error(`Question falls below first reading area at ${width}px (${questionY}px)`);
    if (await page.getByRole("radio", { name: /Quick/ }).isChecked() !== true) throw Error("Quick default missing");
    await page.getByRole("radio", { name: /Deep/ }).check();
    if (await page.getByRole("radio", { name: /Deep/ }).isChecked() !== true) throw Error("Deep mode cannot be selected");
    await page.keyboard.press("Tab");
    const focusVisible = await page.evaluate(() => document.activeElement?.matches(":focus-visible") ?? false);
    if (!focusVisible) throw Error("Keyboard focus is not visible");
    screenshots.push(join(output, `research-desk-${width}.png`));
    await page.screenshot({ path: screenshots.at(-1), fullPage: true });
    await page.getByRole("button", { name: /How does Arc settle/ }).click();
    await page.getByText("A cited result grounded in the saved receipt").waitFor();
    if (await page.getByText("PINNED SELLER PAYEE").count() < 1) throw Error("Payee not visible in task detail");
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error("Task detail overflows");
    screenshots.push(join(output, `task-detail-${width}.png`));
    await page.screenshot({ path: screenshots.at(-1), fullPage: true });
    await page.close();
  }
  const failed = await openPage("startup-error", 760, 600);
  await failed.getByRole("alert").getByText("Local helper unavailable").waitFor();
  screenshots.push(join(output, "startup-error-760.png"));
  await failed.screenshot({ path: screenshots.at(-1), fullPage: true });
  await failed.close();

  const pendingResult = await openPage("pending-result", 760, 600);
  const taskButton = pendingResult.getByRole("button", { name: /How does Arc settle/ });
  await taskButton.click();
  await pendingResult.getByText("Opening saved result…").waitFor();
  if (!await taskButton.isDisabled() || !await pendingResult.getByRole("button", { name: "Check original job" }).isDisabled()) {
    throw Error("Automatic saved-result read leaves task selection or recovery enabled");
  }
  await pendingResult.close();

  const pendingResume = await openPage("pending-resume", 760, 600);
  const resumeTaskButton = pendingResume.getByRole("button", { name: /How does Arc settle/ });
  await resumeTaskButton.click();
  await pendingResume.getByText("A cited result grounded in the saved receipt").waitFor();
  await pendingResume.getByRole("button", { name: "Check original job" }).click();
  await pendingResume.getByText("Resuming…").waitFor();
  if (!await resumeTaskButton.isDisabled() || !await pendingResume.getByRole("button", { name: /New research task/ }).isDisabled()) {
    throw Error("Pending recovery leaves task selection or new-task navigation enabled");
  }
  await pendingResume.close();
  console.log(`Desktop UI smoke passed. Screenshots: ${screenshots.join(", ")}`);
} finally {
  await browser.close();
  await new Promise(resolveServer => server.close(resolveServer));
}

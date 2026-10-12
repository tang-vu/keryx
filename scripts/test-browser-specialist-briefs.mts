/** Actual built preparation UI, offline. Browser requests never reach research/payment APIs. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";
import { specialistBriefCopy as copy } from "../locales/en/specialist-briefs";
import { SPECIALIST_BRIEF_IDS, specialistBriefs } from "../lib/research/specialist-briefs";

const source = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "keryx-specialist-briefs-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const screenshots = process.env.KERYX_BRIEF_SCREENSHOT_DIR;
if (screenshots) await mkdir(screenshots, { recursive: true });
const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
const address = listener.address(); assert(address && typeof address === "object");
await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
const origin = `http://127.0.0.1:${address.port}`;
let child: ReturnType<typeof spawn> | undefined, stopped: Promise<void> | undefined, didExit = false;
const browser = await chromium.launch({ headless: true });
try {
  await copyNextConfigFixture(source, temporary);
  for (const folder of ["node_modules", ".next", "public"])
    await symlink(join(source, folder), join(temporary, folder), process.platform === "win32" ? "junction" : "dir");
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", BASE_URL: origin,
    KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
    KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0" };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "COMSPEC", "PATHEXT"])
    if (process.env[name]) env[name] = process.env[name];
  child = spawn(process.execPath, [join(source, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(address.port)],
    { cwd: temporary, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", value => { output = (output + String(value)).slice(-3000); });
  child.stderr?.on("data", value => { output = (output + String(value)).slice(-3000); });
  stopped = new Promise<void>(done => child!.once("exit", () => { didExit = true; done(); }));
  let ready = false;
  for (let attempt = 0; attempt < 80 && !didExit; attempt++) {
    try { ready = (await fetch(origin + "/briefs", { signal: AbortSignal.timeout(2000) })).ok; } catch { /* bounded startup */ }
    if (ready) break;
    await new Promise(done => setTimeout(done, 250));
  }
  assert(ready, `Built brief page unavailable: ${output}`);
  const html = await (await fetch(origin + "/briefs")).text();
  assert(html.includes(copy.title) && html.includes("/briefs"));
  assert(!html.includes('content="noindex'));
  for (const width of [320, 390, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, permissions: ["clipboard-read", "clipboard-write"] });
    const outbound: string[] = [];
    try {
      await context.route("**/*", route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin || request.method() !== "GET") { outbound.push(request.url()); return route.abort(); }
        if (url.pathname.startsWith("/api/")) {
          if (/\/api\/(?:ask(?:\/|$)|agent\/ask|source\/|cite\/)/u.test(url.pathname)) outbound.push(url.pathname);
          return route.fulfill({ status: 503, json: { error: "Offline preparation fixture" } });
        }
        return route.continue();
      });
      const page = await context.newPage();
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(origin + "/briefs"); await page.getByRole("heading", { level: 1, name: copy.title }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      for (const track of SPECIALIST_BRIEF_IDS) {
        await page.locator(`input[value="${track}"]`).check();
        await page.getByLabel(copy.decision).fill(`Synthetic ${track} decision, not a live task.`);
        await page.getByLabel(copy.context).fill("Synthetic small-team constraints.");
        await page.getByLabel(copy.sources).fill("https://example.org/docs");
        await page.getByRole("button", { name: copy.prepare, exact: true }).click();
        const question = await page.getByRole("textbox", { name: copy.review, exact: true }).inputValue();
        assert(question.includes(specialistBriefs[track].instruction));
        assert(question.includes("Unread source leads:"));
        assert.equal(await page.getByRole("link", { name: copy.checkout, exact: true }).getAttribute("href"), "/research?mode=deep#paid-research");
        const downloading = page.waitForEvent("download");
        await page.getByRole("button", { name: copy.download, exact: true }).click();
        const download = await downloading, downloadPath = await download.path(); assert(downloadPath);
        const request = JSON.parse(await readFile(downloadPath, "utf8"));
        assert.deepEqual(Object.keys(request).sort(), ["packageVersion", "question", "researchMode", "responseMode"]);
        assert.equal(request.question, question); assert.equal(request.researchMode, "deep");
        await page.getByRole("button", { name: copy.copy, exact: true }).click();
        await page.getByText(copy.copied, { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), question);
        await page.getByLabel(copy.sources).fill("http://example.org/docs");
        assert.equal(await page.getByRole("textbox", { name: copy.review, exact: true }).count(), 0, "Editing hides the stale request");
        await page.getByRole("button", { name: copy.prepare, exact: true }).click();
        await page.getByRole("alert").filter({ hasText: copy.invalid }).waitFor();
        assert.equal(await page.getByRole("button", { name: copy.download, exact: true }).count(), 0);
      }
      await page.reload();
      assert.equal(await page.getByLabel(copy.decision).inputValue(), "", "Draft is not persisted");
      assert.equal(await page.getByRole("textbox", { name: copy.review, exact: true }).count(), 0);
      if (screenshots) await page.screenshot({ path: join(screenshots, `briefs-${width}.png`), fullPage: true });
      assert.deepEqual(outbound, []); assert.deepEqual(errors, []);
    } finally { await context.unrouteAll({ behavior: "wait" }); await context.close(); }
  }
  console.log("PASS built specialist drafts: all three tracks, mobile layout, copy/download, unsafe-lead refusal, stale-result invalidation and no persistence; no research/payment requests.");
} finally {
  await browser.close();
  if (child && !didExit) child.kill();
  if (stopped) await stopped;
  await rm(temporary, { recursive: true, force: true });
}

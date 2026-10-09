/** Built local Next workflow with explicitly synthetic report/metadata fixtures.
 * No provider/API/wallet calls or factual usefulness claim. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser } from "playwright";
import { evidenceDraftFixture } from "../lib/research/fixtures/evidence-draft";
import { buildEvidenceDraft } from "../lib/research/evidence-draft";
import { LITERATURE_STORAGE_KEY } from "../lib/papers/literature-workspace";

const source = resolve(import.meta.dirname, ".."), dist = resolve(source, process.env.NEXT_DIST_DIR ?? ".next");
await readFile(join(dist, "BUILD_ID"), "utf8");
const artifacts = join(source, ".artifacts", "evidence-drafts"), fixture = join(artifacts, `runtime-${randomUUID()}`);
await mkdir(join(fixture, "lib"), { recursive: true }); await mkdir(join(fixture, "data"));
for (const file of ["package.json", "next.config.ts", "lib/security-headers.ts", "lib/arc-network-profile.ts", "lib/circle-wallet-config.ts"]) await writeFile(join(fixture, file), await readFile(join(source, file)));
await symlink(join(source, "node_modules"), join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");
await symlink(dist, join(fixture, ".next"), process.platform === "win32" ? "junction" : "dir");
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
const address = listener.address(); assert(address && typeof address !== "string"); const port = address.port;
await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
const base = `http://127.0.0.1:${port}`;
const environment = { ...process.env, NODE_ENV: "production", BASE_URL: base, JWT_SECRET: randomBytes(32).toString("hex"),
  KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
  NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_URL: "" };
for (const name of Object.keys(environment)) if (/^KERYX_(?:STORAGE|SQLITE|SUPABASE)/.test(name) || name === "NEXT_DIST_DIR") delete environment[name as keyof typeof environment];
const server = spawn(process.execPath, [join(source, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: fixture, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: environment,
});
let output = ""; server.stdout.on("data", value => { output = (output + String(value)).slice(-3000); });
server.stderr.on("data", value => { output = (output + String(value)).slice(-3000); });
let didExit = false, startupError: Error | undefined, browser: Browser | undefined;
const exited = new Promise<void>(resolve => server.once("exit", () => { didExit = true; resolve(); }));
server.once("error", error => { startupError = error; });
const waitForExit = (milliseconds: number) => new Promise<boolean>(resolve => {
  const timeout = setTimeout(() => resolve(false), milliseconds);
  void exited.then(() => { clearTimeout(timeout); resolve(true); });
});
try {
  browser = await chromium.launch({ headless: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError) throw new Error("Built local draft server could not start");
    if (didExit) throw new Error(`Built local draft server exited before readiness: ${output}`);
    try { ready = (await fetch(`${base}/literature/drafts`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Starting */ }
    if (ready) break; await delay(250);
  }
  assert(ready, `Built local draft server failed: ${output}`);
  // A valid public Origin reaches session authentication even if Next canonicalizes
  // Request.url internally to localhost. Forwarded request headers cannot widen it.
  const apiRequest = (origin: string) => fetch(`${base}/api/research/evidence-draft`, {
    method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json",
      "X-Forwarded-Host": "attacker.example", "X-Forwarded-Proto": "https" }, body: "PRIVATE_INVALID_JSON", signal: AbortSignal.timeout(5000),
  });
  const unauthenticated = await apiRequest(base); assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("cache-control"), "private, no-store");
  assert.equal((await apiRequest("https://attacker.example")).status, 403);
  console.log("Built private draft API: configured public Origin reaches session authentication; foreign Origin refuses before parsing private input.");
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
    const fixture = evidenceDraftFixture(), report = fixture.reports[0], expectedKey = buildEvidenceDraft(fixture).excerpts[0].id;
    await context.addInitScript(({ key, workspace }) => localStorage.setItem(key, JSON.stringify(workspace)), { key: LITERATURE_STORAGE_KEY, workspace: fixture.workspace });
    const blocked: string[] = [];
    await context.route("**/*", async route => {
      const parsed = new URL(route.request().url());
      if (parsed.origin !== base) { blocked.push("external"); await route.abort(); return; }
      if (parsed.pathname.startsWith("/api/")) { blocked.push(parsed.pathname); await route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); return; }
      await route.continue();
    });
    const page = await context.newPage(); await page.goto(`${base}/literature/drafts`);
    await page.getByLabel("Retained Keryx report JSON").fill(JSON.stringify(report));
    await page.getByRole("button", { name: "Import report in this tab" }).click();
    await page.getByText("Reports: 1 · matching retained excerpts: 1", { exact: true }).waitFor();
    const passage = page.getByLabel("Your original passage"); await passage.fill(fixture.passage);
    await passage.evaluate(element => { const area = element as HTMLTextAreaElement; area.focus(); area.setSelectionRange(0, area.value.length); });
    await page.getByRole("button", { name: "Add selected claim" }).click();
    const claims = page.getByRole("region", { name: "Claim assessment" });
    await claims.getByRole("checkbox").check(); await page.getByLabel("Your name for an optional assessment").fill("Fixture researcher");
    await claims.getByRole("button", { name: "Record my partly supported assessment", exact: true }).click();
    await claims.getByText("Your assessment: partly supported", { exact: true }).waitFor();
    const themes = page.getByRole("region", { name: "Related-work themes" });
    await themes.getByLabel("Your synthesis notes (unverified)").fill("My retained first-theme edits");
    await themes.getByRole("checkbox").check(); await themes.getByRole("button", { name: "Add theme", exact: true }).click();
    await themes.getByLabel("Your synthesis notes (unverified)").nth(1).fill("Second-theme edits");
    await themes.getByRole("button", { name: "Clear this theme’s excerpt selections", exact: true }).nth(1).click();
    assert.equal(await themes.getByLabel("Your synthesis notes (unverified)").first().inputValue(), "My retained first-theme edits");
    const download = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download Markdown", exact: true }).click()]);
    const mdPath = await download[0].path(); assert(mdPath); const md = await readFile(mdPath, "utf8");
    assert(md.includes(`id="${expectedKey}"`)); assert(md.includes(report.evidence![0].quote)); assert(md.includes("unverified"));
    const bibDownload = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download BibTeX", exact: true }).click()]);
    const bibPath = await bibDownload[0].path(); assert(bibPath); const bib = await readFile(bibPath, "utf8");
    const citedKey = md.match(/\[@(keryxDraft[a-f0-9]+)\]/)?.[1]; assert(citedKey); assert(bib.includes(`{${citedKey},`));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `Overflow at ${width}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(artifacts, `drafts-${width}.png`), fullPage: true });
    await page.reload(); assert.equal(await page.getByLabel("Your original passage").inputValue(), "");
    assert.equal(blocked.filter(path => path.includes("research/evidence-draft") || path.includes("ask")).length, 0);
    await context.close(); console.log(`Built private drafts ${width}px: exact claim, named assessment, theme preservation, citation/reference downloads and memory reset passed.`);
  }
} finally {
  try { await browser?.close(); } finally {
    if (!didExit && server.pid !== undefined) {
      server.kill();
      if (!await waitForExit(5000)) {
        server.kill("SIGKILL");
        assert(await waitForExit(5000), "Built local draft server cleanup failed: child exit was not observed");
      }
    }
  }
}
console.log("Built private drafts: all responsive workflows and observed isolated server exit passed. Synthetic fixtures only.");

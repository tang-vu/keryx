/** Built local Next workflow with explicitly synthetic report/metadata fixtures.
 * No provider/API/wallet calls or factual usefulness claim. */
import { copyNextConfigFixture } from "../test-support/next-config-fixture";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer as createListener } from "node:net";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser } from "playwright";
import { evidenceDraftFixture } from "../lib/research/fixtures/evidence-draft";
import { buildEvidenceDraft } from "../lib/research/evidence-draft";
import { LITERATURE_STORAGE_KEY } from "../lib/papers/literature-workspace";
import { saveLiteraturePaper } from "../lib/papers/literature-workspace";
import { PAPER_CATALOG } from "../lib/papers/catalog";

const source = resolve(import.meta.dirname, ".."), dist = resolve(source, process.env.NEXT_DIST_DIR ?? ".next");
await readFile(join(dist, "BUILD_ID"), "utf8");
const artifacts = join(source, ".artifacts", "evidence-drafts"), fixture = join(artifacts, `runtime-${randomUUID()}`);
await mkdir(join(fixture, "lib"), { recursive: true }); await mkdir(join(fixture, "data"));
await copyNextConfigFixture(source, fixture);
await symlink(join(source, "node_modules"), join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");
await symlink(dist, join(fixture, ".next"), process.platform === "win32" ? "junction" : "dir");
const listener = createListener();
await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
const address = listener.address(); assert(address && typeof address !== "string"); const port = address.port;
await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
const base = `http://127.0.0.1:${port}`;
const environment = { ...process.env, NODE_ENV: "production", BASE_URL: base, JWT_SECRET: randomBytes(32).toString("hex"),
  KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
  NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_URL: "" };
for (const name of Object.keys(environment)) if (/^KERYX_(?:STORAGE|SQLITE|SUPABASE)/.test(name) || name === "NEXT_DIST_DIR") delete environment[name as keyof typeof environment];
// Programmatic Next owns this loopback fixture in this test process. Close both
// servers gracefully; never kill a worker/server process to complete a check.
const previousCwd = process.cwd(), previousEnvironment = { ...process.env };
for (const name of Object.keys(process.env)) if (!(name in environment)) delete process.env[name];
Object.assign(process.env, environment); process.chdir(fixture);
// Keep Next's ProcessEnv augmentation out of the lean operations-script graph.
// This is the installed programmatic server's documented prepare/handler/close API.
const next = createRequire(import.meta.url)("next") as (options: { dev: boolean; dir: string; hostname: string; port: number }) => {
  prepare(): Promise<void>; close(): Promise<void>;
  getRequestHandler(): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
};
const app = next({ dev: false, dir: fixture, hostname: "127.0.0.1", port });
const server = createServer((request, response) => { void app.getRequestHandler()(request, response); });
let browser: Browser | undefined;
try {
  await app.prepare();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  browser = await chromium.launch({ headless: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(`${base}/literature/drafts`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Starting */ }
    if (ready) break; await delay(250);
  }
  assert(ready, "Built local draft server failed readiness");
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
    for (const paper of PAPER_CATALOG.slice(1, 3)) fixture.workspace = saveLiteraturePaper(fixture.workspace, paper, "2026-10-12T00:00:00.000Z");
    for (const row of fixture.workspace.entries) row.screening = "include";
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
    await themes.getByLabel("Your reading observation").first().selectOption("unread");
    await themes.getByLabel("Your reading observation").nth(1).selectOption("unavailable");
    await themes.getByLabel("Your reason (optional)").nth(1).fill("Fixture access failure");
    assert.equal(await themes.getByRole("link", { name: "Prepare reading request in a new tab", exact: true }).count(), 2);
    const readingHref = await themes.getByRole("link", { name: "Prepare reading request in a new tab", exact: true }).first().getAttribute("href");
    assert(readingHref); const readingUrl = new URL(readingHref, base);
    assert.equal(readingUrl.searchParams.has("run"), false); assert.equal(readingUrl.searchParams.get("mode"), "deep");
    assert(readingUrl.searchParams.get("q")?.includes(fixture.workspace.entries[1].paper.url));
    await themes.getByLabel("Your synthesis notes (unverified)").fill("My retained first-theme edits");
    await themes.getByRole("checkbox").check(); await themes.getByRole("button", { name: "Add theme", exact: true }).click();
    await themes.getByLabel("Your synthesis notes (unverified)").nth(1).fill("Second-theme edits");
    await themes.getByRole("button", { name: "Clear this theme’s excerpt selections", exact: true }).nth(1).click();
    assert.equal(await themes.getByLabel("Your synthesis notes (unverified)").first().inputValue(), "My retained first-theme edits");
    // One author statement: withheld until it names one paper and a retained excerpt of that paper.
    await themes.getByRole("button", { name: "Add statement", exact: true }).first().click();
    await themes.getByText("Write the sentence to include it in the draft.", { exact: true }).waitFor();
    await themes.getByLabel("Your sentence").fill("The fixture method improved its measured outcome.");
    await themes.getByText("Not exported yet: a contribution names exactly one paper.", { exact: true }).waitFor();
    await themes.getByRole("group", { name: "Papers this sentence names" }).getByRole("checkbox").first().check();
    await themes.getByText("Not exported yet: select a retained excerpt for every paper this sentence names.", { exact: true }).waitFor();
    await themes.getByRole("group", { name: "Retained excerpts this sentence relies on" }).getByRole("checkbox").check();
    await themes.getByText("Will be exported with its citation and excerpt links.", { exact: true }).waitFor();
    assert.equal(await themes.getByLabel("Your synthesis notes (unverified)").nth(1).inputValue(), "Second-theme edits");
    const download = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download Markdown", exact: true }).click()]);
    const mdPath = await download[0].path(); assert(mdPath); const md = await readFile(mdPath, "utf8");
    assert(md.includes(`id="${expectedKey}"`)); assert(md.includes(report.evidence![0].quote)); assert(md.includes("unverified"));
    assert(md.includes("**Contribution.** The fixture method improved its measured outcome. [@keryxDraft")); assert(md.includes(`retained excerpts: [1](#${expectedKey})`));
    assert(md.includes("## Unread papers (caller observation)")); assert(md.includes("## Unavailable papers (caller observation)"));
    assert(md.includes("unavailable; not described. Reason: Fixture access failure"));
    const bibDownload = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download BibTeX", exact: true }).click()]);
    const bibPath = await bibDownload[0].path(); assert(bibPath); const bib = await readFile(bibPath, "utf8");
    const citedKey = md.match(/\[@(keryxDraft[a-f0-9]+)\]/)?.[1]; assert(citedKey); assert(bib.includes(`{${citedKey},`));
    // Unfinished rows intentionally stay outside the export request, but their
    // text, kind and selected papers/excerpts must survive both editor actions.
    const articles = themes.locator("article"), unfinished = articles.nth(1), unfinishedText = " \n\t ";
    await unfinished.getByRole("button", { name: "Add statement", exact: true }).click();
    await unfinished.getByLabel("What this sentence does").selectOption("gap");
    await unfinished.getByLabel("Your sentence").fill(unfinishedText);
    await unfinished.getByRole("group", { name: "Papers this sentence names" }).getByRole("checkbox").first().check();
    await unfinished.getByRole("group", { name: "Retained excerpts this sentence relies on" }).getByRole("checkbox").check();
    const assertUnfinished = async () => {
      assert.equal(await unfinished.getByLabel("Your sentence").inputValue(), unfinishedText);
      assert.equal(await unfinished.getByLabel("What this sentence does").inputValue(), "gap");
      assert.equal(await unfinished.getByRole("group", { name: "Papers this sentence names" }).getByRole("checkbox").first().isChecked(), true);
      assert.equal(await unfinished.getByRole("group", { name: "Retained excerpts this sentence relies on" }).getByRole("checkbox").isChecked(), true);
    };
    // Targeted regeneration must preserve other theme edits, and its generated
    // sentence remains editable without an assembly operation running again.
    await themes.getByRole("button", { name: "Regenerate this theme from selected excerpts", exact: true }).first().click();
    await assertUnfinished();
    assert.equal(await themes.getByLabel("Your synthesis notes (unverified)").first().inputValue(), "My retained first-theme edits");
    assert.equal(await themes.getByLabel("Your synthesis notes (unverified)").nth(1).inputValue(), "Second-theme edits");
    assert.equal(await articles.first().getByLabel("Your sentence").inputValue(), `The retained excerpt states: “${report.evidence![0].quote}”`);
    await articles.first().getByLabel("Your sentence").fill("My in-place contribution edit.");
    await themes.getByRole("button", { name: "Assemble retained contributions", exact: true }).click();
    await assertUnfinished();
    assert.equal(await articles.first().getByLabel("Your sentence").inputValue(), "My in-place contribution edit.");
    const editedDownload = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download Markdown", exact: true }).click()]);
    const editedPath = await editedDownload[0].path(); assert(editedPath);
    const edited = await readFile(editedPath, "utf8"); assert(edited.includes("My in-place contribution edit."));
    assert(edited.includes(`[@${citedKey}]`));
    await themes.getByRole("button", { name: "Clear reading observations", exact: true }).click();
    assert.equal(await themes.getByLabel("Your reading observation").first().inputValue(), "");
    assert.equal(await articles.first().getByLabel("Your sentence").inputValue(), "My in-place contribution edit.");
    assert.equal(await themes.getByLabel("Your synthesis notes (unverified)").nth(1).inputValue(), "Second-theme edits");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `Overflow at ${width}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(artifacts, `drafts-${width}.png`), fullPage: true });
    await page.reload(); assert.equal(await page.getByLabel("Your original passage").inputValue(), "");
    assert.equal(blocked.filter(path => path.includes("research/evidence-draft") || path.includes("ask")).length, 0);
    await context.close(); console.log(`Built private drafts ${width}px: exact claim, named assessment, theme preservation, excerpt-bound statement, citation/reference downloads and memory reset passed.`);
  }
} finally {
  try { await browser?.close(); } finally {
    try {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await app.close();
      assert.equal(server.listening, false, "Built local draft server did not close");
    } finally {
      process.chdir(previousCwd);
      for (const name of Object.keys(process.env)) if (!(name in previousEnvironment)) delete process.env[name];
      Object.assign(process.env, previousEnvironment);
    }
  }
}
console.log("Built private drafts: all responsive workflows and graceful isolated server close passed. Synthetic fixtures only.");

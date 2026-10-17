/** Built informational routes, crawlable text and mobile navigation. No research or payment. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";
import { productGuideCopy as copy } from "../locales/en/product-guide";
import { quoteA2aResearch } from "../lib/a2a/pricing";
import { config } from "../lib/config";
import { formatRecordedAmount } from "../lib/i18n/format";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../lib/public-support";
import { setupCopy } from "../locales/en/get-started";
import { installationLinks, setupExamples } from "../lib/public-installation";

const source = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "keryx-product-guide-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const screenshots = process.env.KERYX_PRODUCT_SCREENSHOT_DIR;
if (screenshots) await mkdir(screenshots, { recursive: true });
const listener = createServer();
listener.listen(0, "127.0.0.1"); await once(listener, "listening");
const address = listener.address(); assert(address && typeof address === "object");
await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
const transport = `http://127.0.0.1:${address.port}`, origin = transport;
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
  child.stdout?.on("data", value => { output = (output + String(value)).slice(-4000); });
  child.stderr?.on("data", value => { output = (output + String(value)).slice(-4000); });
  stopped = new Promise<void>(done => child!.once("exit", () => { didExit = true; done(); }));
  let ready = false;
  for (let attempt = 0; attempt < 80 && !didExit; attempt++) {
    try { ready = (await fetch(transport, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* bounded startup */ }
    if (ready) break;
    await new Promise(done => setTimeout(done, 250));
  }
  assert(ready, `Built product guide unavailable: ${output}`);

  // Raw HTML is useful to crawlers without hydration. The price page must expose
  // the actual configured checkout examples, not a hard-coded universal free offer.
  const setupRoutes = ["/get-started", "/download", "/integrations"];
  for (const path of ["/", "/pricing", "/about", "/privacy", "/terms", ...setupRoutes]) {
    const response = await fetch(transport + path); assert.equal(response.status, 200, path);
    const html = await response.text();
    assert(html.includes(SUPPORT_EMAIL), `${path} has public support contact`);
    if (path === "/pricing" || path === "/about" || setupRoutes.includes(path)) {
      const canonical = html.match(/<link rel="canonical" href="([^"]+)"/u)?.[1];
      assert(canonical && new URL(canonical).pathname === path, `${path} has own canonical`);
      assert(!html.includes('content="noindex'), `${path} is indexable`);
    }
    if (path === "/") {
      assert(html.includes(copy("product.heroTitle")));
      assert(!html.includes(copy("product.overviewTitle")), "Homepage omits the detailed overview");
      assert(html.includes(copy("product.stepsTitle")) && html.includes(copy("product.faqWallet")));
      assert(!html.includes('"price":"0"'), "No unqualified free SoftwareApplication offer");
    }
  }
  const llms = await (await fetch(transport + "/llms.txt")).text();
  assert(llms.includes("Arc mainnet") && llms.includes(SUPPORT_EMAIL));
  assert(llms.includes("/pricing") && llms.includes("/about"));
  const sitemap = await (await fetch(transport + "/sitemap.xml")).text();
  assert(sitemap.includes("/pricing</loc>") && sitemap.includes("/about</loc>"));
  for (const path of setupRoutes) {
    assert(llms.includes(path) && sitemap.includes(`${path}</loc>`), `${path} is discoverable`);
  }

  const forbidden: string[] = [];
  for (const width of [320, 390, 1024, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
    try {
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith("/api/")) {
          if (url.pathname === "/api/ask/visibility") {
            assert.equal(request.method(), "GET", "Visibility context is read-only");
            return route.fulfill({ status: 503, json: { error: "Read-only product fixture" } });
          }
          if (/\/api\/(?:ask(?:\/|$)|agent\/ask|research\/.*checkout|source\/|cite\/)/u.test(url.pathname)) forbidden.push(url.pathname);
          return route.fulfill({ status: 503, json: { error: "Read-only product fixture" } });
        }
        assert.equal(request.method(), "GET", "Informational pages make no product writes");
        // Visit the built loopback server directly. Native browser loads avoid
        // an APIResponse proxy whose lifetime can outlast a Next prefetch route.
        return route.continue();
      });
      // Raw browser JavaScript avoids tsx's keepNames helper in a serialized callback.
      await context.addInitScript(`
        const copied = [];
        Object.defineProperty(window, "setupCopies", { value: copied });
        Object.defineProperty(navigator, "clipboard", { value: { writeText: async value => {
          if (window.rejectSetupCopy) throw Error("Synthetic clipboard refusal");
          copied.push(value);
        } } });
      `);
      const page = await context.newPage();
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      for (const path of ["/", "/pricing", "/about", ...setupRoutes]) {
        await page.goto(origin + path); await page.locator("h1").waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `${path} fits ${width}px`);
        assert.equal(await page.locator("h1").count(), 1);
        if (path === "/pricing") {
          const rows = page.locator("tbody tr"); assert.equal(await rows.count(), 2);
          for (const [index, mode] of (["quick", "deep"] as const).entries()) {
            const quote = quoteA2aResearch(config.defaultBudget, mode);
            const expected = [quote.serviceFeeUsdc, quote.creatorBudgetUsdc, quote.totalPriceUsdc]
              .map(value => formatRecordedAmount(value, { minimumFractionDigits: 6 }));
            assert.deepEqual(await rows.nth(index).locator("td").allTextContents(), expected);
          }
          assert.equal(await page.getByRole("link", { name: copy("pricing.checkout") }).first().getAttribute("href"), "/research#paid-research");
        }
        if (path === "/about") assert.equal(await page.getByRole("link", { name: SUPPORT_EMAIL, exact: true }).getAttribute("href"), SUPPORT_MAILTO);
        if (setupRoutes.includes(path)) {
          const guideNav = page.getByRole("navigation", { name: setupCopy.navigation.label, exact: true }).first();
          assert.equal(await guideNav.locator('[aria-current="page"]').getAttribute("href"), path);
          assert.equal(await page.getByRole("link", { name: setupCopy.common.support, exact: true }).getAttribute("href"), SUPPORT_MAILTO);
        }
        if (path === "/get-started") {
          for (const surface of setupCopy.surfaces) {
            const card = page.locator("article").filter({ has: page.getByRole("heading", { name: surface.title, exact: true }) });
            assert.equal(await card.getByRole("link").getAttribute("href"), surface.href);
          }
          const question = page.getByText(setupCopy.start.faq[0].question, { exact: true });
          await question.focus(); await page.keyboard.press("Enter");
          assert.equal(await question.evaluate(node => node.parentElement?.hasAttribute("open")), true);
          await page.getByRole("link", { name: setupCopy.surfaces[2].action, exact: true }).click();
          await page.waitForURL(origin + "/download#extension");
          await page.getByRole("heading", { name: setupCopy.download.extensionTitle }).waitFor();
          await page.goto(origin + path);
        }
        if (path === "/download") {
          assert.equal(await page.getByRole("link", { name: setupCopy.download.installer, exact: true }).getAttribute("href"), installationLinks.installer);
          assert.equal(await page.getByRole("link", { name: setupCopy.download.extensionDownload, exact: true }).getAttribute("href"), installationLinks.extensionSource);
          const storeUrl = "https://chromewebstore.google.com/detail/ofhhhbkpdemcngolfgkjkmkjdilhgjmd";
          assert.equal(installationLinks.extensionStore, storeUrl, "Only the verified public Store listing");
          assert.equal(await page.locator('a[href*="chromewebstore.google.com"]').count(), 1);
          assert.equal(await page.getByRole("link", { name: setupCopy.download.extensionStore, exact: true }).getAttribute("href"), storeUrl);
          const extensionLinks = await page.locator("#extension a").evaluateAll(anchors => anchors.map(anchor => anchor.getAttribute("href")));
          const zipIndex = extensionLinks.indexOf(installationLinks.extensionSource);
          assert(zipIndex >= 0 && extensionLinks.indexOf(storeUrl) > zipIndex, "Versioned ZIP remains the first install choice");
          assert((await page.locator("#extension").innerText()).includes("Load unpacked"));
        }
        if (path === "/integrations") {
          const copyModels = page.getByRole("button", { name: `${setupCopy.common.copy} ${setupCopy.integrations.apiReadOnly}`, exact: true });
          await copyModels.click();
          await page.waitForFunction(() => Reflect.get(window, "setupCopies")?.length === 1);
          assert.deepEqual(await page.evaluate(() => Reflect.get(window, "setupCopies")), [setupExamples.models]);
          await page.evaluate(() => Reflect.set(window, "rejectSetupCopy", true));
          await page.getByRole("button", { name: `${setupCopy.common.copy} ${setupCopy.integrations.apiExample}`, exact: true }).click();
          await page.getByRole("status").filter({ hasText: setupCopy.common.copyFailed }).waitFor();
          assert.deepEqual(await page.evaluate(() => Reflect.get(window, "setupCopies")), [setupExamples.models]);
          assert.equal(await page.getByRole("link", { name: setupCopy.integrations.remoteAction }).getAttribute("href"), "/integrations/mcp");
          for (const anchor of ["mcp", "api", "cli", "bots"]) {
            assert.equal(await page.locator(`#${anchor}`).count(), 1);
            assert.equal(await page.locator(`main nav a[href="#${anchor}"]`).count(), 1);
          }
          await page.locator('main nav a[href="#api"]').click();
          await page.waitForURL(origin + path + "#api");
        }
        if (path === "/") {
          const kicker = await page.getByTestId("hero-kicker").boundingBox();
          const guide = await page.getByTestId("hero-guide").boundingBox();
          assert(kicker && guide && kicker.x + kicker.width <= guide.x, "Hero label leaves space for the guide");
          if (screenshots) await page.screenshot({ path: join(screenshots, `home-viewport-${width}.png`) });
          const faq = page.getByText(copy("product.faqWallet"), { exact: true });
          await faq.focus(); await page.keyboard.press("Enter");
          assert.equal(await faq.evaluate(node => node.parentElement?.hasAttribute("open")), true, "FAQ works by keyboard");
        }
        if (screenshots) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: join(screenshots, `${path === "/" ? "home" : path.slice(1)}-${width}.png`), fullPage: true });
        }
      }
      if (width >= 1024) {
        assert.deepEqual(await page.locator("header nav").first().locator(":scope > a").evaluateAll(links => links.map(link => link.getAttribute("href"))), ["/", "/answers", "/sources", "/register"]);
        await page.locator("header nav").first().getByText("More tools", { exact: true }).click();
        assert.equal(await page.locator("header nav").getByRole("link", { name: setupCopy.navigation.start, exact: true }).isVisible(), true);
      }
      if (width < 1024) {
        await page.getByRole("button", { name: "Open menu" }).click();
        await page.locator("#mobile-site-menu").getByText("More tools", { exact: true }).click();
        await page.locator("#mobile-site-menu").getByRole("link", { name: copy("product.navigationPricing"), exact: true }).click();
        await page.waitForURL(origin + "/pricing");
        assert.equal(await page.locator("#mobile-site-menu").isVisible(), false, "New route hides the menu");
      }
      assert.deepEqual(errors, [], `No page errors at ${width}px`);
    } finally {
      // Wait for immediate interception handlers before closing the fixture.
      await context.unrouteAll({ behavior: "wait" });
      await context.close();
    }
  }
  assert.deepEqual(forbidden, [], "Product discovery never submits research or payment requests");
  console.log("PASS: built product/setup/download/integration routes, crawlability, seven surfaces, pinned downloads, clipboard success/refusal, keyboard FAQ and navigation at 320/390/1024/1366px; no research, signing or payment.");
} finally {
  await browser.close();
  if (child && !didExit) child.kill();
  if (stopped) await stopped;
  await rm(temporary, { recursive: true, force: true });
}

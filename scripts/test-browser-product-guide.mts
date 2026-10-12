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

const source = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "keryx-product-guide-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const screenshots = process.env.KERYX_PRODUCT_SCREENSHOT_DIR;
if (screenshots) await mkdir(screenshots, { recursive: true });
const listener = createServer();
listener.listen(0, "127.0.0.1"); await once(listener, "listening");
const address = listener.address(); assert(address && typeof address === "object");
await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
const transport = `http://127.0.0.1:${address.port}`, origin = "https://product-guide.test";
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
  for (const path of ["/", "/pricing", "/about", "/privacy", "/terms"]) {
    const response = await fetch(transport + path); assert.equal(response.status, 200, path);
    const html = await response.text();
    assert(html.includes(SUPPORT_EMAIL), `${path} has public support contact`);
    if (path === "/pricing" || path === "/about") {
      const canonical = html.match(/<link rel="canonical" href="([^"]+)"/u)?.[1];
      assert(canonical && new URL(canonical).pathname === path, `${path} has own canonical`);
      assert(!html.includes('content="noindex'), `${path} is indexable`);
    }
    if (path === "/") {
      assert(html.includes(copy("product.heroTitle")));
      assert(html.includes(copy("product.overviewTitle")));
      assert(!html.includes('"price":"0"'), "No unqualified free SoftwareApplication offer");
    }
  }
  const llms = await (await fetch(transport + "/llms.txt")).text();
  assert(llms.includes("Arc mainnet") && llms.includes(SUPPORT_EMAIL));
  assert(llms.includes("/pricing") && llms.includes("/about"));
  const sitemap = await (await fetch(transport + "/sitemap.xml")).text();
  assert(sitemap.includes("/pricing</loc>") && sitemap.includes("/about</loc>"));

  const forbidden: string[] = [];
  for (const width of [320, 390, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.startsWith("/api/")) {
        if (/\/api\/(?:ask(?:\/|$)|agent\/ask|research\/.*checkout|source\/|cite\/)/u.test(url.pathname)) forbidden.push(url.pathname);
        return route.fulfill({ status: 503, json: { error: "Read-only product fixture" } });
      }
      assert.equal(request.method(), "GET", "Informational pages make no product writes");
      return route.fulfill({ response: await route.fetch({ url: transport + url.pathname + url.search }) });
    });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    for (const path of ["/", "/pricing", "/about"]) {
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
      if (path === "/") {
        const faq = page.getByText(copy("product.faqWallet"), { exact: true });
        await faq.focus(); await page.keyboard.press("Enter");
        assert.equal(await faq.evaluate(node => node.parentElement?.hasAttribute("open")), true, "FAQ works by keyboard");
      }
      if (screenshots) await page.screenshot({ path: join(screenshots, `${path === "/" ? "home" : path.slice(1)}-${width}.png`), fullPage: true });
    }
    if (width < 1024) {
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.locator("#mobile-site-menu").getByRole("link", { name: copy("product.pricing") }).click();
      await page.waitForURL(origin + "/pricing");
      assert.equal(await page.locator("#mobile-site-menu").isVisible(), false, "New route hides the menu");
    }
    assert.deepEqual(errors, [], `No page errors at ${width}px`);
    await context.close();
  }
  assert.deepEqual(forbidden, [], "Product discovery never submits research or payment requests");
  console.log("PASS: built crawlable product/pricing/about/support, checkout-derived amounts, keyboard FAQ and navigation at 320/390/1366px; no research, signing or payment.");
} finally {
  await browser.close();
  if (child && !didExit) child.kill();
  if (stopped) await stopped;
  await rm(temporary, { recursive: true, force: true });
}

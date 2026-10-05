/** Real presentation components with synthetic records; every request is intercepted and read-only. */
import assert from "node:assert/strict";
import { build, type Plugin } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

const reference = { id: "public:fixture", name: "Public publisher fixture", url: "https://publisher.example/", rssUrl: "https://publisher.example/feed", description: "Retained public writing without payment authority.", tags: ["Engineering"], active: true, refreshedAt: "2026-10-05T00:00:00.000Z", items: Array.from({ length: 4 }, (_, index) => ({ id: `public-item:${String(index).repeat(64)}`, title: `Retained article ${index}`, summary: "Fixture excerpt", content: "Fixture content", link: `https://publisher.example/article-${index}`, publishedAt: `2026-10-0${index + 1}T00:00:00.000Z`, deliveryKind: "excerpt" })) };
const source = { id: "fixture-creator", name: "Unverified creator fixture", url: "https://creator.example/", description: "An unverified registered listing.", verified: false, tags: ["Engineering"], authors: [], walletAddress: `0x${"1".repeat(40)}`, fetchPrice: 0.01, createdAt: "2026-10-05T00:00:00.000Z" };
const directory = { registry: { status: "ready", entries: [{ source, totalEarnedUsdc: 0, citationCount: 0, claim: null, claimPolicyUnavailable: false, controlFresh: false }] }, publicReferences: { status: "ready", entries: [reference] }, earningsStatus: "ready" };
const metrics = { totalQueries: 28, totalPayments: 0, totalVolumeUsdc: 0, totalCreatorPayoutsUsdc: 0, creatorsEarning: 0, pendingPaymentConfirmations: 0, pendingPaymentVolumeUsdc: 0, failedPaymentAttempts: 0, failedPaymentVolumeUsdc: 0 };
const run = { id: "fixture-run", question: "How should a live SQLite database be backed up safely?", createdAt: "2026-10-05T00:00:00.000Z", totalSpent: 0, totalToCreators: 0, citationCount: 2 };
const chrome: Plugin = {
  name: "isolated-ledger-chrome",
  setup(build) {
    build.onResolve({ filter: /(?:^|\/)(?:site-header|site-footer)$/ }, args => ({ path: args.path, namespace: "fixture-chrome" }));
    build.onLoad({ filter: /.*/, namespace: "fixture-chrome" }, () => ({ contents: "import React from 'react'; export const SiteHeader=()=>null; export const SiteFooter=()=>null;", loader: "jsx", resolveDir: process.cwd() }));
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "fixture-link" }));
    build.onLoad({ filter: /.*/, namespace: "fixture-link" }, () => ({ contents: "import React from 'react'; export default function Link({children,...props}){return <a {...props}>{children}</a>}", loader: "jsx", resolveDir: process.cwd() }));
    build.onResolve({ filter: /^@\/lib\/db$/ }, () => ({ path: "db", namespace: "fixture-db" }));
    build.onLoad({ filter: /.*/, namespace: "fixture-db" }, () => ({ contents: "export const getDb=async()=>window.fixtureDb;", loader: "js" }));
    build.onResolve({ filter: /public-source-claim-service$/ }, () => ({ path: "claims", namespace: "fixture-claims" }));
    build.onLoad({ filter: /.*/, namespace: "fixture-claims" }, () => ({ contents: "export const sourceClaimPolicyForSource=async()=>null;", loader: "js" }));
  },
};
const css = (await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR ?? path.resolve(".artifacts/ledger-sources-ux");
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const network of ["arcTestnet", "arc"]) {
    const bundle = await build({ stdin: { contents: `
      import React from 'react';import{createRoot}from'react-dom/client';
      import{DashboardView}from'./components/keryx/dashboard-view';
      import{SourceDirectoryPreview}from'./components/keryx/source-directory-preview';
      import SourcesPage from './app/sources/page';
      const reference=${JSON.stringify(reference)}, source=${JSON.stringify(source)}, directory=${JSON.stringify(directory)};
      const mode=new URL(location.href).searchParams.get('mode');
      window.fixtureDb={listSources:async()=>{if(mode==='partial')throw Error('registry unavailable');return[source]},listPublicReferences:async()=>[reference],creatorLeaderboard:async()=>[],getSourceClaimForSource:async()=>null};
      const root=createRoot(document.getElementById('root'));
      if(location.pathname==='/sources')SourcesPage().then(page=>root.render(page));
      else root.render(<DashboardView sourcePreview={<SourceDirectoryPreview directory={directory}/>}/>);
    `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", plugins: [chrome], define: { "process.env": "{}", "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify(network), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined", "process.env.NODE_ENV": '"production"' } });
    for (const width of [320, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.clock.install();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      let mode = "zero";
      await page.route("**/*", async route => {
        assert.equal(route.request().method(), "GET", "No write or payment request is permitted");
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith("/api/")) {
          if (mode === "error" && pathname === "/api/metrics") return route.fulfill({ status: 503, json: { error: "unavailable" } });
          if (pathname === "/api/metrics") return route.fulfill({ json: mode === "malformed" ? { metrics: { totalQueries: 28 }, leaderboard: [] } : { metrics: { ...metrics, ...(mode === "pending" ? { pendingPaymentConfirmations: 1, pendingPaymentVolumeUsdc: 0.02, failedPaymentAttempts: 1, failedPaymentVolumeUsdc: 0.01 } : {}) }, leaderboard: [] } });
          if (pathname === "/api/runs") return route.fulfill({ json: [run] });
          if (pathname === "/api/payments") return route.fulfill({ json: { payments: mode === "pending" ? [{ id: "fixture-payment", sourceName: "Pending creator fixture", queryId: "fixture-run", sourceId: "fixture-creator", kind: "citation", payer: "buyer", payee: "creator", amountUsdc: 0.02, network: "eip155:5042002", authorizationId: "fixture-authorization", settled: false, settlementStatus: "pending", createdAt: "2026-10-05T00:00:00.000Z" }] : [] } });
          if (pathname === "/api/withdrawals") return route.fulfill({ json: { withdrawals: [] } });
          throw new Error(`Unexpected API ${pathname}`);
        }
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      });
      async function open(url: string) {
        await page.goto(`https://ledger.fixture${url}`);
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
      }
      await open("/dashboard");
      await page.getByRole("heading", { name: "No settled payments yet" }).waitFor().catch(async error => { console.error({ errors, text: await page.locator("body").innerText() }); throw error; });
      await page.getByText(run.question).waitFor();
      assert.equal(await page.getByText("No creator earnings yet.").count(), 0);
      assert.equal(await page.getByText("No cash-outs yet.").count(), 0);
      assert.equal(await page.getByText(/to creators/).count(), 0);
      await page.getByText("Unverified creator fixture", { exact: true }).waitFor();
      assert.equal(await page.locator('a[href="/answers"]').count(), 1);
      await page.getByText("Inspect recorded totals", { exact: true }).click();
      assert.equal(await page.locator("dd").first().textContent(), "0");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Dashboard overflow ${width}`);
      await page.screenshot({ path: path.join(screenshots, `ledger-${network}-${width}.png`), fullPage: true });

      mode = "error";
      await open("/dashboard");
      await page.getByText("Question total unavailable").waitFor();
      await page.getByText(run.question).waitFor();
      await page.getByRole("heading", { name: "Settlement records" }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "No settled payments yet" }).count(), 0);
      mode = "zero";
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await page.getByRole("heading", { name: "No settled payments yet" }).waitFor();
      mode = "error";
      // Retry against an error after an accepted read must retain visibly dated data.
      await page.clock.fastForward(10_100);
      await page.getByText(/Showing the last successful read from \d{2}\/\d{2}\/\d{4}, .* UTC/).waitFor();

      mode = "malformed";
      await open("/dashboard");
      await page.getByText("Question total unavailable").waitFor();
      assert.equal(await page.getByRole("heading", { name: "No settled payments yet" }).count(), 0);

      mode = "pending";
      await open("/dashboard");
      await page.getByRole("heading", { name: "Awaiting settlement proof" }).waitFor();
      await page.getByText(/failed and were not charged/).waitFor();
      await page.getByTitle("Pending creator fixture", { exact: true }).waitFor();
      await page.getByText("Inspect payment evidence", { exact: true }).click();
      await page.getByRole("columnheader", { name: "Flow" }).waitFor();
      await page.getByText("Authorization: fixture-authorization", { exact: true }).waitFor();
      assert.equal(await page.locator("tbody").getByText("Arc Testnet", { exact: true }).count(), 1,
        "A retained testnet record must keep its own network in either build profile");

      await open("/sources");
      await page.getByRole("heading", { name: "Sources to explore." }).waitFor();
      await page.getByText("Publisher control unverified", { exact: true }).waitFor();
      await page.getByText("Excerpt in feed").first().waitFor();
      await page.getByText("Show 1 more retained item", { exact: true }).click();
      await page.getByRole("link", { name: "Retained article 0 ↗" }).waitFor();
      assert.equal(await page.getByText(/registry is empty/).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Sources overflow ${width}`);
      await page.screenshot({ path: path.join(screenshots, `sources-${network}-${width}.png`), fullPage: true });
      await open("/sources?mode=partial");
      await page.getByText(/Creator listings are temporarily unavailable/).waitFor();
      await page.getByRole("heading", { name: "Public publisher fixture ↗" }).waitFor();
      assert.deepEqual(errors, [], `Browser errors at ${network}/${width}`);
      await page.close();
    }
  }
} finally { await browser.close(); }
console.log(`Ledger and source-library browser acceptance passed; screenshots: ${screenshots}`);

/** Real presentation components with synthetic records; every request is intercepted and read-only. */
import assert from "node:assert/strict";
import { build, type Plugin } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { PAPER_CATALOG } from "../lib/papers/catalog";
import { groupPaperWorks } from "../lib/papers/work-groups";

// This component harness also renders the async server page. Compute its Node-only
// bibliography helper in Node, as Next does, rather than polyfilling crypto in a browser.
const paperGroups = groupPaperWorks(PAPER_CATALOG);
const paperCatalogJson = JSON.stringify(PAPER_CATALOG);
const sourceSearchLabel = "Search titles, publishers, domains, authors or identifiers";

const reference = { id: "public:fixture", name: "Public publisher fixture", url: "https://publisher.example/", rssUrl: "https://publisher.example/feed", description: "Retained public writing without payment authority.", tags: ["Engineering"], active: true, refreshedAt: "2026-10-05T00:00:00.000Z", items: Array.from({ length: 4 }, (_, index) => ({ id: `public-item:${String(index).repeat(64)}`, title: `Retained article ${index}`, summary: "Fixture excerpt", content: "Fixture content", link: `https://publisher.example/article-${index}`, publishedAt: `2026-10-0${index + 1}T00:00:00.000Z`, deliveryKind: "excerpt" })) };
const source = { id: "fixture-creator", name: "Unverified creator fixture", url: "https://creator.example/", description: "An unverified registered listing.", verified: false, tags: ["Engineering"], authors: [], walletAddress: `0x${"1".repeat(40)}`, fetchPrice: 0.01, createdAt: "2026-10-05T00:00:00.000Z" };
const citedEntry = { url: "https://docs.publisher.example/service", title: "A previously cited service manual", publisher: "docs.publisher.example", runId: "fixture-run", citedAt: "2026-10-05T00:00:00.000Z", deliveryKind: "excerpt", truncated: true, retrievedAt: "2026-10-04T23:00:00.000Z", extraction: "html" };
const directory = { registry: { status: "ready", entries: [{ source, totalEarnedUsdc: 0, citationCount: 0, claim: null, claimPolicyUnavailable: false, controlFresh: false }] }, publicReferences: { status: "ready", entries: [reference] }, citedSources: { status: "ready", entries: [citedEntry], runCount: 28 }, earningsStatus: "ready" };
const metrics = { totalQueries: 28, recordedAccounts: 7, totalPayments: 0, totalVolumeUsdc: 0, totalCreatorPayoutsUsdc: 0, creatorsEarning: 0, pendingPaymentConfirmations: 0, pendingPaymentVolumeUsdc: 0, failedPaymentAttempts: 0, failedPaymentVolumeUsdc: 0 };
const run = { id: "fixture-run", question: "How should a live SQLite database be backed up safely?", answer: "Fixture answer [S1]", createdAt: "2026-10-05T00:00:00.000Z", totalSpent: 0, totalToCreators: 0, citationCount: 2, citations: [{ marker: "S1", sourceId: "public:web:fixture", sourceName: citedEntry.publisher, sourceKind: "public-reference", itemTitle: citedEntry.title, itemUrl: citedEntry.url, publicDeliveryKind: "excerpt", webProvenance: { retrievedAt: citedEntry.retrievedAt, truncated: true, extraction: "html" } }] };
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
    build.onResolve({ filter: /^@\/lib\/papers\/work-groups$/ }, () => ({ path: "paper-groups", namespace: "fixture-server-papers" }));
    build.onLoad({ filter: /.*/, namespace: "fixture-server-papers" }, () => ({ contents: `
      export function groupPaperWorks(records) {
        if (JSON.stringify(records) !== ${JSON.stringify(paperCatalogJson)}) throw Error('Unexpected server paper catalog');
        return ${JSON.stringify(paperGroups)};
      }`, loader: "js" }));
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
      const reference=${JSON.stringify(reference)}, source=${JSON.stringify(source)}, directory=${JSON.stringify(directory)}, run=${JSON.stringify(run)};
      const mode=new URL(location.href).searchParams.get('mode');
      window.fixtureDb={listSources:async()=>{if(mode==='partial')throw Error('registry unavailable');return mode==='history-only'?[]:[source]},listPublicReferences:async()=>mode==='history-only'?[]:[reference],listRecentQueries:async()=>{if(mode==='history-error')throw Error('history unavailable');return[run]},creatorLeaderboard:async()=>[],getSourceClaimForSource:async()=>null};
      const root=createRoot(document.getElementById('root'));
      if(location.pathname==='/sources'){
        window.fixtureRenderSources=params=>SourcesPage({searchParams:Promise.resolve(params)}).then(page=>root.render(page));
        window.fixtureRenderSources(Object.fromEntries(new URL(location.href).searchParams));
      }
      else root.render(<DashboardView sourcePreview={<SourceDirectoryPreview directory={directory}/>}/>);
    `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", plugins: [chrome], define: { "process.env": "{}", "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify(network), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined", "process.env.NODE_ENV": '"production"' } });
    for (const width of [320, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.clock.install();
      const errors: string[] = [];
      const paperRequests: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      let mode = "zero";
      await page.route("**/*", async route => {
        assert.equal(route.request().method(), "GET", "No write or payment request is permitted");
        const requested = new URL(route.request().url());
        assert.equal(requested.origin, "https://ledger.fixture", "No external provider or wallet requests");
        const pathname = requested.pathname;
        if (pathname === "/api/papers") paperRequests.push(requested.href);
        if (pathname.startsWith("/api/")) {
          if (mode === "error" && pathname === "/api/metrics") return route.fulfill({ status: 503, json: { error: "unavailable" } });
          if (pathname === "/api/metrics") return route.fulfill({ json: mode === "malformed" ? { metrics: { totalQueries: 28 }, leaderboard: [] } : { metrics: { ...metrics, ...(mode === "account-unavailable" ? { recordedAccounts: null } : mode === "account-malformed" ? { recordedAccounts: 1.5 } : mode === "account-zero" ? { recordedAccounts: 0 } : mode === "account-legacy" ? { recordedAccounts: undefined } : {}), ...(mode === "pending" ? { pendingPaymentConfirmations: 1, pendingPaymentVolumeUsdc: 0.02, failedPaymentAttempts: 1, failedPaymentVolumeUsdc: 0.01 } : {}) }, leaderboard: [] } });
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
      await page.getByText("7 recorded accounts", { exact: true }).waitFor();
      await page.getByText(/Each wallet is counted once/).waitFor();
      assert.equal(await page.getByText("No creator earnings yet.").count(), 0);
      assert.equal(await page.getByText("No cash-outs yet.").count(), 0);
      assert.equal(await page.getByText(/to creators/).count(), 0);
      await page.getByText("Unverified creator fixture", { exact: true }).waitFor();
      await page.getByRole("link", { name: citedEntry.title }).waitFor();
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

      for (const accountMode of ["account-unavailable", "account-malformed", "account-legacy", "account-zero"]) {
        mode = accountMode;
        await open("/dashboard");
        await page.getByText(accountMode === "account-zero" ? "0 recorded accounts" : "Account total unavailable", { exact: true }).waitFor();
        await page.getByText("28 recorded questions", { exact: true }).waitFor();
        await page.getByRole("heading", { name: "No settled payments yet" }).waitFor();
      }

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
      assert.equal(await page.locator("#research-papers article").count(), paperGroups.length);
      await page.getByText("Publisher control unverified", { exact: true }).waitFor();
      await page.getByText("Excerpt in feed").first().waitFor();
      await page.getByText("Show 1 more retained item", { exact: true }).click();
      await page.getByRole("link", { name: "Retained article 0 ↗" }).waitFor();
      assert.equal(await page.getByText(/registry is empty/).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Sources overflow ${width}`);
      await page.screenshot({ path: path.join(screenshots, `sources-${network}-${width}.png`), fullPage: true });
      await page.getByRole("heading", { name: "Find a source" }).waitFor();
      // Next query navigations retain the same route component. Exercise its existing root
      // instead of replacing the document so uncontrolled fields cannot keep stale filters.
      await page.evaluate(() => (window as unknown as { fixtureRenderSources: (params: object) => Promise<void> }).fixtureRenderSources({ q: "Stripe", topic: "payments", kind: "explore", sort: "name" }));
      await page.waitForFunction(() => (document.querySelector('select[name="topic"]') as HTMLSelectElement)?.value === "payments");
      assert.equal(await page.getByLabel("Collection", { exact: true }).inputValue(), "explore");
      assert.equal(await page.getByLabel("Sort", { exact: true }).inputValue(), "name");
      assert.equal(await page.getByLabel(sourceSearchLabel).inputValue(), "Stripe");
      await page.evaluate(() => (window as unknown as { fixtureRenderSources: (params: object) => Promise<void> }).fixtureRenderSources({ kind: "paper", author: "Jacob Devlin", year: "2019", doi: "10.18653/v1/n19-1423" }));
      await page.waitForFunction(() => (document.querySelector('input[name="author"]') as HTMLInputElement)?.value === "Jacob Devlin");
      assert.equal(await page.getByLabel("Publication year", { exact: true }).inputValue(), "2019");
      assert.equal(await page.getByLabel("Exact DOI", { exact: true }).inputValue(), "10.18653/v1/n19-1423");
      assert.equal(await page.locator("#research-papers article").count(), 1);
      assert.equal(await page.locator("#publisher-directory article").count(), 0);
      await page.evaluate(() => (window as unknown as { fixtureRenderSources: (params: object) => Promise<void> }).fixtureRenderSources({}));
      await page.waitForFunction(() => (document.querySelector('select[name="topic"]') as HTMLSelectElement)?.value === "all");
      assert.equal(await page.getByLabel("Collection", { exact: true }).inputValue(), "all");
      assert.equal(await page.getByLabel("Sort", { exact: true }).inputValue(), "default");
      assert.equal(await page.getByLabel(sourceSearchLabel).inputValue(), "");
      assert.equal(await page.getByLabel("Author", { exact: true }).inputValue(), "");
      assert.equal(await page.getByLabel("Publication year", { exact: true }).inputValue(), "");
      assert.equal(await page.getByLabel("Exact DOI", { exact: true }).inputValue(), "");
      assert.equal(await page.locator("#research-papers article").count(), paperGroups.length);
      await page.getByLabel(sourceSearchLabel).fill("postgresql.org");
      await page.getByLabel("Collection", { exact: true }).selectOption("explore");
      await page.getByLabel("Topic", { exact: true }).selectOption("data-infrastructure");
      await Promise.all([page.waitForURL(url => url.searchParams.get("q") === "postgresql.org"), page.getByRole("button", { name: "Find sources" }).click()]);
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.getByRole("heading", { name: "Publisher directory", exact: true }).waitFor();
      assert.equal(await page.locator("#publisher-directory article").count(), 1);
      await page.getByText("Publisher directory · unread link", { exact: true }).waitFor();
      assert.equal(await page.locator("#cited-sources article").count(), 0);
      const draft = new URL((await page.getByRole("link", { name: "Ask with this source" }).getAttribute("href"))!, "https://ledger.fixture");
      assert(draft.searchParams.get("q")?.includes("postgresql.org"));
      assert.equal(draft.searchParams.has("run"), false, "Source exploration must not auto-run a paid or provider request");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Filtered sources overflow ${width}`);
      await page.screenshot({ path: path.join(screenshots, `sources-filtered-${network}-${width}.png`), fullPage: true });
      await open("/sources?kind=feed&q=publisher%20Retained%20article%200");
      await page.getByRole("link", { name: "Retained article 0 ↗" }).waitFor();
      await page.getByText("Matching retained feed items · 1 of 4", { exact: true }).waitFor();
      assert.equal(await page.getByRole("link", { name: "Retained article 3 ↗" }).count(), 0);
      await open("/sources?q=no-such-publisher-fixture");
      await page.getByRole("heading", { name: "No sources match these filters" }).waitFor();
      assert.equal(await page.locator("article").count(), 0);
      const reset = page.getByRole("link", { name: "Clear filters", exact: true }).first();
      assert.equal(await reset.getAttribute("href"), "/sources#browse-sources");
      await open("/sources?mode=partial");
      await page.getByText(/Creator listings are temporarily unavailable/).waitFor();
      await page.getByRole("heading", { name: "Public publisher fixture ↗" }).waitFor();
      await open("/sources?mode=history-only");
      await page.getByRole("heading", { name: "Cited in past answers" }).waitFor();
      await page.getByRole("link", { name: citedEntry.title }).waitFor();
      await page.getByText("Excerpt recorded · Bounded extraction", { exact: true }).waitFor();
      assert.equal(await page.getByText("No creator listings are recorded yet.").count(), 0);
      assert.equal(await page.getByText("No public feed snapshots are retained yet.", { exact: false }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `History-only overflow ${width}`);
      await page.screenshot({ path: path.join(screenshots, `sources-history-${network}-${width}.png`), fullPage: true });
      await open("/sources?mode=history-error");
      await page.getByText(/Public citation history is temporarily unavailable/).waitFor();
      await page.getByRole("heading", { name: "Public publisher fixture ↗" }).waitFor();
      assert.deepEqual(paperRequests, [], "Browsing and filters must not start repository lookups");
      assert.deepEqual(errors, [], `Browser errors at ${network}/${width}`);
      await page.close();
    }
  }
} finally { await browser.close(); }
console.log(`Ledger and source-library browser acceptance passed; screenshots: ${screenshots}`);

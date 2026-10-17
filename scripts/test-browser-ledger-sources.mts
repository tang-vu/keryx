/** Real presentation components with synthetic records; every request is intercepted and read-only. */
import assert from "node:assert/strict";
import { build, type Plugin } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { PAPER_CATALOG } from "../lib/papers/catalog";
import { groupPaperWorks } from "../lib/papers/work-groups";
import type { SourceLeaderboard } from "../lib/sources/source-leaderboard";

const focusedLeaderboard = process.argv.slice(2).includes("--source-leaderboard-only");
const focusedProgressive = process.argv.slice(2).includes("--dashboard-progressive-only");
assert(process.argv.slice(2).every(arg => ["--source-leaderboard-only", "--dashboard-progressive-only"].includes(arg)), "Unknown ledger browser selection");

// This component harness also renders the async server page. Compute its Node-only
// bibliography helper in Node, as Next does, rather than polyfilling crypto in a browser.
const paperGroups = groupPaperWorks(PAPER_CATALOG);
const paperCatalogJson = JSON.stringify(PAPER_CATALOG);
const sourceSearchLabel = "Search titles, publishers, domains, authors or identifiers";

const reference = { id: "public:fixture", name: "Public publisher fixture", url: "https://publisher.example/", rssUrl: "https://publisher.example/feed", description: "Retained public writing without payment authority.", tags: ["Engineering"], active: true, refreshedAt: "2026-10-05T00:00:00.000Z", items: Array.from({ length: 4 }, (_, index) => ({ id: `public-item:${String(index).repeat(64)}`, title: `Retained article ${index}`, summary: "Fixture excerpt", content: "Fixture content", link: `https://publisher.example/article-${index}`, publishedAt: `2026-10-0${index + 1}T00:00:00.000Z`, deliveryKind: "excerpt" })) };
const source = { id: "fixture-creator", name: "Unverified creator fixture", url: "https://creator.example/", description: "An unverified registered listing.", verified: false, tags: ["Engineering"], authors: [], walletAddress: `0x${"1".repeat(40)}`, fetchPrice: 0.01, createdAt: "2026-10-05T00:00:00.000Z" };
const citedEntry = { url: "https://docs.publisher.example/service", title: "A previously cited service manual", publisher: "docs.publisher.example", runId: "fixture-run", citedAt: "2026-10-05T00:00:00.000Z", deliveryKind: "excerpt", truncated: true, retrievedAt: "2026-10-04T23:00:00.000Z", extraction: "html" };
const directory = { registry: { status: "ready", entries: [{ source, totalEarnedUsdc: 0, citationCount: 0, claim: null, claimPolicyUnavailable: false, controlFresh: false }] }, publicReferences: { status: "ready", entries: [reference] }, citedSources: { status: "ready", entries: [citedEntry], runCount: 28 }, earningsStatus: "ready" };
const metrics = { totalQueries: 28, recordedAccounts: 7, guestQuestions: 12, totalPayments: 0, totalVolumeUsdc: 0, totalCreatorPayoutsUsdc: 0, creatorsEarning: 0, pendingPaymentConfirmations: 0, pendingPaymentVolumeUsdc: 0, failedPaymentAttempts: 0, failedPaymentVolumeUsdc: 0 };
// Exercise the actual populated card: empty/legacy metrics never mount it.
const sourceLeaderboard: SourceLeaderboard = {
  catalogStatus: "ready", operatingFeesStatus: "ready", operatingFeeNetwork: "eip155:5042002",
  rows: [
    { sourceId: `creator:${"long-source-identifier-".repeat(8)}`, sourceName: "Independent creator documentation and research notes for distributed systems ".repeat(4), kind: "creator" as const },
    { sourceId: `public:${"publisher-identifier-".repeat(8)}`, sourceName: `PublisherDocumentation${"UnbrokenSourceLabel".repeat(16)}`, kind: "public-reference" as const },
    { sourceId: `paper:10.1234/${"retained-paper-identifier-".repeat(8)}`, sourceName: "A long paper title about source attribution, reproducible evidence and ledger presentation ".repeat(3), kind: "paper" as const },
  ].map((row, index) => ({
    ...row, href: `/sources?q=${encodeURIComponent(row.sourceId)}`,
    walletAddress: index === 0 ? `0x${"a".repeat(40)}` : undefined,
    creatorEarnedUsdc: 0, paymentCount: 0, citationCount: 0,
    operatingFeeUsdc: 0, operatingFeePaymentCount: 0, operatingFeeCitationCount: 0, feeBeneficiaries: [],
  })),
};
const archivedCreators = Array.from({ length: 7 }, (_, index) => ({
  sourceId: `historical-source-${index}`, sourceName: `Original testnet publisher ${index}`,
  walletAddress: `0x${String(index + 1).repeat(40)}`, totalEarnedMicroUsdc: (7 - index) * 100001,
  paymentCount: 3 + index, citationCount: index + 1,
}));
const archiveInfo = { network: "eip155:5042002", label: "Arc testnet", capturedAt: "2026-10-03T00:26:18.665Z", sourceCommit: "a".repeat(40), databaseSha256: "b".repeat(64) };
const archiveSummary = { totalQueryRuns: 100, earliestQueryAt: "2026-06-15T00:00:00.000Z", latestQueryAt: "2026-10-02T00:00:00.000Z", walletAttributedQueryRuns: 10, settledCreatorCount: 7, settledCreatorPaymentCount: 42, settledCreatorMicroUsdc: 2800028,
  payments: { settled: { count: 45, amountMicroUsdc: 2900028 }, pending: { count: 1, amountMicroUsdc: 2000 }, failed: { count: 0, amountMicroUsdc: 0 }, simulated: { count: 0, amountMicroUsdc: 0 } },
  paymentKinds: [{ kind: "inbound", count: 3, settledMicroUsdc: 100000 }], origins: [{ origin: "engine", count: 80 }, { origin: "web", count: 20 }] };
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
      import{TestnetHistorySummary}from'./components/keryx/testnet-history-view';
      import SourcesPage from './app/sources/page';
      const reference=${JSON.stringify(reference)}, source=${JSON.stringify(source)}, directory=${JSON.stringify(directory)}, run=${JSON.stringify(run)};
      const mode=new URL(location.href).searchParams.get('mode');
      window.fixtureDb={listSources:async()=>{if(mode==='partial')throw Error('registry unavailable');return mode==='history-only'?[]:[source]},listPublicReferences:async()=>mode==='history-only'?[]:[reference],listRecentQueries:async()=>{if(mode==='history-error')throw Error('history unavailable');return[run]},creatorLeaderboard:async()=>[],getSourceClaimForSource:async()=>null};
      const root=createRoot(document.getElementById('root'));
      if(location.pathname==='/sources'){
        window.fixtureRenderSources=params=>SourcesPage({searchParams:Promise.resolve(params)}).then(page=>root.render(page));
        window.fixtureRenderSources(Object.fromEntries(new URL(location.href).searchParams));
      }
      else root.render(<DashboardView historyPreview={mode==='archive'?<TestnetHistorySummary info={${JSON.stringify(archiveInfo)}} summary={${JSON.stringify(archiveSummary)}} creators={${JSON.stringify(archivedCreators)}}/>:mode==='progressive'?<div style={{height:1600}} aria-label="Retained history fixture"/>:undefined} sourcePreview={<SourceDirectoryPreview directory={directory}/>}/>);
    `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", plugins: [chrome], define: { "process.env": "{}", "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify(network), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined", "process.env.NODE_ENV": '"production"' } });
    for (const width of focusedLeaderboard || focusedProgressive ? [390, 1440] : [320, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.clock.install();
      const errors: string[] = [];
      const paperRequests: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      let mode = "zero";
      let metricRequests = 0;
      let releaseMetrics: (() => void) | undefined;
      let releasePublicCount: (() => void) | undefined;
      let releaseRecent: (() => void) | undefined;
      const apiRequests: string[] = [];
      const guestModes: Record<string, unknown> = {
        "guest-unavailable": null, "guest-legacy": undefined, "guest-fraction": 1.5,
        "guest-negative": -1, "guest-string": "12", "guest-excess": 29, "guest-zero": 0,
      };
      await page.route("**/*", async route => {
        assert.equal(route.request().method(), "GET", "No write or payment request is permitted");
        const requested = new URL(route.request().url());
        assert.equal(requested.origin, "https://ledger.fixture", "No external provider or wallet requests");
        const pathname = requested.pathname;
        if (pathname === "/api/papers") paperRequests.push(requested.href);
        if (pathname.startsWith("/api/")) {
          apiRequests.push(pathname);
          if (pathname === "/api/metrics") {
            metricRequests++;
            if (mode === "retry-pending") await new Promise<void>(resolve => { releaseMetrics = resolve; });
          }
          if (mode === "error" && pathname === "/api/metrics") return route.fulfill({ status: 503, json: { error: "unavailable" } });
          if (pathname === "/api/metrics") return route.fulfill({ json: mode === "malformed" ? { metrics: { totalQueries: 28 }, leaderboard: [] } : { metrics: { ...metrics, ...(mode === "account-unavailable" ? { recordedAccounts: null } : mode === "account-malformed" ? { recordedAccounts: 1.5 } : mode === "account-zero" ? { recordedAccounts: 0 } : mode === "account-legacy" ? { recordedAccounts: undefined } : {}), ...(Object.hasOwn(guestModes, mode) ? { guestQuestions: guestModes[mode] } : {}), ...(mode === "pending" ? { pendingPaymentConfirmations: 1, pendingPaymentVolumeUsdc: 0.02, failedPaymentAttempts: 1, failedPaymentVolumeUsdc: 0.01 } : {}) }, leaderboard: [], ...(mode === "source-leaderboard" ? { sourceLeaderboard: { ...sourceLeaderboard, operatingFeeNetwork: network === "arc" ? "eip155:5042" : "eip155:5042002" } } : {}) } });
          if (pathname === "/api/runs/summary") {
            if (mode === "progressive") await new Promise<void>(resolve => { releasePublicCount = resolve; });
            assert.equal(requested.searchParams.get("network"), network === "arc" ? "eip155:5042" : "eip155:5042002");
            assert.equal(requested.searchParams.get("period"), "all");
            if (mode === "count-unavailable") return route.fulfill({ status: 503, json: { error: "unavailable" } });
            return route.fulfill({ json: { complete: true, network: requested.searchParams.get("network"), period: "all", cohort: "default", publicQuestions: mode === "empty-history" ? 0 : 18 } });
          }
          if (pathname === "/api/runs") {
            if (mode === "recent-pending") await new Promise<void>(resolve => { releaseRecent = resolve; });
            assert.equal(requested.searchParams.get("network"), network === "arc" ? "eip155:5042" : "eip155:5042002");
            assert.equal(requested.searchParams.get("period"), "all");
            assert.equal(requested.searchParams.has("archive"), false);
            if (mode === "history-unavailable") return route.fulfill({ status: 503, json: { error: "unavailable" } });
            return route.fulfill({ json: mode === "empty-history" ? [] : mode === "archive" ? [run, { ...run, id: "old-testnet-run", question: "Archived testnet question stays in history", archive: archiveInfo }] : [run] });
          }
          if (pathname === "/api/payments") return route.fulfill({ json: { payments: mode === "pending" ? [{ id: "fixture-payment", sourceName: "Pending creator fixture", queryId: "fixture-run", sourceId: "fixture-creator", kind: "citation", payer: "buyer", payee: "creator", amountUsdc: 0.02, network: "eip155:5042002", authorizationId: "fixture-authorization", settled: false, settlementStatus: "pending", createdAt: "2026-10-05T00:00:00.000Z" }] : [] } });
          if (pathname === "/api/withdrawals") return route.fulfill({ json: { withdrawals: [] } });
          throw new Error(`Unexpected API ${pathname}`);
        }
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      });
      async function open(url: string, activateBelowFold = true) {
        await page.goto(`https://ledger.fixture${url}`);
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        if (url.startsWith("/dashboard") && activateBelowFold) {
          await page.locator("#payment-records").scrollIntoViewIfNeeded();
          await page.locator("#current-creators").scrollIntoViewIfNeeded();
          await page.locator("#current-activity").scrollIntoViewIfNeeded();
        }
      }
      if (!focusedLeaderboard && (width === 390 || width === 1440)) {
        mode = "progressive";
        await open("/dashboard?mode=progressive", false);
        await page.getByText(run.question, { exact: true }).waitFor();
        await page.getByText("Recent public questions", { exact: true }).waitFor();
        await page.getByText("Loading Public question count…", { exact: true }).waitFor();
        assert.deepEqual([...apiRequests].sort(), ["/api/runs", "/api/runs/summary"], "Initial reads prioritize current questions; offscreen financial sections wait");
        assert(releasePublicCount, "Count is still pending while recent questions render");
        // Direct creator navigation must request its leaderboard even if the
        // earlier recorded-totals marker has never approached the viewport.
        await page.locator("#current-creators").evaluate(element => element.scrollIntoView({ block: "start" }));
        await page.getByText("28 recorded questions", { exact: true }).waitFor();
        await page.locator("#payment-records").scrollIntoViewIfNeeded();
        await page.locator("#current-creators").scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelector("#payment-records")?.textContent?.includes("Loading Payment records") === false);
        assert(apiRequests.includes("/api/payments") && apiRequests.includes("/api/withdrawals"), "Scrolling starts each independent financial read");
        releasePublicCount();
        await page.getByText(`18 public questions on ${network === "arc" ? "Arc mainnet" : "Arc Testnet"}`, { exact: true }).waitFor();
        await page.locator("#current-activity").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(screenshots, `ledger-progressive-${network}-${width}.png`), fullPage: true });

        mode = "recent-pending";
        await open("/dashboard");
        await page.getByText(`18 public questions on ${network === "arc" ? "Arc mainnet" : "Arc Testnet"}`, { exact: true }).waitFor();
        await page.getByText("Recent public questions", { exact: true }).waitFor();
        assert.equal(await page.getByText("No public questions to display.", { exact: true }).count(), 0, "Pending questions are not an empty population");
        assert(releaseRecent, "Recent questions can still be pending after the count renders");
        releaseRecent();
        await page.getByText(run.question, { exact: true }).waitFor();
        assert.deepEqual(errors, []);
        console.log(`Progressive independent dashboard passed ${network}/${width}`);
        mode = "zero";
        if (focusedProgressive) { await page.close(); continue; }
      }
      if (width === 390 || width === 1440) {
        mode = "source-leaderboard";
        await open("/dashboard");
        const card = page.locator("#current-creators > .grid > div").first();
        const rows = card.locator("[data-source-id]");
        await rows.last().waitFor();
        assert.equal(await rows.count(), sourceLeaderboard.rows.length, "Keep every populated source row");
        for (const [index, row] of sourceLeaderboard.rows.entries()) {
          assert.equal(await rows.nth(index).getByRole("link").textContent(), row.sourceName, "Retain the full source label");
          assert.equal(await rows.nth(index).getAttribute("data-source-id"), row.sourceId);
          await rows.nth(index).getByText(/Creator rewards/).waitFor();
          await rows.nth(index).getByText(/Owner fee/).waitFor();
        }
        const bounds = await card.evaluate(element => {
          const [rect] = [(node: Element) => {
            const box = node.getBoundingClientRect();
            return { left: box.left, right: box.right, width: box.width, height: box.height, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
          }];
          return {
            viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
            bodyOverflowX: getComputedStyle(document.body).overflowX,
            main: rect(document.querySelector("main")!), card: rect(element),
            gridColumns: getComputedStyle(element.parentElement!).gridTemplateColumns,
            search: rect(element.querySelector("input")!),
            rows: Array.from(element.querySelectorAll("[data-source-id]")).map(row => ({
              ...rect(row), link: rect(row.querySelector("a")!),
              textOverflow: getComputedStyle(row.querySelector("a")!).textOverflow,
              fontSize: getComputedStyle(row.querySelector("a")!).fontSize,
            })),
          };
        });
        const artifact = path.join(screenshots, `ledger-populated-sources-${network}-${width}`);
        await writeFile(`${artifact}.json`, JSON.stringify(bounds, null, 2) + "\n");
        await page.screenshot({ path: `${artifact}.png`, fullPage: true });
        assert.equal(bounds.documentWidth, width, `Populated source leaderboard overflows ${network}/${width}: ${JSON.stringify(bounds)}`);
        assert(!["hidden", "clip"].includes(bounds.bodyOverflowX), "Do not conceal page overflow");
        assert(bounds.card.left >= bounds.main.left && bounds.card.right <= bounds.main.right + 1, "Card must fit the dashboard");
        assert(bounds.card.width >= 280 && bounds.card.scrollWidth <= bounds.card.clientWidth + 1, "Card must remain readable without horizontal scrolling");
        assert(bounds.search.width >= 200 && bounds.search.right <= bounds.card.right, "Search must fit and remain usable");
        for (const row of bounds.rows) {
          assert(row.width >= 200 && row.scrollWidth <= row.clientWidth + 1, "Row metadata must fit without clipping");
          assert(row.link.width >= 200 && row.link.height >= 18 && row.link.right <= bounds.card.right, "Source link must remain readable and clickable");
          assert.equal(row.textOverflow, "ellipsis", "Keep established source-title truncation");
          assert(parseFloat(row.fontSize) >= 15, "Do not shrink source text to force a fit");
        }
        const search = card.getByRole("textbox", { name: "Search leaderboard sources" });
        // A suffix beyond the visible title and the full identifier remain searchable.
        for (const query of ["research notes for distributed systems", sourceLeaderboard.rows[0].sourceId, `0x${"a".repeat(40)}`]) {
          await search.fill(query);
          assert.equal(await rows.count(), 1);
          assert.equal(await rows.first().getAttribute("data-source-id"), sourceLeaderboard.rows[0].sourceId);
        }
        await search.fill("no-matching-leaderboard-source");
        await card.getByText("No matching sources.", { exact: true }).waitFor();
        assert.equal(await rows.count(), 0);
        await search.fill("");
        assert.equal(await rows.count(), sourceLeaderboard.rows.length);
        const sourceLink = rows.first().getByRole("link");
        assert.equal(await sourceLink.getAttribute("href"), sourceLeaderboard.rows[0].href);
        await Promise.all([
          page.waitForURL(url => url.pathname === "/sources" && url.searchParams.get("q") === sourceLeaderboard.rows[0].sourceId),
          sourceLink.click(),
        ]);
        assert.deepEqual(errors, [], `Populated leaderboard browser errors at ${network}/${width}`);
        assert.deepEqual(paperRequests, [], "Leaderboard search must not start repository lookups");
        console.log(`Populated source leaderboard passed ${network}/${width}`);
        mode = "zero";
      }
      if (focusedLeaderboard || width === 390) { await page.close(); continue; }
      await open("/dashboard");
      await page.getByRole("heading", { name: "No settled payments yet" }).waitFor().catch(async error => { console.error({ errors, text: await page.locator("body").innerText() }); throw error; });
      await page.getByText(run.question).waitFor();
      await page.getByText("7 recorded accounts", { exact: true }).waitFor();
      await page.getByText("12 guest questions", { exact: true }).waitFor();
      await page.getByText(/This counts questions, not visits or unique people/).waitFor();
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

      mode = "empty-history";
      await open("/dashboard");
      await page.getByText("28 recorded questions", { exact: true }).waitFor();
      await page.getByText("Recent public questions", { exact: true }).waitFor();
      await page.getByText("No public questions to display.", { exact: true }).waitFor();
      await page.getByText(/Recorded totals cover all saved activity in this database/).waitFor();
      await page.getByText(`0 public questions on ${network === "arc" ? "Arc mainnet" : "Arc Testnet"}`, { exact: true }).waitFor();
      assert.equal(await page.getByText("No dispatches yet.", { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Empty public history overflow ${width}`);
      await page.screenshot({ path: path.join(screenshots, `ledger-empty-public-${network}-${width}.png`), fullPage: true });

      mode = "history-unavailable";
      await open("/dashboard");
      await page.getByText(/Question records unavailable/).waitFor();
      assert.equal(await page.getByText("No public questions to display.", { exact: true }).count(), 0);

      mode = "count-unavailable";
      await open("/dashboard");
      await page.getByText(/Public question count unavailable/).waitFor();
      assert.equal(await page.getByText(/^0 public questions on /).count(), 0);
      await page.getByText(run.question).waitFor();

      mode = "error";
      await open("/dashboard");
      await page.getByText("Question total unavailable", { exact: true }).waitFor();
      await page.getByText("Guest question total unavailable", { exact: true }).waitFor();
      await page.getByText(run.question).waitFor();
      await page.getByRole("heading", { name: "Settlement records" }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "No settled payments yet" }).count(), 0);
      const beforeRetry = metricRequests;
      mode = "retry-pending";
      await Promise.all([
        page.waitForRequest(request => new URL(request.url()).pathname === "/api/metrics"),
        page.getByRole("button", { name: "Retry", exact: true }).click(),
      ]);
      const retrying = page.getByRole("button", { name: "Loading Settlement totals…", exact: true });
      await retrying.waitFor();
      assert.equal(await retrying.isDisabled(), true, "Retry visibly waits for the pending request");
      await page.clock.fastForward(10_100);
      assert.equal(metricRequests, beforeRetry + 1, "Do not overlap polling and a pending manual retry");
      assert(releaseMetrics, "Manual retry reached the metrics API");
      await page.screenshot({ path: path.join(screenshots, `ledger-retry-pending-${network}-${width}.png`), fullPage: true });
      mode = "zero";
      releaseMetrics();
      await page.getByRole("heading", { name: "No settled payments yet" }).waitFor();
      mode = "error";
      // Retry against an error after an accepted read must retain visibly dated data.
      await page.clock.fastForward(60_100);
      await page.getByText(/Showing the last successful read from [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}:\d{2}\s[AP]M UTC\./).waitFor();
      await page.getByText("12 guest questions · last successful read", { exact: true }).waitFor();
      mode = "retry-pending";
      releaseMetrics = undefined;
      await Promise.all([
        page.waitForRequest(request => new URL(request.url()).pathname === "/api/metrics"),
        page.getByRole("button", { name: "Retry", exact: true }).click(),
      ]);
      await retrying.waitFor();
      await page.getByText("12 guest questions · last successful read", { exact: true }).waitFor();
      assert.equal(await page.getByText(/Showing the last successful read from/).count(), 1);
      assert(releaseMetrics);
      mode = "error";
      releaseMetrics();
      await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
      mode = "zero";
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await page.getByRole("heading", { name: "No settled payments yet" }).waitFor();

      mode = "malformed";
      await open("/dashboard");
      await page.getByText("Question total unavailable", { exact: true }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "No settled payments yet" }).count(), 0);

      for (const accountMode of ["account-unavailable", "account-malformed", "account-legacy", "account-zero"]) {
        mode = accountMode;
        await open("/dashboard");
        await page.getByText(accountMode === "account-zero" ? "0 recorded accounts" : "Account total unavailable", { exact: true }).waitFor();
        await page.getByText("28 recorded questions", { exact: true }).waitFor();
        await page.getByRole("heading", { name: "No settled payments yet" }).waitFor();
      }

      for (const guestMode of Object.keys(guestModes)) {
        mode = guestMode;
        await open("/dashboard");
        await page.getByText(guestMode === "guest-zero" ? "0 guest questions" : "Guest question total unavailable", { exact: true }).waitFor();
        await page.getByText("28 recorded questions", { exact: true }).waitFor();
        await page.getByText("7 recorded accounts", { exact: true }).waitFor();
        await page.getByRole("heading", { name: "No settled payments yet" }).waitFor();
      }

      mode = "pending";
      await open("/dashboard");
      await page.getByRole("heading", { name: "Awaiting settlement proof" }).waitFor();
      await page.getByText(/failed and were not charged/).waitFor();
      await page.getByText("Inspect payment evidence", { exact: true }).click();
      await page.getByRole("cell").filter({ hasText: "Pending creator fixture" }).waitFor();
      await page.getByRole("columnheader", { name: "Flow" }).waitFor();
      await page.getByText("Authorization: fixture-authorization", { exact: true }).waitFor();
      assert.equal(await page.locator("tbody").getByText("Arc Testnet", { exact: true }).count(), 1,
        "A retained testnet record must keep its own network in either build profile");

      mode = "archive";
      await open("/dashboard?mode=archive");
      const history = page.locator("#testnet-history");
      await history.getByRole("heading", { name: "Testnet creator leaderboard" }).waitFor();
      await history.getByText("2.800028 test USDC", { exact: true }).waitFor();
      await page.getByText("28 recorded questions", { exact: true }).waitFor();
      assert.equal(await page.getByText("Archived testnet question stays in history", { exact: true }).count(), 0, "Current activity does not mix archived questions");
      assert.equal(await page.evaluate(() => Boolean(document.querySelector("#testnet-history")!.compareDocumentPosition(document.querySelector("#current-activity")!) & Node.DOCUMENT_POSITION_FOLLOWING)), true, "Testnet track record precedes current activity");
      assert.equal(await history.getByText("Original testnet publisher 6", { exact: true }).isVisible(), false);
      await history.getByText("Show all 7 source / wallet entries", { exact: true }).click();
      await history.getByText("Original testnet publisher 6", { exact: true }).waitFor();
      assert.equal(await history.locator('a[href^="/creator/"]').count(), 0, "Historical identities must not open current creator authority");
      assert.equal(await history.locator('a[href^="https://testnet.arcscan.app/address/"]').count(), 7);
      await history.getByText("Inspect archived totals and channels", { exact: true }).click();
      await history.getByText(/^pending payment records$/i).waitFor();
      await history.getByText("engine questions", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Historical leaderboard overflow ${width}`);
      await page.screenshot({ path: path.join(screenshots, `ledger-history-${network}-${width}.png`), fullPage: true });

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
console.log(`${focusedLeaderboard ? "Populated source-leaderboard" : "Ledger and source-library"} browser acceptance passed; screenshots: ${screenshots}`);

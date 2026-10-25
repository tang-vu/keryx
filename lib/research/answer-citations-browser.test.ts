import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "playwright";
import type { QueryRun } from "../types";

let browser: Browser, css: string, bundle: string;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
const citations: QueryRun["citations"] = [
  { marker: "S1", sourceId: "creator", sourceName: "Quay Methods", itemId: "replication", itemTitle: "Independent replication notes", itemUrl: "https://creator.example/replication", contentVersion: "recorded-creator-v2", itemPublishedAt: "2026-10-05T00:00:00Z", weight: .5, reward: .000001, rationale: "Recorded allocation" },
  { marker: "S2", sourceId: "public", sourceName: "Public Research Handbook", itemId: "methods", itemTitle: "Methods, uncertainty and limits", itemUrl: "https://public.example/methods", contentVersion: "recorded-public-v1", sourceKind: "public-reference", weight: .3, reward: 0, rationale: "Public read",
    webProvenance: { retrievedAt: "2026-10-05T00:00:00Z", publisherGroup: "public.example", normalizedBodyHash: "b".repeat(64), extraction: "html", truncated: true },
    scholarly: { provider: "crossref", recordUrl: "https://api.crossref.org/works/10.1234%2Fmethods", retrievedAt: "2026-10-05T00:00:00Z", title: "Methods, uncertainty and limits", authors: ["Ada Lovelace", "Research Group"], doi: "10.1234/methods", workType: "journal-article", peerReview: "unknown", evidenceScope: "publisher-page" } },
  { marker: "S3", sourceId: "synthetic", sourceName: "Illustrative fixture", itemId: "example", itemTitle: "Illustrative measurements", itemUrl: "https://demo.example/example", contentVersion: "synthetic-v1", evidenceProvenance: "synthetic-demo", weight: .15, reward: 0, rationale: "Illustrative record" },
  { marker: "S4", sourceId: "legacy", sourceName: "Legacy archive", itemId: "legacy", itemTitle: "Literal <img data-citation-injection> archive title", itemUrl: "javascript:alert('fixture')", contentVersion: "legacy-v1", weight: .05, reward: 0, rationale: "Retained record" },
];
const run: QueryRun = { id: "citation-reading-fixture", question: "A synthetic local reading fixture", answer: "Inspect the independently recorded sources and their limits. [S1] [S2]",
  budget: .01, citations, subClaims: [], decisions: [], trace: [], engine: "fixture", createdAt: "2026-10-05T00:00:00Z",
  totalSpent: .000001, totalToCreators: .000001, paymentMode: "offline", pendingPayments: 1,
  evidence: [
    { ...citations[0], claimIndex: 0, claim: "Replication limits", quote: "Exact recorded creator excerpt.", support: .8, qualifiesForAnswer: true, qualifiesForReward: true },
    { ...citations[0], contentVersion: "wrong-version", claimIndex: 0, claim: "Replication limits", quote: "Wrong version must not enter this inspector.", support: .8, qualifiesForAnswer: true, qualifiesForReward: true },
    { ...citations[2], claimIndex: 0, claim: "Illustrative measurement", quote: "Synthetic excerpt cannot become factual support.", support: .9, qualifiesForAnswer: true, qualifiesForReward: true },
  ] };
const fonts = `@font-face{font-family:CitationDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:CitationSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:CitationMono;src:url('/fonts/spline-sans-mono-latin.woff2')}
:root{--font-bodoni:CitationDisplay;--font-spectral:CitationSerif;--font-spline-mono:CitationMono}`;

beforeAll(async () => {
  const result = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AnswerCard}from'./components/keryx/answer-card';
    const original=${JSON.stringify(run)};const before=JSON.stringify(original);
    const fixture=window.citationFixture={unchanged:()=>JSON.stringify(original)===before};
    function App(){const[stress,setStress]=useState(false);fixture.stress=setStress;
      const value=stress?{...original,citations:original.citations.map((c,index)=>index?c:{...c,itemTitle:'Nghiên cứu 中文 '+ 'UnbrokenOriginalTitle'.repeat(18),sourceName:'PublisherIdentifier'.repeat(18)})}:original;
      return <AnswerCard run={value} meta={null} showFeedback={false}/>}
    createRoot(document.getElementById('root')).render(<App/>);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  const inputs = Object.keys(result.metafile!.inputs).map(path => path.replaceAll("\\", "/"));
  for (const entrypoint of ["components/keryx/answer-card.tsx", "components/keryx/citation-evidence-panel.tsx"])
    expect(inputs.some(path => path.endsWith(entrypoint))).toBe(true);
  expect(inputs.some(path => /(?:^|\/)node_modules\/(?:jsonwebtoken|jwa|jws)\//.test(path))).toBe(false);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function fixture(test: (page: Page) => Promise<void>, width = 390, reducedMotion: "reduce" | "no-preference" = "reduce") {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion });
  const errors: string[] = [], api: string[] = [];
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      expect(request.method()).toBe("GET"); expect(url.origin).toBe("https://citation-reading.test");
      if (url.pathname.startsWith("/api/")) api.push(url.pathname);
      if (url.pathname === "/reading.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      expect(url.pathname).toBe("/");
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/reading.css"></head><body><main id="root" style="max-width:1080px;margin:32px auto;padding:0 16px"></main></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://citation-reading.test/"); await page.addScriptTag({ content: bundle });
    await page.getByRole("button", { name: "Inspect evidence for citation S1", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.evaluate(() => document.getAnimations().some(animation => animation.playState === "running" && animation.effect?.getComputedTiming().iterations !== Infinity))).toBe(false);
    await test(page);
    expect(errors).toEqual([]); expect(api).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { citationFixture: { unchanged(): boolean } }).citationFixture.unchanged())).toBe(true);
  } finally { await context.close(); }
}

it.each([320, 390, 768, 1366].flatMap(width => (["reduce", "no-preference"] as const).map(motion => ({ width, motion }))))(
  "keeps citation reading and inspection accessible at $width/$motion", async ({ width, motion }) => {
    await fixture(async page => {
      const inspect = page.getByRole("button", { name: "Inspect evidence for citation S1", exact: true });
      const card = inspect.locator("xpath=ancestor::li[1]");
      const link = card.getByRole("link", { name: citations[0].itemTitle, exact: true });
      if (screenshots) await page.screenshot({ path: join(screenshots, `citation-reading-${width}-${motion}.png`), fullPage: true });
      const linkBox = await link.boundingBox(); expect(linkBox?.height).toBeGreaterThanOrEqual(44);
      const list = page.getByRole("list", { name: "Cited sources and references", exact: true });
      expect(await list.locator(":scope > li").count()).toBe(4);
      if (screenshots) await list.screenshot({ path: join(screenshots, `citations-${width}-${motion}.png`) });
      const targets = await list.locator("button,a").evaluateAll(elements => elements.map(element => {
        const bounds = element.getBoundingClientRect(); return { left: bounds.left, right: bounds.right, height: bounds.height };
      }));
      expect(targets.every(bounds => bounds.height >= 44 && bounds.left >= 0 && bounds.right <= width)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      expect(await link.getAttribute("target")).toBe("_blank"); expect(await link.getAttribute("rel")).toContain("noreferrer");
      expect(await card.getByText("$0.000001 planned", { exact: true }).count()).toBe(1);
      const publicCard = page.getByRole("button", { name: "Inspect evidence for citation S2", exact: true }).locator("xpath=ancestor::li[1]");
      expect(await publicCard.getByText("Free public reference · no creator payment · extracted html text (bounded excerpt)", { exact: true }).count()).toBe(1);
      expect(await publicCard.getByText(/planned/).count()).toBe(0);
      expect(await publicCard.getByText("Authors (crossref): Ada Lovelace, Research Group", { exact: true }).count()).toBe(1);
      expect(await publicCard.getByText("DOI: 10.1234/methods", { exact: true }).count()).toBe(1);
      expect(await publicCard.getByText("Journal article metadata · peer review unknown", { exact: true }).count()).toBe(1);
      expect(await publicCard.getByText("Read: publisher page; full paper not established", { exact: true }).count()).toBe(1);
      const synthetic = page.getByRole("button", { name: "Inspect evidence for citation S3", exact: true }).locator("xpath=ancestor::li[1]");
      expect(await synthetic.getByText("Synthetic demo content ? illustrative only", { exact: true }).count()).toBe(1);
      const unsafe = page.getByRole("button", { name: "Inspect evidence for citation S4", exact: true }).locator("xpath=ancestor::li[1]");
      expect(await unsafe.getByRole("link").count()).toBe(0); expect(await unsafe.getByText(citations[3].itemTitle!, { exact: true }).count()).toBe(1);
      expect(await page.locator("[data-citation-injection]").count()).toBe(0);
      await page.getByText("Simulated spend", { exact: true }).waitFor();

      await inspect.scrollIntoViewIfNeeded();
      const arrow = inspect.locator("svg"), before = await arrow.boundingBox(); expect(before).toBeTruthy();
      await inspect.hover();
      await expect.poll(async () => { const after = await arrow.boundingBox(); return after ? Math.round((after.x - before!.x) * 10) / 10 : null; }).toBe(motion === "reduce" ? 0 : 2);
      await link.focus(); await page.keyboard.press("Tab");
      expect(await inspect.evaluate(element => document.activeElement === element)).toBe(true);
      expect(await inspect.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
      const idleColor = await card.evaluate(element => getComputedStyle(element).backgroundColor);
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: citations[0].itemTitle, exact: true }); await dialog.waitFor();
      await dialog.getByText("Exact recorded creator excerpt.", { exact: false }).waitFor();
      expect(await dialog.getByText("Wrong version must not enter this inspector.", { exact: false }).count()).toBe(0);
      await dialog.getByText("Planned citation reward: $0.000001", { exact: true }).waitFor();
      await dialog.getByText("No settled citation payment is recorded.", { exact: true }).waitFor();
      await expect.poll(() => card.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(idleColor);
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
      await expect.poll(() => inspect.evaluate(element => document.activeElement === element)).toBe(true);
      const illustrative = page.getByRole("button", { name: "Inspect evidence for citation S3", exact: true });
      await illustrative.click();
      const demoDialog = page.getByRole("dialog", { name: citations[2].itemTitle, exact: true }); await demoDialog.waitFor();
      await demoDialog.getByText("No supporting excerpt is stored for this citation.", { exact: true }).waitFor();
      expect(await demoDialog.getByText("Synthetic excerpt cannot become factual support.", { exact: false }).count()).toBe(0);
      await page.keyboard.press("Escape"); await demoDialog.waitFor({ state: "detached" });
      await page.evaluate(() => (window as unknown as { citationFixture: { stress(value: boolean): void } }).citationFixture.stress(true));
      await page.getByRole("link", { name: /^Nghiên cứu 中文 / }).waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (screenshots && motion === "reduce") await page.screenshot({ path: join(screenshots, `citation-reading-${width}-long.png`), fullPage: true });
    }, width, motion);
  });

it("uses the report's available width for citation columns beside a desktop sidebar", async () => {
  await fixture(async page => {
    const list = page.getByRole("list", { name: "Cited sources and references", exact: true });
    const cards = list.locator(":scope > li");
    await page.locator("#root").evaluate(element => { element.style.maxWidth = "620px"; });
    // Query layout can settle on the next frame after parent resizing; read both cards in one snapshot.
    await expect.poll(() => cards.evaluateAll(elements => {
      const [first, second] = elements.map(element => element.getBoundingClientRect());
      return first.x === second.x && second.y >= first.bottom;
    })).toBe(true);
    expect(await list.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (screenshots) await list.screenshot({ path: join(screenshots, "citations-desktop-sidebar.png") });
    await page.locator("#root").evaluate(element => { element.style.maxWidth = "1080px"; });
    await expect.poll(() => cards.evaluateAll(elements => {
      const [first, second] = elements.map(element => element.getBoundingClientRect());
      return second.x >= first.right && first.y === second.y;
    })).toBe(true);
    await page.locator("#root").evaluate(element => { element.style.maxWidth = "350px"; });
    await expect.poll(() => list.evaluate(element => element.clientWidth < 350 && element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1366);
  }, 1366);
});

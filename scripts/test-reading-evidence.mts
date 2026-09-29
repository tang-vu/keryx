/** Browser behavior for stored evidence, payment truth, dialog focus and log following. */
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

const buildDir = path.resolve(process.cwd(), process.env.NEXT_DIST_DIR ?? ".next");
const cssDir = [
  path.join(buildDir, "static", "chunks"),
  path.join(buildDir, "dev", "static", "chunks"),
].find(dir => existsSync(dir) && readdirSync(dir).some(name => name.endsWith(".css")));
const cssFiles = cssDir
  ? readdirSync(cssDir).filter(name => name.endsWith(".css")).map(name => path.join(cssDir, name))
  : [];
const stylesheet = cssFiles.map(file => readFileSync(file, "utf8")).join("\n");
if (!stylesheet.includes(".bg-paper") || !stylesheet.includes(".sm\\:w-")) {
  throw new Error("Generated Tailwind stylesheet missing or stale; build before styled reading test");
}

const bundle = await build({
  stdin: {
    contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AnswerCard } from './components/keryx/answer-card';
import { ReasoningConsole } from './components/keryx/reasoning-console';
import { DispatchView } from './app/dispatch/[id]/dispatch-view';
const citation = {marker:'S1', sourceId:'source-1', sourceName:'Research Journal', itemId:'article-1', itemTitle:'The article: an unusually long title about measured evidence and a disputed claim across several research teams', itemUrl:'https://example.org/article', weight:1, reward:0.003, rationale:'evidence'};
const missing = {marker:'S2',sourceId:'source-2',sourceName:'Older Archive',itemTitle:'Legacy article',weight:0, reward:0, rationale:'legacy'};
const trace = Array.from({length:40},(_,i)=>({phase:'discover',ts:i,message:'Step '+i}));
const run = {id:'synthetic',question:'What happened to a particularly long research question that needs a careful cited explanation?',budget:0.01,engine:'fixture',subClaims:[],decisions:[],citations:[citation,missing],answer:Array.from({length:8},(_,i)=>'A grounded finding [S1]. The archive also appears [S2]. '+('Evidence should be read in context. '.repeat(5))).join(String.fromCharCode(10,10)),totalSpent:0.002,totalToCreators:0.002,trace,createdAt:'2026-09-28T00:00:00Z',paymentMode:'real',evidence:Array.from({length:12},(_,i)=>({claimIndex:i,claim:'A grounded finding',marker:'S1',sourceId:'source-1',sourceName:'Research Journal',quote:i===0?'The measured result was positive.':('A long excerpt of measured evidence, exactly as stored in the run. '.repeat(4)),support:0.8,qualifiesForReward:true}))};
const payment = (itemId,status,amount) => ({kind:'citation',queryId:'synthetic',sourceId:'source-1',sourceName:'Research Journal',itemId,payer:'payer',payee:'author-wallet',amountUsdc:amount,network:'Arc',settled:status==='settled',settlementStatus:status,createdAt:run.createdAt});
const payments = [payment('article-1','settled',0.001),payment('article-1','pending',0.002),payment('article-1','simulated',0.008),payment('other-article','settled',0.4),{...payment('article-1','settled',0.3),queryId:'other-run'},{...payment('article-1','simulated',0.006),settled:true}];
function App(){const [steps,setSteps]=React.useState(trace);window.addStep=()=>setSteps(s=>[...s,{phase:'discover',ts:s.length,message:'Step '+s.length}]);return <><div style={{height:900}}>Reading fixture</div><DispatchView run={run} payments={payments}/><ReasoningConsole steps={steps} streaming={true} budget={0.01}/></>};
createRoot(document.getElementById('root')).render(<App/>);
`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  write: false,
  define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_KERYX_SETTLEMENT_WALLET": '""' },
  plugins: [{ name: "alias", setup(api) {
    api.onResolve({ filter: /^@\// }, ({ path: importPath }) => {
      const target = path.join(process.cwd(), importPath.slice(2));
      return { path: existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx` };
    });
  } }],
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/feedback") return route.fulfill({ json: { up: 0, down: 0 } });
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  await page.goto("https://reading.invalid");
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const citation = page.getByRole("button", { name: /Open evidence for The article/ }).first();
  await citation.waitFor();
  const citationElement = await citation.elementHandle();
  assert(citationElement, "citation trigger must exist for focus restoration checks");
  await citation.evaluate(element => element.scrollIntoView({ behavior: "instant" }));
  const before = await page.evaluate(() => scrollY);
  await citation.click();
  const lockedY = await page.evaluate(() => -parseFloat(document.body.style.top));
  assert.equal(await page.evaluate(() => document.body.style.position), "fixed");
  const dialog = page.getByRole("dialog", { name: /The article/ });
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /The measured result was positive/);
  assert.match(await dialog.innerText(), /\$0\.001.*settled/);
  assert.match(await dialog.innerText(), /pending confirmation/);
  assert.match(await dialog.innerText(), /offline simulated payment/);
  assert.match(await dialog.innerText(), /conflicting settlement fields/);
  assert.doesNotMatch(await dialog.innerText(), /0\.4/);
  assert.doesNotMatch(await dialog.innerText(), /0\.3/);
  assert(await citation.evaluate(element => { element.focus(); return document.activeElement !== element; }));
  await page.keyboard.press("Shift+Tab");
  assert(await page.evaluate(() => document.activeElement?.closest('dialog') !== null));
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.waitForFunction(element => document.activeElement === element, citationElement, { timeout: 2000 });
  assert.equal(await page.evaluate(() => scrollY), lockedY, `reading position changed after closing: before click ${before}, locked ${lockedY}`);
  await page.getByRole("button", { name: "Open evidence for Legacy article" }).first().click();
  const legacy = page.getByRole("dialog", { name: "Legacy article" });
  assert.match(await legacy.innerText(), /No supporting excerpt is stored/);
  assert.match(await legacy.innerText(), /No settled citation payment is recorded/);
  await page.mouse.click(2, 2);
  await legacy.waitFor({ state: "detached" });

  for (const viewport of [
    { width: 320, height: 640 }, { width: 390, height: 800 },
    { width: 768, height: 800 }, { width: 1024, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const positions = await page.evaluate(() => {
      const elements = [...document.querySelectorAll("*")];
      return {
        answer: elements.find(element => element.textContent?.trim() === "The reading")?.getBoundingClientRect().top ?? NaN,
        payment: elements.find(element => element.textContent?.trim() === "The settlement")?.getBoundingClientRect().top ?? NaN,
        log: [...document.querySelectorAll("summary")].find(element => element.textContent?.includes("Decision log"))?.getBoundingClientRect().top ?? NaN,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    assert(Number.isFinite(positions.answer) && Number.isFinite(positions.payment) && Number.isFinite(positions.log));
    assert(positions.answer <= positions.payment + 1, `answer must lead payment at ${viewport.width}px`);
    assert(positions.answer < positions.log, `answer must lead decision log at ${viewport.width}px`);
    assert(positions.scrollWidth <= viewport.width + 1, `horizontal overflow at ${viewport.width}px: ${positions.scrollWidth}`);

    await citation.evaluate(element => element.scrollIntoView({ behavior: "instant" }));
    const readingY = await page.evaluate(() => scrollY);
    await citation.click();
    const dialogY = await page.evaluate(() => -parseFloat(document.body.style.top));
    await dialog.waitFor();
    const geometry = await dialog.evaluate(element => {
      element.scrollTop = element.scrollHeight;
      const box = element.getBoundingClientRect();
      const close = element.querySelector<HTMLButtonElement>('button[aria-label="Close citation evidence"]')!.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width,
        position: getComputedStyle(element).position, closeTop: close.top, closeBottom: close.bottom,
        scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
    });
    assert.equal(geometry.position, "fixed", `built CSS must style dialog at ${viewport.width}px`);
    assert(geometry.left >= -1 && geometry.right <= viewport.width + 1, `dialog horizontal fit at ${viewport.width}px`);
    assert(geometry.top >= -1 && geometry.bottom <= viewport.height + 1, `dialog vertical fit at ${viewport.width}px`);
    if (viewport.width >= 768) assert(geometry.width <= 461, `desktop side panel width at ${viewport.width}px`);
    assert(geometry.scrollHeight > geometry.clientHeight, `long evidence should scroll at ${viewport.width}px`);
    assert(geometry.closeTop >= geometry.top && geometry.closeBottom <= geometry.bottom, `close must stay visible at ${viewport.width}px`);
    await page.getByRole("button", { name: "Close citation evidence" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.waitForFunction(element => document.activeElement === element, citationElement, { timeout: 2000 });
    assert.equal(await page.evaluate(() => scrollY), dialogY, `reading position changed at ${viewport.width}px; before click ${readingY}, locked ${dialogY}`);
  }

  const log = page.getByLabel("Decision log").last();
  await log.evaluate(element => { element.style.height = "120px"; element.style.maxHeight = "120px"; element.style.overflowY = "auto"; element.firstElementChild.style.minHeight = "1600px"; });
  await log.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event("scroll", { bubbles: true })); });
  await page.evaluate(() => window.addStep());
  await page.waitForTimeout(40);
  assert(await log.evaluate(element => element.scrollTop > 0));
  await log.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll", { bubbles: true })); });
  await page.getByRole("button", { name: "Jump to latest" }).waitFor();
  await page.evaluate(() => window.addStep());
  assert.equal(await log.evaluate(element => element.scrollTop), 0);
  await page.getByRole("button", { name: "Jump to latest" }).click();
  assert(await log.evaluate(element => element.scrollTop > 0));
  assert.deepEqual(errors, []);
  console.log("PASS: citation evidence and payment state, modal focus/scroll, and contained log following");
} finally {
  await browser.close();
}

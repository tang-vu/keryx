import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { build, type Plugin } from "esbuild";
import { chromium } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const links: Plugin = { name: "archive-fixture-links", setup(builder) {
  builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "archive-link" }));
  builder.onLoad({ filter: /.*/, namespace: "archive-link" }, () => ({ contents: "import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}", loader: "jsx", resolveDir: process.cwd() }));
} };
const bundle = await build({ stdin: { contents: `
  import React from 'react';import{createRoot}from'react-dom/client';
  import{PublicReferenceLibrary,parseArticleLibraryFilters}from'./components/keryx/public-reference-library';
  const params=Object.fromEntries(new URL(location.href).searchParams), filters=parseArticleLibraryFilters(params);
  const reference={id:'public:fixture',name:'Fixture publisher',url:'https://publisher.fixture/',rssUrl:'https://publisher.fixture/feed',description:'',tags:[],active:true,items:[]};
  const records=Array.from({length:45},(_,i)=>({id:'public-item:'+i,referenceId:reference.id,title:'Historical article '+i,summary:i===42?'SQLite backups require a consistent snapshot.':'Retained public summary '+i,content:'NEVER_SERIALIZE_BODY',link:'https://publisher.fixture/article/'+i,deliveryKind:'excerpt',collectionKind:'article',contentVersion:'sha256:fixture',firstCollectedAt:'2026-10-12T00:00:00.000Z',lastCollectedAt:'2026-10-12T00:00:00.000Z',publishedAt:'2010-01-01T00:00:00.000Z'}));
  const matching=filters.query?records.filter(i=>i.summary.toLowerCase().includes(filters.query.toLowerCase())):records;
  const offset=filters.cursor==='second'?20:0, page={items:matching.slice(offset,offset+20),total:matching.length,...(!filters.query&&offset===0?{nextCursor:'second'}:{})};
  createRoot(document.getElementById('root')).render(<PublicReferenceLibrary page={page} status={params.status||'ready'} references={[reference]} filters={filters}/>);
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", platform: "browser", plugins: [links],
  define: { "process.env": "{}", "process.env.NODE_ENV": '"production"' } });
const css = (await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
const screenshots = path.resolve(".artifacts/source-archive-ux");
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      assert.equal(route.request().method(), "GET", "Browsing cannot send writes or payments");
      assert.equal(new URL(route.request().url()).origin, "https://library.fixture", "No provider, wallet or publisher fetch from browser fixture");
      return route.fulfill({ contentType: "text/html", body: `<style>${css}</style><main class="mx-auto max-w-[1040px] px-4"><div id="root"></div></main><script>${bundle.outputFiles[0]!.text}</script>` });
    });
    await page.goto("https://library.fixture/sources?publisher=public%3Afixture&articleSort=oldest");
    await page.getByRole("heading", { name: "The article library", exact: true }).waitFor();
    assert.equal(await page.locator("article").count(), 20);
    assert.match(await page.locator("body").innerText(), /45 retained articles/);
    assert.equal(await page.getByLabel("Sort articles").inputValue(), "oldest");
    const next = page.getByRole("link", { name: /Next page/ });
    assert.match(await next.getAttribute("href") ?? "", /publisher=public%3Afixture/);
    assert.match(await next.getAttribute("href") ?? "", /articleSort=oldest/);
    await next.click();
    await page.getByRole("heading", { name: "Historical article 20", exact: true }).waitFor();
    await page.getByLabel("Search articles", { exact: true }).fill("SQLite backups");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("heading", { name: "Historical article 42", exact: true }).waitFor();
    assert.equal(await page.locator("article").count(), 1);
    assert.equal(new URL(page.url()).searchParams.has("articleCursor"), false, "Changing query starts a fresh page");
    assert.match(await page.getByRole("link", { name: /Research this article/ }).getAttribute("href") ?? "", /^\/\?q=/);
    assert.equal(await page.locator("body").innerText().then(text => text.includes("NEVER_SERIALIZE_BODY")), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "No horizontal overflow");
    await page.screenshot({ path: path.join(screenshots, `search-${width}.png`), fullPage: true });
    await page.goto("https://library.fixture/sources?status=unavailable");
    await page.getByRole("status").waitFor();
    assert.match(await page.getByRole("status").innerText(), /temporarily unavailable/);
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
console.log("Article library browser acceptance passed: historical search, publisher/date filters, pagination, drafts, metadata-only output, unavailable state and320/1440px layout.");

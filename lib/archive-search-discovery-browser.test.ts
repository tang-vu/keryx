import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, webkit, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string, css: string;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
const fonts = `@font-face{font-family:Display;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:Serif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:Mono;src:url('/fonts/spline-sans-mono-latin.woff2')}:root{--font-bodoni:Display;--font-spectral:Serif;--font-spline-mono:Mono}`;
type Fixture = { count(value: number): void; locale(value: "vi" | "zh-Hans"): void; unchanged(): boolean };

beforeAll(async () => {
  const result = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ArchiveSearch}from'./components/keryx/archive-search';
    import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';import{createMessages}from'./lib/i18n/messages';import vi from'./locales/generated/vi-ui-preview';import zh from'./locales/generated/zh-Hans-ui-preview';
    const others=Array.from({length:53},(_,i)=>({id:'report-'+i,question:'Báo cáo đám mây '+i,sources:'Circle Arc USDC'})),before=JSON.stringify(others);
    const fixture=window.archiveFixture={unchanged:()=>JSON.stringify(others)===before};
    function App(){const[count,setCount]=useState(53),[locale,setLocale]=useState('en');Object.assign(fixture,{count:setCount,locale:setLocale});const preview=locale==='vi'?vi:locale==='zh-Hans'?zh:{},ui=locale==='en'?englishUiCopy:{...englishUiCopy,locale,preview,message:createMessages(locale,preview.$messages)};
      return <UiCopyContext.Provider value={ui}><ArchiveSearch terms={['Đánh giá đám mây Circle','Unrelated question Other publisher']} others={others.slice(0,count)}><article data-original-card="matching">Đánh giá đám mây</article><article data-original-card="other">Unrelated question</article></ArchiveSearch></UiCopyContext.Provider>}
    createRoot(document.getElementById('root')).render(<App/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "archive-links", setup(plugin) {
      plugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next/link", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "jsx", resolveDir: process.cwd(), contents: "export default function Link(props){return <a {...props}/>}" }));
    } }] });
  const inputs=Object.keys(result.metafile!.inputs).map(p=>p.replaceAll("\\","/"));expect(inputs.some(p=>p.endsWith("components/keryx/archive-search.tsx"))).toBe(true);
  expect(inputs.some(p=>/(?:^|\/)node_modules\/(?:jsonwebtoken|jwa|jws)\//.test(p))).toBe(false);
  bundle=result.outputFiles[0].text;
  css=(await postcss([tailwind({base:process.cwd()})]).process(await readFile("app/globals.css","utf8"),{from:resolve("app/globals.css")})).css+fonts;
  if(screenshots) await mkdir(screenshots,{recursive:true});
  browser=await(process.env.KERYX_UX_BROWSER==="webkit"?webkit:chromium).launch({headless:true});
},30_000);
afterAll(async()=>{await browser?.close();});

async function fixture(test:(page:Page)=>Promise<void>,width=390,motion:"reduce"|"no-preference"="reduce"){
  const context=await browser.newContext({viewport:{width,height:844},reducedMotion:motion}),errors:string[]=[],unexpected:string[]=[];
  try{
    await context.route("**/*",async route=>{const request=route.request(),url=new URL(request.url());
      if(request.method()!=="GET"||url.origin!=="https://archive-discovery.test"){unexpected.push(request.url());return route.abort();}
      if(url.pathname==="/style.css")return route.fulfill({contentType:"text/css",body:css});
      if(url.pathname.startsWith("/fonts/"))return route.fulfill({contentType:"font/woff2",body:await readFile(join("app",url.pathname))});
      if(url.pathname!=="/"){unexpected.push(url.pathname);return route.abort();}
      return route.fulfill({contentType:"text/html",body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main style="max-width:900px;margin:32px auto;padding:0 16px"><div id="root"></div></main></body></html>'});
    });
    const page=await context.newPage();page.setDefaultTimeout(5000);page.on("pageerror",e=>errors.push(e.message));
    await page.goto("https://archive-discovery.test/");await page.addScriptTag({content:bundle});await page.getByRole("searchbox").waitFor();await page.evaluate(()=>document.fonts.ready);
    await test(page);expect(errors).toEqual([]);expect(unexpected).toEqual([]);expect(await page.evaluate(()=>(window as unknown as{archiveFixture:Fixture}).archiveFixture.unchanged())).toBe(true);
  }finally{await context.close();}
}

it("restores result page focus and viewport context after native pagination",async()=>{
  await fixture(async page=>{
    const search=page.getByRole("searchbox");await search.fill("circle may dam");
    const older=page.getByRole("button",{name:"Older →",exact:true});await older.click();
    await page.getByRole("link").first().getByText("Báo cáo đám mây 25",{exact:true}).waitFor();
    const heading=page.getByRole("heading",{name:"Elsewhere in the archive · 53",exact:true});
    expect(await heading.evaluate(n=>document.activeElement===n)).toBe(true);
    const rect=(await heading.boundingBox())!;expect(rect.y).toBeGreaterThanOrEqual(0);expect(rect.y+rect.height).toBeLessThan(844);
    expect((await page.getByRole("link").first().boundingBox())!.y).toBeLessThan(844);
    expect(await search.inputValue()).toBe("circle may dam");
  });
});

it("shows exact on-page/elsewhere counts and every result range",async()=>{
  await fixture(async page=>{
    await page.getByRole("searchbox").fill("circle may dam");
    expect(await page.locator("dd").allTextContents()).toEqual(["1","53"]);
    await page.getByText("Matches 1–25 of 53",{exact:true}).waitFor();
    const older=page.getByRole("button",{name:"Older →",exact:true});await older.click();await page.getByText("Matches 26–50 of 53",{exact:true}).waitFor();
    await older.click();await page.getByText("Matches 51–53 of 53",{exact:true}).waitFor();expect(await page.getByRole("link").count()).toBe(3);
    expect(await older.isDisabled()).toBe(true);expect(await page.getByRole("link").last().getAttribute("href")).toBe("/dispatch/report-52");
  });
});

it("keeps query focus and original cards stable through editing and data shrink",async()=>{
  await fixture(async page=>{
    const original=await page.locator('[data-original-card="matching"]').elementHandle(),search=page.getByRole("searchbox");await search.fill("circle may dam");
    const heading=await page.getByRole("heading").elementHandle();await page.getByRole("button",{name:"Older →",exact:true}).click();
    expect(await heading!.evaluate(n=>n.isConnected)).toBe(true);await search.fill("usdc");expect(await search.evaluate(n=>document.activeElement===n)).toBe(true);
    expect(await page.getByRole("link").first().getAttribute("href")).toBe("/dispatch/report-0");
    await page.getByRole("button",{name:"Older →",exact:true}).click();await search.focus();
    await page.evaluate(()=>(window as unknown as{archiveFixture:Fixture}).archiveFixture.count(1));await page.getByText("Matches 1–1 of 1",{exact:true}).waitFor();
    expect(await search.evaluate(n=>document.activeElement===n)).toBe(true);await page.getByRole("button",{name:"Clear search",exact:true}).click();
    expect(await original!.evaluate(n=>n.isConnected)).toBe(true);expect(await page.locator("article:visible").allTextContents()).toEqual(["Đánh giá đám mây","Unrelated question"]);
  });
});

it("recovers from an empty literal query without losing native search focus",async()=>{
  await fixture(async page=>{
    const search=page.getByRole("searchbox"),query='https://example.invalid/'+"q".repeat(220)+' <img data-archive-injection>';
    await search.fill(query);expect(await page.getByText(query,{exact:false}).count()).toBe(1);expect(await page.locator("[data-archive-injection]").count()).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await page.getByRole("button",{name:"Show this page's reports",exact:true}).click();expect(await search.inputValue()).toBe("");
    expect(await search.evaluate(n=>document.activeElement===n)).toBe(true);expect(await page.locator("article:visible").count()).toBe(2);
    expect(await page.locator("dd").count()).toBe(0);
  },320);
});

it("keeps native controls at44px with compact text",async()=>{
  await fixture(async page=>{
    await page.evaluate(()=>{document.documentElement.style.fontSize="12px";});await page.getByRole("searchbox").fill("usdc");
    const controls=await page.locator("input,button,a").evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()).map(n=>({tag:n.tagName,height:(n as HTMLElement).offsetHeight})));
    expect(controls.filter(n=>n.height<44)).toEqual([]);
  },320);
});

it("keeps every original card in the initial server markup",async()=>{
  const{renderToString}=await import("react-dom/server"),{createElement}=await import("react"),{ArchiveSearch}=await import("../components/keryx/archive-search");
  const html=renderToString(createElement(ArchiveSearch,{terms:["Alpha","Beta"],children:[createElement("article",{key:"a"},"Original Alpha"),createElement("article",{key:"b"},"Original Beta")]}));
  expect(html).toContain("Original Alpha");expect(html).toContain("Original Beta");expect(html).not.toContain('hidden=""');
});

it.each(["vi","zh-Hans"]as const)("fits the actual %s preview and retains original questions with enlarged text",async locale=>{
  await fixture(async page=>{
    await page.evaluate(value=>{document.documentElement.style.fontSize="24px";(window as unknown as{archiveFixture:Fixture}).archiveFixture.locale(value);},locale);
    await page.getByRole("searchbox").fill("circle may dam");const section=page.getByRole("region");await section.getByRole("navigation").getByRole("button").last().click();
    expect(await section.getByRole("link").first().textContent()).toBe("Báo cáo đám mây 25");expect(await section.getByRole("link").first().locator("span").first().getAttribute("lang")).toBe("und");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    if(screenshots)await section.screenshot({path:join(screenshots,`archive-discovery-${locale}-320-large.png`)});
  },320);
});

it.each([320,390,768,1366].flatMap(width=>(["reduce","no-preference"]as const).map(motion=>({width,motion}))))(
  "keeps result context and finite motion at $width/$motion",async({width,motion})=>{
    await fixture(async page=>{
      const search=page.getByRole("searchbox");await search.fill("usdc");const heading=await page.getByRole("heading").elementHandle();await page.getByRole("button",{name:"Older →",exact:true}).click();
      const list=page.getByRole("region").getByRole("list");expect(await list.evaluate(n=>getComputedStyle(n).animationName)).toBe(motion==="reduce"?"none":"kxUp");
      if(motion==="no-preference")expect(await list.evaluate(n=>getComputedStyle(n).animationIterationCount)).toBe("1");
      expect(await heading!.evaluate(n=>n.isConnected&&document.activeElement===n)).toBe(true);
      await page.emulateMedia({reducedMotion:"reduce"});await expect.poll(()=>list.evaluate(n=>getComputedStyle(n).animationName)).toBe("none");
      const target=page.getByRole("region").getByRole("link").nth(12),toolbar=page.getByRole("region").getByRole("navigation").locator("..");
      await target.evaluate(n=>n.scrollIntoView({block:"start",behavior:"instant"}));
      const tools=(await toolbar.boundingBox())!,row=(await target.boundingBox())!;
      expect(tools.y).toBeGreaterThanOrEqual(0);expect(tools.y+tools.height).toBeLessThan(844);expect(row.y).toBeGreaterThanOrEqual(tools.y+tools.height);
      if(screenshots)await page.getByRole("region").screenshot({path:join(screenshots,`archive-discovery-${width}-${motion}.png`)});
      await page.evaluate(()=>{document.documentElement.style.fontSize="24px";});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      await search.fill("https://no-match.invalid/"+"z".repeat(240));expect(await search.evaluate(n=>document.activeElement===n)).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    },width,motion);
  });

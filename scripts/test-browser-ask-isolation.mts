/** Real hook with delayed fetch/body mocks; proves obsolete client callbacks cannot alter a new ask. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

declare global {
  interface Window {
    probe: { ask: (question: string, budget: number) => Promise<void>; reset: () => void };
    releaseBody: () => void;
    releaseFetch: () => void;
  }
}

const bundle = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {useAskStream} from './lib/hooks/use-ask-stream';
let count=0; let oldBody; let oldFetch;
const run={id:'new-run',question:'new',budget:0.05,engine:'fixture',subClaims:[],decisions:[],citations:[],answer:'New report',totalSpent:0,totalToCreators:0,trace:[],createdAt:'2026-10-01'};
window.fetch=async()=>{
  count++;
  if(count===1)return new Response(new ReadableStream({start(c){oldBody=c;window.releaseBody=()=>c.error(new DOMException('Body aborted','AbortError'));}}),{status:401});
  if(count===3)return new Promise((resolve,reject)=>{oldFetch=reject;window.releaseFetch=()=>reject(new Error('Old transport failed'));});
  return new Response('event: done\\ndata: '+JSON.stringify(run)+'\\n\\n',{status:200});
};
function Probe(){const {state,ask,reset}=useAskStream();window.probe={ask,reset};return <pre id="state">{JSON.stringify(state)}</pre>}
createRoot(document.getElementById('root')).render(<Probe/>);
` }, bundle: true, write: false, platform: "browser", format: "iife", external: ["@/lib/x402-client-sign", "@/lib/payments/client-payto-allowlist", "@/lib/payments/browser-fetch-price-policy"], define: { "process.env.NODE_ENV": '"production"' } });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("https://ask-isolation.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => !!(window as unknown as { probe: unknown }).probe);
  await page.evaluate(() => { void window.probe.ask("old body", 0.05); });
  await page.waitForFunction(() => !!window.releaseBody);
  await page.evaluate(() => { window.probe.reset(); void window.probe.ask("new", 0.05); });
  await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).status === "done");
  await page.evaluate(() => window.releaseBody());
  await page.waitForTimeout(100);
  let state = JSON.parse((await page.locator("#state").textContent())!);
  assert.equal(state.status, "done", "Aborted old error body must not overwrite completed new run");
  assert.equal(state.run.id, "new-run");
  await page.evaluate(() => { void window.probe.ask("old transport", 0.05); });
  await page.waitForFunction(() => !!window.releaseFetch);
  await page.evaluate(() => { window.probe.reset(); void window.probe.ask("new", 0.05); });
  await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).status === "done");
  await page.evaluate(() => window.releaseFetch());
  await page.waitForTimeout(100);
  state = JSON.parse((await page.locator("#state").textContent())!);
  assert.equal(state.status, "done", "Late old transport rejection must not overwrite a new run");
  console.log("PASS: obsolete aborted error-body and transport rejection leave next ask untouched (intentionally late mocks; no HTTP/signing).");
} finally { await browser.close(); }

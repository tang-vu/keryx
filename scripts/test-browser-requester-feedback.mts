/** Real client component and production CSS; synthetic HTTP, no research or payments. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { recordedJobObservations } from "../lib/research-feedback/observations.ts";
import { recordedRun } from "../lib/research-feedback/test-fixture.ts";

const chunks = join(process.cwd(), ".next/static/chunks");
const cssFiles = (await readdir(chunks)).filter(file => file.endsWith(".css"));
assert(cssFiles.length, "Build the exact candidate before browser verification");
const css = (await Promise.all(cssFiles.map(file => readFile(join(chunks, file), "utf8")))).join("\n");
const directory = process.env.KERYX_FEEDBACK_SCREENSHOT_DIR ?? join(process.cwd(), ".artifacts/requester-feedback");
await mkdir(directory, { recursive: true });
const run = recordedRun(), token = `${"a".repeat(90)}.${"b".repeat(43)}`;
const packet = { format: "keryx-private-requester-observation-v1", runId: run.id,
  observations: recordedJobObservations(run), feedback: { token, expiresAt: "2026-11-23T00:00:00.000Z", endpoint: "/api/research-feedback" } };
const reply = (choice: "useful" | "revise" | "reject", reason = "") => ({ format: "keryx-requester-feedback-response-v1", runId: run.id,
  deliveredDigest: "1".repeat(64), execution: "none", feedback: { format: "keryx-requester-feedback-v1", runId: run.id,
    deliveredDigest: "1".repeat(64), choice, reason, submittedAt: "2026-10-24T00:00:00.000Z", observations: packet.observations } });
const bundle = await build({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{RequesterFeedback}from'./components/keryx/requester-feedback';
import{receiveRequesterObservations}from'./lib/research-feedback/browser-delivery';
import{useAskStream}from'./lib/hooks/use-ask-stream';
const root=createRoot(document.getElementById('root'));window.renderFeedback=packet=>{receiveRequesterObservations(packet);root.render(<RequesterFeedback key={packet.runId} runId={packet.runId}/>);};
let original,privatePacket;window.researchRequests=[];
function StreamHarness(){const api=useAskStream();return <><button onClick={()=>api.ask(original.question,0)}>Read synthetic original</button><p>{api.state.run?.answer}</p><output hidden data-testid="public-stream">{JSON.stringify(api.state)}</output>{api.state.run&&<RequesterFeedback runId={api.state.run.id}/>}</>;}
window.renderStream=(run,packet)=>{original=run;privatePacket=packet;root.render(<StreamHarness/>);};
window.feedbackRequests=[];window.fetch=(input,init={})=>new Promise((resolve,reject)=>{
 if(String(input)==='/api/ask'){
  window.researchRequests.push({url:String(input),body:JSON.parse(init.body)});
  const encode=new TextEncoder(),frame=(event,data)=>encode.encode('event: '+event+'\\ndata: '+JSON.stringify(data)+'\\n\\n');
  resolve(new Response(new ReadableStream({async start(controller){controller.enqueue(frame('done',original));await new Promise(done=>setTimeout(done,40));controller.enqueue(frame('private-requester-observations',privatePacket));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}}));return;
 }
 const request={url:String(input),method:init.method,body:JSON.parse(init.body),authorization:init.headers.Authorization,credentials:init.credentials,redirect:init.redirect,referrerPolicy:init.referrerPolicy};
 request.reply=(status,data)=>resolve(Response.json(data,{status}));request.fail=()=>reject(new TypeError('Synthetic response loss'));
 init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));window.feedbackRequests.push(request);
});`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
  plugins: [{ name: "no-signing-in-feedback-transport-fixture", setup(builder) {
    builder.onResolve({ filter: /x402-client-sign$/ }, () => ({ path: "denied-signing", namespace: "feedback-fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "feedback-fixture" }, () => ({ contents: "throw new Error('Feedback transport fixture forbids signing');", loader: "js" }));
  } }],
});
interface Controls { renderFeedback(value: unknown): void; renderStream(run: unknown, packet: unknown): void; researchRequests: { url: string; body: unknown }[]; feedbackRequests: { url: string; method: string; body: unknown; authorization: string;
  credentials: string; redirect: string; referrerPolicy: string; reply(status: number, body: unknown): void; fail(): void }[] }
const browser = await chromium.launch({ headless: true });
let cases = 0;
try {
  async function scenario(test: (page: Page) => Promise<void>, stream = false) {
    const context = await browser.newContext({ viewport: { width: 390, height: 760 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    await context.route("**/*", route => route.request().url() === "https://feedback.test/" ? route.fulfill({ contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main id="root" style="max-width:800px;margin:auto"></main></body></html>` }) : route.abort());
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto("https://feedback.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
      if (stream) await page.evaluate(({ run, packet }) => (window as unknown as Controls).renderStream(run, packet), { run, packet });
      else {
        await page.evaluate(value => (window as unknown as Controls).renderFeedback(value), packet);
        await page.getByRole("button", { name: "Useful", exact: true }).waitFor();
      }
      await test(page); assert.deepEqual(errors, []); cases++;
    } finally { await context.close(); }
  }
  const wait = (page: Page, count: number) => page.waitForFunction(n => (window as unknown as Controls).feedbackRequests.length === n, count);
  const respond = (page: Page, index: number, body: unknown) => page.evaluate(({ index, body }) => (window as unknown as Controls).feedbackRequests[index].reply(200, body), { index, body });
  await scenario(async page => {
    assert(await page.getByRole("button", { name: "Record my feedback" }).isDisabled());
    assert.equal(await page.evaluate(() => (window as unknown as Controls).feedbackRequests.length), 0);
    await page.getByRole("button", { name: "Needs revision", exact: true }).click();
    await page.getByLabel("Optional private reason").fill("Please add an exact API version.");
    await page.getByRole("button", { name: "Record my feedback" }).click(); await wait(page, 1);
    const request = await page.evaluate(() => { const { reply, fail, ...request } = (window as unknown as Controls).feedbackRequests[0]; void reply; void fail; return request; });
    assert.deepEqual(request, { url: "https://feedback.test/api/research-feedback", method: "POST",
      body: { operation: "submit", choice: "revise", reason: "Please add an exact API version." }, authorization: `Bearer ${token}`,
      credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    await respond(page, 0, reply("revise", "Please add an exact API version."));
    await page.getByRole("status").filter({ hasText: "Your feedback is recorded: Needs revision." }).waitFor();
    await page.getByText("What these observations include").click();
    assert(await page.getByText("Recorded generation: 1.3 s").isVisible());
    assert(!(await page.locator("body").innerText()).includes(token));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, hash: location.hash })), { local: 0, session: 0, hash: "" });
    await page.screenshot({ path: join(directory, "requester-feedback-390.png"), fullPage: true });
  });
  await scenario(async page => {
    await page.getByRole("button", { name: "Unusable", exact: true }).click();
    await page.getByRole("button", { name: "Record my feedback" }).click(); await wait(page, 1);
    await page.evaluate(() => (window as unknown as Controls).feedbackRequests[0].fail());
    const check = page.getByRole("button", { name: "Check whether feedback was recorded" }); await check.waitFor(); await check.click(); await wait(page, 2);
    assert.deepEqual(await page.evaluate(() => (window as unknown as Controls).feedbackRequests[1].body), { operation: "read" });
    await respond(page, 1, reply("reject"));
    await page.getByRole("status").filter({ hasText: "Your feedback is recorded: Unusable." }).waitFor();
    assert.equal(await page.evaluate(() => (window as unknown as Controls).feedbackRequests.length), 2);
  });
  await scenario(async page => {
    await page.getByRole("button", { name: "Useful", exact: true }).click(); await page.getByRole("button", { name: "Record my feedback" }).click(); await wait(page, 1);
    await respond(page, 0, { ...reply("useful"), runId: "another-original" });
    await page.getByRole("button", { name: "Check whether feedback was recorded" }).waitFor();
    assert.equal(await page.getByText(/^Your feedback is recorded:/).count(), 0);
  });
  await scenario(async page => {
    await page.getByRole("button", { name: "Read synthetic original" }).click();
    await page.getByRole("button", { name: "Useful", exact: true }).waitFor();
    const state = JSON.parse((await page.getByTestId("public-stream").textContent())!);
    assert.equal(state.status, "done"); assert.equal(state.run.id, run.id); assert.equal(state.run.answer, run.answer);
    assert(!JSON.stringify(state).includes(token));
    assert.equal(await page.evaluate(() => (window as unknown as Controls).researchRequests.length), 1);
    assert.equal(await page.evaluate(() => (window as unknown as Controls).feedbackRequests.length), 0);
    assert(await page.getByRole("button", { name: "Record my feedback" }).isDisabled());
    assert(!(await page.locator("body").innerText()).includes(token));
    assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
    await page.screenshot({ path: join(directory, "requester-original-stream-390.png"), fullPage: true });
  }, true);
  console.log(JSON.stringify({ status: "passed", realChromium: true, cases, noAutomaticOpinion: true, originalResponseMemoryOnly: true, spending: false }));
} finally { await browser.close(); }

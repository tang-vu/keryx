import { expect, it } from "vitest";
import { build } from "esbuild";
import { chromium } from "playwright";

/** Scope/HTTP lifecycle check; payment cryptography and durable admission have their own tests. */
it("keeps originating mainnet question scopes and suppresses obsolete header callbacks", async () => {
  const bundle = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{useAskStream}from'./lib/hooks/use-ask-stream';
    window.scopes=[];window.headers=[];window.streams=[];
    window.fetch=async(url,init)=>{
      if(url==='/api/ask/sign'){window.headers.push(JSON.parse(init.body));return new Response('{}',{status:200});}
      if(url!=='/api/ask')throw Error('Unexpected synthetic endpoint');
      return new Response(new ReadableStream({start(controller){window.streams.push(controller);}}),{status:200});
    };
    window.emit=(index,reqId)=>window.streams[index].enqueue(new TextEncoder().encode('event: sign-request\\ndata: '+JSON.stringify({
      reqId,admittedNonce:'0x'+'11'.repeat(32),browserAuthorizationProtocol:'durable-v1',requirements:{amount:'999999'}})+'\\n\\n'));
    const authorize=(reqId,question)=>{window.scopes.push({reqId,...question});return window.scopes.length===1?
      new Promise(resolve=>{window.releaseOldHeader=()=>resolve('old-synthetic-header')}):Promise.resolve('new-synthetic-header');};
    function Probe(){const hook=useAskStream({sessionId:'0x'+'11'.repeat(20),grantCap:0.5,authorizeSessionPayment:authorize});window.ask=hook.ask;return <main/>;}
    createRoot(document.getElementById('root')).render(<Probe/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", define: {
    "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x3333333333333333333333333333333333333333"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
  } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://keryx.cc"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    type Fixture = { ask(question: string, budget: number): Promise<void>; emit(index: number, reqId: string): void;
      scopes: Array<{ reqId: string; id: string; budgetMicroUsdc: string }>; headers: Array<{ reqId: string }>;
      streams: unknown[]; releaseOldHeader(): void };
    await page.waitForFunction(() => !!(window as unknown as Fixture).ask);
    await page.evaluate(() => { void (window as unknown as Fixture).ask("First question", 0.01); });
    await page.waitForFunction(() => (window as unknown as Fixture).streams.length === 1);
    await page.evaluate(() => (window as unknown as Fixture).emit(0, "00000000-0000-4000-8000-000000000001"));
    await page.waitForFunction(() => (window as unknown as Fixture).scopes.length === 1);
    await page.evaluate(() => { void (window as unknown as Fixture).ask("Replacement question", 0.02); });
    await page.waitForFunction(() => (window as unknown as Fixture).streams.length === 2);
    await page.evaluate(() => (window as unknown as Fixture).emit(1, "00000000-0000-4000-8000-000000000002"));
    await page.waitForFunction(() => (window as unknown as Fixture).headers.length === 1);
    await page.evaluate(() => {
      (window as unknown as Fixture).emit(0, "00000000-0000-4000-8000-000000000003");
      (window as unknown as Fixture).releaseOldHeader();
    });
    await page.waitForTimeout(100);
    const { scopes, headers } = await page.evaluate(() => ({ scopes: (window as unknown as Fixture).scopes, headers: (window as unknown as Fixture).headers }));
    expect(scopes.map(scope => scope.budgetMicroUsdc)).toEqual(["10000", "20000"]);
    expect(scopes[0].id).not.toBe(scopes[1].id);
    expect(headers.map(header => header.reqId)).toEqual(["00000000-0000-4000-8000-000000000002"]);
  } finally { await browser.close(); }
}, 20000);

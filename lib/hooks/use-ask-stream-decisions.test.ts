import { expect, it } from "vitest";
import { build } from "esbuild";
import { chromium } from "playwright";

it("keeps only source decisions from both streamed and canonical final records", async () => {
  const bundle = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{useAskStream}from'./lib/hooks/use-ask-stream';
    window.fetch=async(url)=>{if(url!=='/api/ask')throw Error('Unexpected endpoint');return new Response(new ReadableStream({start(controller){window.stream=controller;}}));};
    window.emit=(event,data)=>window.stream.enqueue(new TextEncoder().encode('event: '+event+'\\ndata: '+JSON.stringify(data)+'\\n\\n'));
    function Probe(){const hook=useAskStream();window.ask=hook.ask;window.state=hook.state;return <main/>;}
    createRoot(document.getElementById('root')).render(<Probe/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", define: {
    "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
  } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://decisions.invalid/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    type Fixture = { ask(question: string, budget: number): Promise<void>; stream: ReadableStreamDefaultController;
      emit(event: string, value: unknown): void; state: { status: string; decisions: unknown[] } };
    await page.waitForFunction(() => !!(window as unknown as Fixture).ask);
    await page.evaluate(() => { void (window as unknown as Fixture).ask("Synthetic question", 0); });
    await page.waitForFunction(() => !!(window as unknown as Fixture).stream);
    const choice = { sourceId: "fixture-source", sourceName: "Source", action: "CACHE", expectedValue: 0.8,
      confidence: 0.7, price: 0, rationale: "", targets: [0] };
    const other = { protocol: "keryx-source-selection-v1", stage: "decide", outcome: "refused" };
    await page.evaluate(({ choice, other }) => {
      const fixture = window as unknown as Fixture;
      for (const detail of [other, { action: "SKIP" }, choice]) fixture.emit("step", { phase: "decide", detail, message: "Synthetic trace", ts: 1 });
    }, { choice, other });
    await page.waitForFunction(() => (window as unknown as Fixture).state.decisions.length === 1);
    expect(await page.evaluate(() => (window as unknown as Fixture).state.decisions)).toEqual([choice]);
    await page.evaluate(({ choice, other }) => (window as unknown as Fixture).emit("done", { decisions: [other, choice, { action: "BUY" }], citations: [] }), { choice, other });
    await page.waitForFunction(() => (window as unknown as Fixture).state.status === "done");
    expect(await page.evaluate(() => (window as unknown as Fixture).state.decisions)).toEqual([choice]);
    await page.evaluate(() => (window as unknown as Fixture).stream.close());
  } finally { await browser.close(); }
}, 20_000);

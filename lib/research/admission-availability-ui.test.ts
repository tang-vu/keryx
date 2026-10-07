import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{AskForm}from'./components/keryx/ask-form';
    import{useAskStream}from'./lib/hooks/use-ask-stream';
    import{McpIntegrationClient}from'./app/integrations/mcp/mcp-integration-client';
    import{EmbedClient}from'./app/embed/embed-client';
    window.asks=[];window.nextAvailability=new URLSearchParams(location.search).get('held')==='1'?'paused':'not-paused';
    window.fetch=async(url,init)=>{
      if(url==='/api/research/availability')return Response.json({state:window.nextAvailability,message:'private operator instruction'});
      if(url==='/api/models')return Response.json({models:[]});
      if(url==='/api/metrics'){if(new URLSearchParams(location.search).get('metrics')==='fail')throw Error('Synthetic metrics unavailable');return Response.json({metrics:{}});}
      if(url==='/mcp?client=other')return Response.json({result:{serverInfo:{name:'keryx',version:'0.3.3'}}});
      if(url==='/api/ask'){window.asks.push(JSON.parse(init.body));const refused=Response.json({error:'research_paused',message:'private operator instruction'},{status:503});
        return new URLSearchParams(location.search).get('slow')==='1'?new Promise(resolve=>{window.finishAsk=()=>resolve(refused);}):refused;}
      throw Error('Unexpected synthetic endpoint '+url);
    };
    function Composer(){const{state,ask}=useAskStream();const[request,setRequest]=useState(null);
      return <><p data-testid='turn-error'>{state.error}</p><AskForm clearOnSubmit
        restoreQuestion={state.errorKind==='research-paused'?request:undefined}
        onAsk={(question,budget,parent,model,mode)=>{setRequest({id:1,question});void ask(question,budget,parent,model,mode);}}/></>;}
    createRoot(document.getElementById('root')).render(location.pathname==='/mcp'?<McpIntegrationClient/>:
      location.pathname==='/embed'?<EmbedClient/>:<Composer/>);
  ` }, plugins: [{ name: "shell-fixture", setup(builder) {
    builder.onResolve({ filter: /\/site-(header|footer)$/ }, () => ({ path: "shell", namespace: "fixture" }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "link"
      ? "export default function Link({children,...props}){return <a {...props}>{children}</a>}"
      : args.path === "navigation" ? "export function useSearchParams(){return new URLSearchParams(location.search)}"
      : "export function SiteHeader(){return <header/>} export function SiteFooter(){return <footer/>}" }));
  } }], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: {
    "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x3333333333333333333333333333333333333333"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
  } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

async function mount(path: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto(`https://availability.test${path}`);
  await page.addScriptTag({ content: bundle });
  return { context, page };
}
async function asks(page: Page) { return page.evaluate(() => (window as unknown as { asks: unknown[] }).asks); }

it("shows a held composer before submission, preserves shared prefill and never dispatches run=1", async () => {
  const { context, page } = await mount("/?held=1&run=1&q=Read%20original%20SQLite%20documentation&budget=0");
  try {
    await page.getByRole("button", { name: "Research paused", exact: true }).waitFor();
    expect(await page.getByLabel("What do you want to know?").inputValue()).toBe("Read original SQLite documentation");
    expect(await page.getByRole("button", { name: "Research paused", exact: true }).isDisabled()).toBe(true);
    await page.getByLabel("What do you want to know?").press("Control+Enter");
    expect(await asks(page)).toEqual([]);
    expect(await page.getByRole("status").textContent()).toContain("Increasing the source budget");
    expect(await page.locator("body").textContent()).not.toContain("private operator instruction");
  } finally { await context.close(); }
});

it("restores the original question after a raced hold and makes refresh read-only", async () => {
  const { context, page } = await mount("/");
  try {
    await page.getByLabel("What do you want to know?").fill("Read original SQLite documentation");
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.getByRole("button", { name: "Research paused", exact: true }).waitFor();
    await page.waitForFunction(() => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value === "Read original SQLite documentation");
    expect(await asks(page)).toHaveLength(1);
    expect(await page.getByTestId("turn-error").textContent()).toContain("temporarily paused");
    await page.getByRole("button", { name: "Check availability", exact: true }).click();
    await page.waitForFunction(() => !(document.querySelector('[data-tour="dispatch-btn"]') as HTMLButtonElement)?.disabled);
    expect(await asks(page)).toHaveLength(1);
    expect(await page.getByLabel("What do you want to know?").inputValue()).toBe("Read original SQLite documentation");
    expect(await page.getByTestId("turn-error").textContent()).toContain("temporarily paused");
  } finally { await context.close(); }
});

it("keeps MCP protocol connectivity successful while clearly showing research paused", async () => {
  const { context, page } = await mount("/mcp?held=1&metrics=fail");
  try {
    await page.getByText("MCP endpoint connected", { exact: true }).waitFor();
    await page.getByRole("status").filter({ hasText: "temporarily paused" }).waitFor();
    expect(await page.locator("body").textContent()).toContain("four tools");
    expect(await page.locator("body").textContent()).not.toContain("Keryx is ready");
    expect(await asks(page)).toEqual([]);
  } finally { await context.close(); }
});

it("runs an explicitly requested shared question only once after an unpaused observation", async () => {
  const { context, page } = await mount("/?run=1&q=Read%20original%20SQLite%20documentation&budget=0");
  try {
    await page.getByRole("button", { name: "Research paused", exact: true }).waitFor();
    await page.waitForFunction(() => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value === "Read original SQLite documentation");
    expect(await asks(page)).toEqual([expect.objectContaining({ question: "Read original SQLite documentation", budget: 0 })]);
  } finally { await context.close(); }
});

it("allows a manual embed recheck to release only its UI rejection latch, retaining the question and error", async () => {
  const { context, page } = await mount("/embed");
  try {
    await page.getByPlaceholder("Ask a question…").fill("Read original SQLite documentation");
    await page.getByRole("button", { name: "Ask ▸", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { asks: unknown[] }).asks.length === 1);
    await page.getByRole("status").filter({ hasText: "temporarily paused" }).waitFor();
    expect(await page.getByRole("button", { name: "Ask ▸", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Check availability", exact: true }).click();
    await page.waitForFunction(() => !(document.querySelector('button[type="submit"]') as HTMLButtonElement)?.disabled);
    expect(await asks(page)).toHaveLength(1);
    expect(await page.getByPlaceholder("Ask a question…").inputValue()).toBe("Read original SQLite documentation");
    expect(await page.locator("body").textContent()).toContain("temporarily paused");
  } finally { await context.close(); }
});

it("does not dismiss a future embed rejection through a recheck during its in-flight request", async () => {
  const { context, page } = await mount("/embed?slow=1");
  try {
    await page.getByPlaceholder("Ask a question…").fill("Read original SQLite documentation");
    await page.getByRole("button", { name: "Ask ▸", exact: true }).click();
    await page.waitForFunction(() => typeof (window as unknown as { finishAsk?: unknown }).finishAsk === "function");
    await page.getByRole("button", { name: "Check availability", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "No global research pause" }).waitFor();
    await page.evaluate(() => (window as unknown as { finishAsk(): void }).finishAsk());
    await page.getByRole("status").filter({ hasText: "temporarily paused" }).waitFor();
    expect(await page.getByRole("button", { name: "Ask ▸", exact: true }).isDisabled()).toBe(true);
    expect(await asks(page)).toHaveLength(1);
    expect(await page.getByPlaceholder("Ask a question…").inputValue()).toBe("Read original SQLite documentation");
  } finally { await context.close(); }
});

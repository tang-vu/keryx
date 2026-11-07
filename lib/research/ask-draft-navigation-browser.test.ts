import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { createMessages } from "../i18n/messages";

const secret = "PRIVATE unsent question 71b9: preserve these exact bytes \u{1f600}";
const owner = `0x${"a".repeat(40)}`;
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{AskForm}from'./components/keryx/ask-form';
    const p=new URLSearchParams(location.search);window.actions=[];
    function Fixture(){const[restore,setRestore]=useState();window.restoreDraft=()=>setRestore({id:1,question:${JSON.stringify(secret)},budget:0.025,
      researchPaused:false,replace:true,expectedWallet:p.get('visibility')==='private'?${JSON.stringify(owner)}:null,expectedRevision:0});
      return <AskForm clearOnSubmit={!p.has('keep')} restoreQuestion={restore}
        onAsk={(...args)=>{window.actions.push(args);if(p.has('restore'))setTimeout(()=>window.restoreDraft(),0);}}/>;}
    const root=createRoot(document.getElementById('root'));root.render(<Fixture/>);window.unmountForm=()=>root.unmount();
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: {
    "process.env": "{}", "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x3333333333333333333333333333333333333333"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
  } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

async function mount(parameters = "visibility=public") {
  const context = await browser.newContext();
  let wallet: string | null = parameters.includes("visibility=private") ? owner : null;
  let holdVisibility = parameters.includes("hold=1"), releaseVisibility: (() => Promise<void>) | undefined;
  const urls: string[] = [], errors: string[] = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url()); urls.push(url.href);
    if (url.pathname === "/api/ask/visibility") {
      const fulfill = () => route.fulfill({ json: { wallet,
        defaultVisibility: parameters.includes("visibility=private") ? "private" : "public", privacyActive: true } });
      if (holdVisibility) { holdVisibility = false; releaseVisibility = fulfill; return; }
      return fulfill();
    }
    if (url.pathname === "/api/models") return route.fulfill({ json: { models: [] } });
    if (url.pathname === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
    if (url.pathname.startsWith("/api/")) throw new Error(`Unexpected request: ${url.pathname}`);
    return route.fulfill({ contentType: "text/html", body: url.pathname === "/destination" ? "<h1>Destination</h1>" :
      '<div id="root"></div><a id="leave" href="/destination"><span>Leave</span></a><a id="same" href="#section">Same document</a>' });
  });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`https://ask-draft.test/?${parameters}`);
  await page.addScriptTag({ content: bundle });
  await page.getByLabel("What do you want to know?").waitFor();
  return { context, page, urls, errors, setOwner: (next: string | null) => { wallet = next; },
    holdNextVisibility: () => { holdVisibility = true; }, releaseVisibility: () => releaseVisibility?.() };
}
const warns = (page: Page) => page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
const actions = (page: Page) => page.evaluate(() => Reflect.get(window, "actions") as unknown[]);

it.each(["public", "private"])("protects typed %s questions without putting their text in URLs or storage", async visibility => {
  const { context, page, urls, errors } = await mount(`visibility=${visibility}`);
  try {
    expect(await warns(page)).toBe(false);
    await page.getByLabel("What do you want to know?").fill(secret);
    expect(await warns(page)).toBe(true);
    expect(await actions(page)).toEqual([]);
    expect(urls.join(" ")).not.toContain("71b9");
    expect(page.url()).not.toContain("71b9");
    const storage = await page.evaluate(() => [localStorage, sessionStorage].flatMap(store => Object.keys(store).map(key => store.getItem(key))).join(" "));
    expect(storage).not.toContain("71b9"); expect(errors).toEqual([]);
  } finally { await context.close(); }
});

it.each(["public", "private"])("keeps a %s draft after cancelled internal navigation", async visibility => {
  const { context, page } = await mount(`visibility=${visibility}`);
  try {
    await page.getByLabel("What do you want to know?").fill(secret);
    const prompts: string[] = [];
    page.on("dialog", async dialog => { prompts.push(dialog.message()); await dialog.dismiss(); });
    await page.locator("#leave span").click();
    expect(await page.getByLabel("What do you want to know?").count()).toBe(1);
    expect(await page.getByLabel("What do you want to know?").inputValue()).toBe(secret);
    expect(prompts).toEqual([createMessages("en")("unsavedNavigation.confirm")]);
    expect(prompts.join(" ")).not.toContain("71b9");
    expect(await actions(page)).toEqual([]);
  } finally { await context.close(); }
});

it("confirms an accepted native departure once without a second unload prompt", async () => {
  const { context, page } = await mount();
  try {
    await page.getByLabel("What do you want to know?").fill(secret);
    const dialogs: string[] = [];
    page.on("dialog", async dialog => { dialogs.push(dialog.type()); await dialog.accept(); });
    await page.locator("#leave").click();
    await page.waitForURL("https://ask-draft.test/destination");
    expect(await page.getByRole("heading").textContent()).toBe("Destination");
    expect(dialogs).toEqual(["confirm"]);
  } finally { await context.close(); }
});

it("cancels a real native reload and retains the exact unsubmitted question", async () => {
  const { context, page } = await mount("visibility=private");
  try {
    await page.getByLabel("What do you want to know?").fill(secret);
    const dialog = page.waitForEvent("dialog"), reloaded = page.reload().then(() => "loaded", () => "cancelled");
    const prompt = await dialog;
    expect(prompt.type()).toBe("beforeunload"); await prompt.dismiss();
    expect(await reloaded).toBe("cancelled");
    expect(await page.getByLabel("What do you want to know?").inputValue()).toBe(secret);
    expect(await actions(page)).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it.each([false, true])("disarms after submission with retained question=%s and rearms on another edit", async keep => {
  const { context, page } = await mount(keep ? "keep=1" : "");
  try {
    await page.getByLabel("What do you want to know?").fill(secret);
    expect(await warns(page)).toBe(true);
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    expect(await actions(page)).toHaveLength(1);
    expect(await page.getByLabel("What do you want to know?").inputValue()).toBe(keep ? secret : "");
    expect(await warns(page)).toBe(false);
    await page.getByLabel("What do you want to know?").fill("Another unsubmitted draft.");
    expect(await warns(page)).toBe(true);
    await page.getByLabel("What do you want to know?").fill(" \n ");
    expect(await warns(page)).toBe(false);
  } finally { await context.close(); }
});

it("protects an explicitly restored draft after a rejected submission without another Ask", async () => {
  const { context, page } = await mount("visibility=private&restore=1");
  try {
    await page.getByLabel("What do you want to know?").fill(secret);
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.waitForFunction(question => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value === question, secret);
    expect(await warns(page)).toBe(true);
    expect(await actions(page)).toHaveLength(1);
  } finally { await context.close(); }
});

it("clears the guard on an owner boundary and protects only the next owner's new draft", async () => {
  const { context, page, setOwner } = await mount("visibility=private");
  try {
    await page.getByLabel("What do you want to know?").fill(secret);
    expect(await warns(page)).toBe(true);
    setOwner(`0x${"b".repeat(40)}`);
    await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === "/api/ask/visibility"), page.evaluate(() => window.dispatchEvent(new Event("focus")))]);
    await page.waitForFunction(() => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value === "");
    expect(await warns(page)).toBe(false);
    await page.getByLabel("What do you want to know?").fill("New owner's question.");
    expect(await warns(page)).toBe(true);
    expect(await actions(page)).toEqual([]);
  } finally { await context.close(); }
});

it("retains generic unload protection while rechecking the same private owner", async () => {
  const { context, page, holdNextVisibility, releaseVisibility } = await mount("visibility=private");
  try {
    await page.getByLabel("What do you want to know?").fill(secret);
    await page.waitForFunction(() => !(document.querySelector('[data-tour="dispatch-btn"]') as HTMLButtonElement)?.disabled);
    holdNextVisibility();
    await Promise.all([page.waitForRequest(request => new URL(request.url()).pathname === "/api/ask/visibility"), page.evaluate(() => window.dispatchEvent(new Event("focus")))]);
    await page.waitForFunction(() => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value === "");
    expect(await warns(page)).toBe(true);
    expect(await actions(page)).toEqual([]);
    await releaseVisibility();
    await page.waitForFunction(question => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value === question, secret);
    expect(await warns(page)).toBe(true);
  } finally { await context.close(); }
});

it("protects editing before the first owner context is ready and keeps protection after binding", async () => {
  const { context, page, releaseVisibility } = await mount("visibility=private&hold=1");
  try {
    await page.getByLabel("What do you want to know?").fill(secret);
    expect(await warns(page)).toBe(true);
    expect(await actions(page)).toEqual([]);
    await releaseVisibility();
    await page.waitForFunction(() => !(document.querySelector('[data-tour="dispatch-btn"]') as HTMLButtonElement)?.disabled);
    expect(await page.getByLabel("What do you want to know?").inputValue()).toBe(secret);
    expect(await warns(page)).toBe(true);
  } finally { await context.close(); }
});

it("leaves an untouched shared-link prefill clean and protects its first edit", async () => {
  const { context, page } = await mount("q=Public%20link%20prefill");
  try {
    await page.waitForFunction(() => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value === "Public link prefill");
    expect(await warns(page)).toBe(false);
    await page.getByLabel("What do you want to know?").fill("Edited public link prefill.");
    expect(await warns(page)).toBe(true);
    expect(await actions(page)).toEqual([]);
  } finally { await context.close(); }
});

it("keeps same-document links and unmount cleanup consistent with the shared guard", async () => {
  const { context, page } = await mount();
  try {
    await page.getByLabel("What do you want to know?").fill(secret);
    let dialogs = 0;
    page.on("dialog", async dialog => { dialogs++; await dialog.dismiss(); });
    await page.locator("#same").click();
    expect(dialogs).toBe(0); expect(await warns(page)).toBe(true);
    await page.evaluate(() => Reflect.get(window, "unmountForm")());
    expect(await warns(page)).toBe(false);
  } finally { await context.close(); }
});

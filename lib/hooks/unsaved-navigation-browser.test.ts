import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { createMessages } from "../i18n/messages";
import { previewMessage } from "../i18n/ui-preview";
import { loadUiPreview } from "../i18n/ui-preview-catalogues";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState,StrictMode}from'react';import{createRoot}from'react-dom/client';
    import{useUnsavedNavigation}from'./lib/hooks/use-unsaved-navigation';
    function Editor(){const[value,setValue]=useState('');useUnsavedNavigation(!!value);
      return <input aria-label="Private input" value={value} onChange={e=>setValue(e.target.value)}/>}
    const root=createRoot(document.getElementById('root'));root.render(<StrictMode><Editor/><Editor/></StrictMode>);
    window.unmountEditors=()=>root.unmount();
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  const errors: string[] = [];
  try {
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== "https://navigation.test") return route.abort();
      return route.fulfill({ contentType: "text/html", body: url.pathname === "/" ?
        '<div id="root"></div><a id="leave" href="/destination"><span>Leave</span></a>' : '<h1>Destination</h1>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://navigation.test/"); await page.addScriptTag({ content: bundle });
    await page.getByLabel("Private input").first().fill("PRIVATE unsaved first input");
    await page.getByLabel("Private input").nth(1).fill("PRIVATE unsaved second input");
    await run(page); expect(errors).toEqual([]);
  } finally { await context.close(); }
}
const warns = (page: Page) => page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));

it("confirms a native link once and reaches the actual destination without a second unload dialog", () => fixture(async page => {
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.type()); await dialog.accept(); });
  await page.locator("#leave span").click(); await page.waitForURL("https://navigation.test/destination");
  expect(await page.getByRole("heading").textContent()).toBe("Destination"); expect(dialogs).toEqual(["confirm"]);
}));

it("restores reload protection after an accepted client navigation is prevented, including StrictMode cleanup", () => fixture(async page => {
  await page.evaluate(() => document.querySelector("#leave")!.addEventListener("click", event => event.preventDefault()));
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.type()); await dialog.accept(); });
  await page.locator("#leave").click();
  await expect.poll(() => warns(page)).toBe(true); expect(dialogs).toEqual(["confirm"]);
  await page.getByLabel("Private input").first().fill(""); expect(await warns(page)).toBe(true);
  await page.getByLabel("Private input").nth(1).fill(""); await expect.poll(() => warns(page)).toBe(false);
  await page.locator("#leave").click(); expect(dialogs).toEqual(["confirm"]);
  await page.getByLabel("Private input").first().fill("PRIVATE again"); expect(await warns(page)).toBe(true);
  await page.evaluate(() => (window as unknown as { unmountEditors(): void }).unmountEditors());
  expect(await warns(page)).toBe(false);
}));

it("blocks client navigation when confirmation is unavailable and keeps exact input", () => fixture(async page => {
  await page.evaluate(() => {
    window.confirm = () => { throw new Error("Synthetic prompt refusal"); };
    document.querySelector("#leave")!.addEventListener("click", event => {
      event.preventDefault(); document.body.dataset.left = "true";
    });
  });
  await page.locator("#leave").click();
  expect(await page.locator("body").getAttribute("data-left")).toBeNull();
  expect(await page.getByLabel("Private input").first().inputValue()).toBe("PRIVATE unsaved first input");
  expect(await warns(page)).toBe(true);
}));

it("leaves modified, non-self, download, same-document, external and already-cancelled clicks alone", () => fixture(async page => {
  const result = await page.evaluate(() => {
    const prompts: string[] = []; window.confirm = message => { prompts.push(message); return false; };
    const dispatch = (href: string, attributes: Record<string, string> = {}, init: MouseEventInit = {}, cancelled = false) => {
      const link = document.createElement("a"); link.href = href;
      for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value);
      document.body.append(link);
      // Record the guard result at target, then suppress the browser's actual default.
      let reached = false, blocked = false;
      link.addEventListener("click", event => { reached = true; blocked = event.defaultPrevented; event.preventDefault(); });
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
      if (cancelled) event.preventDefault();
      link.dispatchEvent(event); link.remove(); return { reached, blocked };
    };
    const modifiers: MouseEventInit[] = [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }];
    const cases = [dispatch("#section"), dispatch("/", {}, {}), dispatch("/destination", { target: "_blank" }),
      dispatch("/destination", { download: "backup.json" }), dispatch("https://external.test/"),
      ...modifiers.map(modifier => dispatch("/destination", {}, modifier)),
      dispatch("/destination", {}, { button: 1 }), dispatch("/destination", {}, {}, true)];
    const normal = dispatch("/?changed=1"); return { prompts, cases, normal };
  });
  expect(result.cases).toEqual([...Array.from({ length: 10 }, () => ({ reached: true, blocked: false })), { reached: true, blocked: true }]);
  expect(result.normal.reached).toBe(false); expect(result.prompts).toEqual([createMessages("en")("unsavedNavigation.confirm")]);
}));

it("keeps discard consent in authoritative English across every machine preview", async () => {
  const source = createMessages("en")("unsavedNavigation.confirm");
  for (const locale of ["vi", "zh-Hans", "es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const) {
    const preview = await loadUiPreview(locale);
    expect(preview.$messages).not.toHaveProperty("unsavedNavigation.confirm");
    expect(previewMessage(preview, "unsavedNavigation.confirm", source)).toBe(source);
  }
});

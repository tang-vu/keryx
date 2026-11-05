import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, webkit, type Browser, type Locator, type Page } from "playwright";

let browser: Browser, bundle: string;
const parentId = "11111111-2222-4333-8444-555555555555";

beforeAll(async () => {
  bundle = (await build({
    stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
      import React from 'react';import{createRoot}from'react-dom/client';
      import{FollowUpForm}from'./components/keryx/follow-up-form';
      import{FeedMatchForm}from'./components/keryx/feed-match-form';
      import{AskForm}from'./components/keryx/ask-form';
      window.handoffs=[];window.asks=[];
      createRoot(document.getElementById('root')).render(<>
        <FollowUpForm parentId="${parentId}"/><FeedMatchForm gapId="gap-recorded"/>
        <AskForm onAsk={(question,budget,parent,model,mode,scholarly,paid,review,publication)=>window.asks.push({question,budget,publication})}/>
      </>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) },
    plugins: [{ name: "question-navigation-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(),
        contents: args.path === "next/navigation"
          ? "export function useRouter(){return{push(href){window.handoffs.push(href)}}}"
          : "export default function Link(props){return <a {...props}/>}" }));
    } }],
  })).outputFiles[0].text;
  browser = await (process.env.KERYX_UX_BROWSER === "webkit" ? webkit : chromium).launch({ headless: true });
});
afterAll(async () => { await browser?.close(); });

type HandoffWindow = Window & { handoffs: string[]; asks: unknown[] };
async function fixture(run: (page: Page, posts: unknown[]) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [], diagnostics: string[] = [], posts: unknown[] = [];
  try {
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      expect(url.origin).toBe("https://composition.test");
      if (url.pathname === "/api/models") return route.fulfill({ json: { models: [] } });
      if (url.pathname === "/api/ask/visibility") return route.fulfill({ json: { wallet: null, defaultVisibility: "public", privacyActive: true } });
      if (url.pathname === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
      if (url.pathname === "/api/wanted/match") {
        expect(request.method()).toBe("POST");
        posts.push(request.postDataJSON());
        return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ message: "Fixture response" }) });
      }
      expect(request.method()).toBe("GET"); expect(url.pathname).toBe("/");
      return route.fulfill({ contentType: "text/html", body: '<meta charset="utf-8"><div id="root"></div>' });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") diagnostics.push(message.text()); });
    await page.goto("https://composition.test/");
    await page.addScriptTag({ content: bundle });
    await page.locator("#follow-up").waitFor().catch(error => { throw new Error(`${[...errors, ...diagnostics].join("; ")}: ${error.message}`); });
    await run(page, posts);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}

async function enter(input: Locator, composing: boolean, modifier: "ctrlKey" | "metaKey" | "none" = "none", keyCode = 13) {
  return input.evaluate((node, args) => node.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", bubbles: true, cancelable: true, isComposing: args.composing,
    ctrlKey: args.modifier === "ctrlKey", metaKey: args.modifier === "metaKey",
    keyCode: args.keyCode,
  })), { composing, modifier, keyCode });
}

const compositionCases = [{ composing: true, keyCode: 13, phase: "active" }, { composing: false, keyCode: 229, phase: "IME boundary" }];
const shortcuts = compositionCases.flatMap(composition => (["ctrlKey", "metaKey"] as const).map(modifier => ({ ...composition, modifier })));

it.each(shortcuts)("does not hand off a follow-up at $phase ($modifier+Enter)", async ({ composing, keyCode, modifier }) => {
  await fixture(async (page, posts) => {
    const question = page.locator("#follow-up");
    await question.fill("入力中 · Đang chọn chữ");
    await question.dispatchEvent("compositionstart", { data: "入力" });
    if (!composing) await question.dispatchEvent("compositionend", { data: "入力" });
    expect(await enter(question, composing, modifier, keyCode), "IME retains the default Enter action").toBe(true);
    expect(await page.evaluate(() => (window as HandoffWindow).handoffs)).toEqual([]);
    expect(posts).toEqual([]);
    expect(await question.inputValue()).toBe("入力中 · Đang chọn chữ");
    await question.dispatchEvent("compositionend", { data: "入力完了" });
    const completed = "入力完了 · Điều gì & tại sao? # hỏi tiếp";
    await question.fill(completed);
    expect(await enter(question, false, modifier), "An accepted shortcut consumes Enter").toBe(false);
    const handoffs = await page.evaluate(() => (window as HandoffWindow).handoffs);
    expect(handoffs).toHaveLength(1);
    const target = new URL(handoffs[0], page.url());
    expect(target.pathname).toBe("/");
    expect(Object.fromEntries(target.searchParams)).toEqual({ q: completed, parent: parentId, run: "1" });
    expect(await question.inputValue()).toBe(completed);
    expect(posts).toEqual([]);
  });
});

it("keeps plain Enter as a newline and the deliberate button handoff unchanged", async () => {
  await fixture(async page => {
    const question = page.locator("#follow-up");
    await question.fill("First line");
    await question.press("End"); await question.press("Enter");
    expect(await question.inputValue()).toBe("First line\n");
    expect(await page.evaluate(() => (window as HandoffWindow).handoffs)).toEqual([]);
    const button = page.locator("#follow-up").locator("..").getByRole("button");
    await question.fill(" "); expect(await button.isDisabled()).toBe(true);
    await question.fill("Q".repeat(500));
    expect(await question.getAttribute("maxlength")).toBe("500");
    await button.click();
    const handoffs = await page.evaluate(() => (window as HandoffWindow).handoffs);
    expect(handoffs).toHaveLength(1);
    expect(new URL(handoffs[0], page.url()).searchParams.get("q")).toBe("Q".repeat(500));
  });
});

it.each(compositionCases)("does not send a feed-check request for $phase Enter, then accepts a completed Enter", async ({ composing, keyCode }) => {
  await fixture(async (page, posts) => {
    const input = page.locator("#feed-check");
    await input.fill("https://publisher.test/入力.xml");
    await input.dispatchEvent("compositionstart", { data: "入力" });
    if (!composing) await input.dispatchEvent("compositionend", { data: "入力" });
    expect(await enter(input, composing, "none", keyCode)).toBe(true);
    expect(posts).toEqual([]);
    await input.dispatchEvent("compositionend", { data: "入力完了" });
    const completed = "https://publisher.test/入力完了.xml";
    await input.fill(completed);
    expect(await enter(input, false)).toBe(false);
    await page.getByText("Fixture response", { exact: true }).waitFor();
    expect(posts).toEqual([{ rssUrl: completed, gapId: "gap-recorded" }]);
    expect(await input.inputValue()).toBe(completed);
    expect(await page.evaluate(() => (window as HandoffWindow).handoffs)).toEqual([]);
  });
});

it.each(shortcuts)("keeps the primary composer safe at $phase with $modifier+Enter", async ({ composing, keyCode, modifier }) => {
  await fixture(async (page, posts) => {
    const input = page.locator("#ask-question"), button = page.locator('[data-tour="dispatch-btn"]');
    const completed = "日本語 · So sánh các nguồn đã đọc";
    await input.fill(completed);
    await expect.poll(() => button.isEnabled()).toBe(true);
    await input.dispatchEvent("compositionstart", { data: "日本語" });
    if (!composing) await input.dispatchEvent("compositionend", { data: "日本語" });
    expect(await enter(input, composing, modifier, keyCode)).toBe(true);
    expect(await page.evaluate(() => (window as HandoffWindow).asks)).toEqual([]);
    expect(await input.inputValue()).toBe(completed);
    await input.dispatchEvent("compositionend", { data: "日本語" });
    expect(await enter(input, false, modifier)).toBe(false);
    expect(await page.evaluate(() => (window as HandoffWindow).asks)).toEqual([
      { question: completed, budget: 0.05, publication: { visibility: "public", expectedWallet: null } },
    ]);
    expect(posts).toEqual([]);
  });
});

it("keeps the feed-check button and blank-input guard usable", async () => {
  await fixture(async (page, posts) => {
    const input = page.locator("#feed-check"), button = input.locator("..").locator("..").getByRole("button");
    await input.fill(" "); expect(await button.isDisabled()).toBe(true);
    await input.fill("  https://publisher.test/feed.xml  ");
    await button.click();
    await page.getByText("Fixture response", { exact: true }).waitFor();
    expect(posts).toEqual([{ rssUrl: "https://publisher.test/feed.xml", gapId: "gap-recorded" }]);
    expect(await button.isEnabled()).toBe(true);
  });
});

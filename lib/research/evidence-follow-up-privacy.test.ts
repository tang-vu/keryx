import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { AnswerCard } from "../../components/keryx/answer-card";
import type { QueryRun } from "../types";
import { privateDocumentBootstrap } from "../run-claims/web-bootstrap";

const run: QueryRun = { id: "11111111-1111-4111-8111-111111111111", question: "PRIVATE-QUESTION-7f2a",
  subClaims: ["PRIVATE-TARGET-91bd"], answer: "Retained answer with an unresolved target.",
  citations: [], decisions: [], evidence: [], claimCoverage: [], trace: [],
  budget: 0.025, totalSpent: 0, totalToCreators: 0, createdAt: "2026-11-07T00:00:00Z", engine: "fixture" };

it.each(["private", "unlisted"] as const)("does not place a %s report's question or target in follow-up URLs", visibility => {
  const html = renderToStaticMarkup(createElement(AnswerCard, { run,
    meta: { visibility, visibilityOwner: `0x${"a".repeat(40)}`, mode: "offline", engine: "fixture" }, showFeedback: false }));
  const followUpUrls = [...html.matchAll(/href="([^"]+)"/g)]
    .map(match => new URL(match[1].replaceAll("&amp;", "&"), "https://keryx.test"))
    .filter(url => url.searchParams.has("q") || url.href.includes(run.question) || url.href.includes(run.subClaims[0]));
  expect(followUpUrls.map(url => url.href)).toEqual([]);
});

it.each(["private", "unlisted"] as const)("refuses a public-link hint overridden by %s stream metadata", visibility => {
  const html = renderToStaticMarkup(createElement(AnswerCard, { run, publicFollowUp: true,
    meta: { visibility, mode: "offline", engine: "fixture" }, showFeedback: false }));
  expect(html).not.toContain("?q=");
});

it("requires an explicit public context before producing an editable URL", () => {
  const unknown = renderToStaticMarkup(createElement(AnswerCard, { run, meta: null, showFeedback: false }));
  expect(unknown).not.toContain("?q=");
  const known = renderToStaticMarkup(createElement(AnswerCard, { run, meta: null, publicFollowUp: true, showFeedback: false }));
  expect(known).toContain("?q=");
});

const owner = `0x${"a".repeat(40)}`;
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{ResearchChat}from'./components/keryx/research-chat';
    import{DispatchView}from'./app/dispatch/[id]/dispatch-view';
    const p=new URLSearchParams(location.search),run=${JSON.stringify(run)};
    const root=createRoot(document.getElementById('root'));
    window.showPublicReport=()=>root.render(<DispatchView run={{...run,id:'33333333-3333-4333-8333-333333333333',question:'PUBLIC QUESTION',subClaims:['PUBLIC TARGET'],answer:'PUBLIC ANSWER'}} payments={[]} visibility="public"/>);
    root.render(location.pathname==='/saved'
      ?<DispatchView run={run} payments={[]} visibility={p.get('visibility')} recoveryWallet=${JSON.stringify(owner)}/>
      :<ResearchChat privateClaims={location.pathname==='/research/private'}/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: {
    "process.env": "{}", "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x3333333333333333333333333333333333333333"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
  }, plugins: [{ name: "unrelated-report-boundaries", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    const names: Record<string, string> = { "wallet-menu": "WalletMenu", "dispatch-wire": "DispatchWire",
      "session-grant-panel": "SessionGrantPanel", "landing-visit": "LandingVisit", "onboarding-tour": "OnboardingTour",
      "globe-watermark": "GlobeWatermark", "creators-paid-panel": "CreatorsPaidPanel", "reasoning-console": "ReasoningConsole",
      "report-actions": "ReportActions", "decision-reviews": "DecisionReviews", "read-checkpoint-verify": "ReadCheckpointVerify",
      "answer-feedback": "AnswerFeedback", "requester-feedback": "RequesterFeedback" };
    builder.onResolve({ filter: /\/(wallet-menu|dispatch-wire|session-grant-panel|landing-visit|onboarding-tour|globe-watermark|creators-paid-panel|reasoning-console|report-actions|decision-reviews|read-checkpoint-verify|answer-feedback|requester-feedback)$/ }, args => ({ path: args.path.split("/").at(-1)!, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
      args.path === "link" ? "export const useLinkStatus=()=>({pending:false});export default function Link({prefetch,onNavigate,...props}){return <a {...props}/>}"
        : args.path === "navigation" ? "export const usePathname=()=>location.pathname;"
          : `export function ${names[args.path]}(){return null;}` }));
  } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

async function mount(path: "/saved" | "/live" | "/research/private", visibility: "private" | "unlisted" | "public", holdSecond = false) {
  const context = await browser.newContext();
  let wallet: string | null = path === "/research/private" ? null : owner;
  const asks: Array<{ body: Record<string, unknown>; wallet?: string; document?: string }> = [], urls: string[] = [];
  let releasePending: (() => Promise<void>) | undefined;
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url()); urls.push(request.url());
    if (url.pathname === "/api/ask/visibility") return route.fulfill({ json: { wallet, defaultVisibility: visibility, privacyActive: true } });
    if (url.pathname === "/api/models") return route.fulfill({ json: { models: [] } });
    if (url.pathname === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
    if (url.pathname === "/api/sources") return route.fulfill({ json: { sources: [] } });
    if (url.pathname === "/api/metrics") return route.fulfill({ json: { metrics: {}, recentPayments: [] } });
    if (url.pathname === "/api/ask") {
      const body = request.postDataJSON(); asks.push({ body, wallet: request.headers()["x-keryx-expected-wallet"], document: request.headers()["x-keryx-private-document"] });
      const digit = String(asks.length), result = { ...run, question: body.question, budget: body.budget,
        id: `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}` };
      const claim = path === "/research/private" ? `event: private-run-claim\ndata: ${JSON.stringify({ version: 1, runId: result.id, status: "available",
        delivery: { version: 1, claimUrl: `https://evidence-follow-up.test/claim-run#${"f".repeat(64)}`, expiresAt: new Date(Date.now() + 60000).toISOString() } })}\n\n` : "";
      const fulfill = () => route.fulfill({ contentType: "text/event-stream", body:
        `event: meta\ndata: ${JSON.stringify({ mode: "offline", engine: "fixture", visibility: body.visibility, visibilityOwner: wallet })}\n\nevent: done\ndata: ${JSON.stringify(result)}\n\n${claim}` });
      if (holdSecond && asks.length === 2) { releasePending = fulfill; return; }
      return fulfill();
    }
    if (url.pathname.startsWith("/api/")) throw new Error(`Unexpected request: ${url.pathname}`);
    const bootstrap = path === "/research/private" ? `<script nonce="fixture-nonce">${privateDocumentBootstrap(`fixture.${"x".repeat(43)}`, "fixture-nonce")}</script>` : "";
    return route.fulfill({ contentType: "text/html", body: `${bootstrap}<div id="root"></div>` });
  });
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  await page.goto(`https://evidence-follow-up.test${path}?visibility=${visibility}`);
  await page.addScriptTag({ content: bundle });
  if (path !== "/saved") {
    await page.getByLabel("What do you want to know?").fill(run.question);
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
  }
  await page.getByText(run.answer, { exact: true }).waitFor();
  return { context, page, asks, urls, setOwner: (value: string) => { wallet = value; }, releasePending: () => releasePending?.() };
}

for (const path of ["/saved", "/live"] as const) for (const visibility of ["private", "unlisted"] as const) {
  it(`${path} ${visibility}: prepares an editable scoped draft without URL/storage writes or an automatic ask`, async () => {
    const { context, page, asks, urls } = await mount(path, visibility);
    try {
      const originalUrl = page.url(), initialAsks = asks.length;
      await page.getByText("Inspect targets and prepare a follow-up", { exact: true }).click();
      await page.getByRole("button", { name: /Prepare follow-up/ }).first().click();
      const input = page.getByLabel("What do you want to know?");
      await page.waitForFunction(target => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value.includes(target), run.subClaims[0]);
      expect(await input.inputValue()).toContain(run.question);
      expect(asks).toHaveLength(initialAsks);
      expect(page.url()).toBe(originalUrl);
      expect(urls.some(url => url.includes(run.question) || url.includes(run.subClaims[0]) || new URL(url).searchParams.has("q"))).toBe(false);
      expect(await page.locator('a[href*="?q="]').count()).toBe(0);
      const storage = await page.evaluate(() => [localStorage, sessionStorage].flatMap(store => Object.keys(store).map(key => store.getItem(key))).join(" "));
      expect(storage).not.toContain(run.question); expect(storage).not.toContain(run.subClaims[0]);
      await input.fill("Explicitly edited follow-up.");
      await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
      await page.waitForFunction(count => document.querySelectorAll('[data-testid="research-turn"]').length >= count, path === "/live" ? 2 : 1);
      expect(asks).toHaveLength(initialAsks + 1);
      expect(asks.at(-1)?.body).toMatchObject({ question: "Explicitly edited follow-up.", parentId: run.id, visibility });
      expect(asks.at(-1)?.wallet).toBe(owner);
    } finally { await context.close(); }
  }, 15000);
}

it("a live hidden target draft is cleared when the confirmed owner changes", async () => {
  const { context, page, asks, setOwner } = await mount("/live", "private");
  try {
    await page.getByText("Inspect targets and prepare a follow-up", { exact: true }).click();
    await page.getByRole("button", { name: /Prepare follow-up/ }).first().click();
    await page.waitForFunction(target => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value.includes(target), run.subClaims[0]);
    setOwner(`0x${"b".repeat(40)}`);
    await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === "/api/ask/visibility"), page.evaluate(() => window.dispatchEvent(new Event("focus")))]);
    await page.waitForFunction(() => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value === "");
    expect(await page.locator('[data-testid="research-turn"]').count()).toBe(0);
    expect(asks).toHaveLength(1);
  } finally { await context.close(); }
}, 15000);

it("retains public live follow-up links without starting another ask", async () => {
  const { context, page, asks } = await mount("/live", "public");
  try {
    await page.getByText("Inspect targets and prepare a follow-up", { exact: true }).click();
    const href = await page.getByRole("link", { name: /Prepare follow-up/ }).first().getAttribute("href");
    const url = new URL(href!, page.url());
    expect(url.searchParams.get("q")).toContain(run.question);
    expect(url.searchParams.get("q")).toContain(run.subClaims[0]);
    expect(url.searchParams.get("parent")).toBe(run.id);
    expect([...url.searchParams.keys()]).toEqual(["q", "parent"]);
    expect(asks).toHaveLength(1);
  } finally { await context.close(); }
}, 15000);

it.each(["private", "unlisted"] as const)("preserves completed saved %s follow-ups when preparing another original target", async visibility => {
  const { context, page, asks } = await mount("/saved", visibility);
  try {
    await page.getByText("Inspect targets and prepare a follow-up", { exact: true }).click();
    const originalTarget = page.getByRole("button", { name: /Prepare follow-up/ }).last();
    await originalTarget.click();
    await page.waitForFunction(() => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value.length > 0);
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.getByRole("button", { name: "New research", exact: true }).waitFor();
    await page.getByLabel("What do you want to know?").fill("Second saved follow-up stays visible.");
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="research-turn"]').length === 2);
    await page.getByRole("button", { name: "New research", exact: true }).waitFor();
    await originalTarget.click();
    await page.waitForFunction(target => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value.includes(target), run.subClaims[0]);
    expect(await page.locator('[data-testid="research-turn"]').count()).toBe(2);
    expect(await page.locator("body").innerText()).toContain("Second saved follow-up stays visible.");
    expect(asks).toHaveLength(2);
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="research-turn"]').length === 3);
    expect(asks[2].body).toMatchObject({ parentId: run.id, visibility, budget: run.budget });
    expect(asks[2].wallet).toBe(owner);
  } finally { await context.close(); }
}, 20000);

it("prepares a saved target in a composer already opened from the original question", async () => {
  const { context, page, asks } = await mount("/saved", "private");
  try {
    await page.getByRole("button", { name: "Reopen original question", exact: true }).click();
    await page.waitForFunction(question => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value === question, run.question);
    await page.getByLabel("What do you want to know?").fill("Unsubmitted replacement draft.");
    await page.getByText("Inspect targets and prepare a follow-up", { exact: true }).click();
    await page.getByRole("button", { name: /Prepare follow-up/ }).click();
    await page.waitForFunction(target => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value.includes(target), run.subClaims[0]);
    expect(await page.getByLabel("What do you want to know?").inputValue()).toContain(run.question);
    expect(asks).toEqual([]);
    expect(await page.locator('a[href*="?q="]').count()).toBe(0);
  } finally { await context.close(); }
}, 15000);

it("refuses saved-target reselection without aborting an active follow-up", async () => {
  const { context, page, asks, releasePending } = await mount("/saved", "private", true);
  try {
    await page.getByText("Inspect targets and prepare a follow-up", { exact: true }).click();
    const originalTarget = page.getByRole("button", { name: /Prepare follow-up/ }).last();
    await originalTarget.click();
    await page.waitForFunction(() => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value.length > 0);
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.getByRole("button", { name: "New research", exact: true }).waitFor();
    await page.getByLabel("What do you want to know?").fill("Active saved follow-up.");
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.getByRole("button", { name: "Stop research", exact: true }).waitFor();
    expect(await originalTarget.isDisabled()).toBe(true);
    await originalTarget.evaluate(button => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(await page.getByRole("button", { name: "Stop research", exact: true }).isVisible()).toBe(true);
    expect(asks).toHaveLength(2);
    await releasePending();
    await page.getByRole("button", { name: "New research", exact: true }).waitFor();
    expect(await originalTarget.isEnabled()).toBe(true);
    expect(await page.locator('[data-testid="research-turn"]').count()).toBe(2);
    expect(await page.locator("body").innerText()).toContain("Active saved follow-up.");
  } finally { await context.close(); }
}, 20000);

it.each(["private", "unlisted"] as const)("discards a queued replacement saved %s draft across a confirmed owner boundary", async visibility => {
  const { context, page, asks, setOwner } = await mount("/saved", visibility);
  try {
    await page.getByText("Inspect targets and prepare a follow-up", { exact: true }).click();
    const originalTarget = page.getByRole("button", { name: /Prepare follow-up/ }).last();
    await originalTarget.click();
    await page.waitForFunction(() => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value.length > 0);
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.getByRole("button", { name: "New research", exact: true }).waitFor();
    await page.evaluate(() => {
      const ordinary = window.setTimeout.bind(window), callbacks: Array<() => void> = [];
      Reflect.set(window, "heldSavedRestoreCallbacks", callbacks);
      window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay === 0 && typeof callback === "function") { callbacks.push(() => callback(...args)); return ordinary(() => {}, 0); }
        return ordinary(callback, delay, ...args);
      }) as typeof window.setTimeout;
    });
    await originalTarget.click();
    await page.waitForFunction(() => (Reflect.get(window, "heldSavedRestoreCallbacks") as unknown[]).length > 0);
    setOwner(`0x${"b".repeat(40)}`);
    await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === "/api/ask/visibility"), page.evaluate(() => window.dispatchEvent(new Event("focus")))]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="research-turn"]').length === 0);
    await page.evaluate(() => { for (const callback of Reflect.get(window, "heldSavedRestoreCallbacks") as Array<() => void>) callback(); });
    expect(await page.getByLabel("What do you want to know?").inputValue()).toBe("");
    expect(await originalTarget.isDisabled()).toBe(true);
    expect(asks).toHaveLength(1);
  } finally { await context.close(); }
}, 20000);

it("blocks hidden preparation during streaming and preserves the selected older parent afterward", async () => {
  const { context, page, asks, releasePending } = await mount("/live", "private", true);
  try {
    await page.getByText("Inspect targets and prepare a follow-up", { exact: true }).click();
    const first = page.locator('[data-testid="research-turn"]').first();
    await first.getByRole("button", { name: /Prepare follow-up/ }).click();
    await page.waitForFunction(target => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value.includes(target), run.subClaims[0]);
    await page.getByLabel("What do you want to know?").fill("Second explicit research request.");
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="research-turn"] button[disabled]'));
    await first.getByText("Inspect targets and prepare a follow-up", { exact: true }).click();
    expect(await first.getByRole("button", { name: /Prepare follow-up/ }).isDisabled()).toBe(true);
    await first.getByRole("button", { name: /Prepare follow-up/ }).evaluate(button => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(asks).toHaveLength(2);
    await releasePending();
    await first.getByRole("button", { name: /Prepare follow-up/ }).click();
    await page.waitForFunction(target => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value.includes(target), run.subClaims[0]);
    await page.getByLabel("What do you want to know?").fill("Third explicit request for the first report.");
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="research-turn"]').length >= 3);
    expect(asks).toHaveLength(3);
    expect(asks[2].body.parentId).toBe(run.id);
    expect(asks[2].body.visibility).toBe("private");
  } finally { await context.close(); }
}, 20000);

it.each(["private", "unlisted"] as const)("keeps an older %s target scoped after a newer public report and after dropping its parent", async visibility => {
  const { context, page, asks } = await mount("/live", visibility);
  try {
    await page.getByRole("button", { name: "New research", exact: true }).click();
    const visibilityPicker = page.getByTestId("research-visibility").locator("select");
    await visibilityPicker.evaluate(select => { select.closest("details")!.open = true; });
    await visibilityPicker.selectOption("public");
    await page.getByLabel("What do you want to know?").fill("New public question.");
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="research-turn"]').length === 2);
    const first = page.locator('[data-testid="research-turn"]').first();
    await first.getByText("Inspect targets and prepare a follow-up", { exact: true }).click();
    await first.getByRole("button", { name: /Prepare follow-up/ }).first().click();
    await page.waitForFunction(target => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value.includes(target), run.subClaims[0]);
    expect(await visibilityPicker.inputValue()).toBe(visibility);
    expect(asks).toHaveLength(2);
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="research-turn"]').length === 3);
    expect(asks[2].body).toMatchObject({ parentId: run.id, visibility });
    await first.getByRole("button", { name: /Prepare follow-up/ }).first().click();
    await page.waitForFunction(target => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value.includes(target), run.subClaims[0]);
    const draft = await page.getByLabel("What do you want to know?").inputValue();
    await page.getByRole("button", { name: "New research", exact: true }).click();
    expect(await page.getByLabel("What do you want to know?").inputValue()).toBe(draft);
    expect(await visibilityPicker.inputValue()).toBe(visibility);
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="research-turn"]').length === 4);
    expect(asks[3].body.visibility).toBe(visibility);
    expect(asks[3].body.parentId).toBeUndefined();
  } finally { await context.close(); }
}, 20000);

it("does not restore a queued hidden draft after an owner boundary", async () => {
  const { context, page, asks, setOwner } = await mount("/live", "private");
  try {
    await page.getByText("Inspect targets and prepare a follow-up", { exact: true }).click();
    await page.evaluate(() => {
      const ordinary = window.setTimeout.bind(window), callbacks: Array<() => void> = [];
      Reflect.set(window, "heldEvidenceRestoreCallbacks", callbacks);
      window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay === 0 && typeof callback === "function") { callbacks.push(() => callback(...args)); return ordinary(() => {}, 0); }
        return ordinary(callback, delay, ...args);
      }) as typeof window.setTimeout;
    });
    await page.getByRole("button", { name: /Prepare follow-up/ }).first().click();
    await page.waitForFunction(() => (Reflect.get(window, "heldEvidenceRestoreCallbacks") as unknown[]).length > 0);
    setOwner(`0x${"b".repeat(40)}`);
    await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === "/api/ask/visibility"), page.evaluate(() => window.dispatchEvent(new Event("focus")))]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="research-turn"]').length === 0);
    await page.evaluate(() => { for (const callback of Reflect.get(window, "heldEvidenceRestoreCallbacks") as Array<() => void>) callback(); });
    expect(await page.getByLabel("What do you want to know?").inputValue()).toBe("");
    expect(asks).toHaveLength(1);
  } finally { await context.close(); }
}, 15000);

it("does not carry a prepared hidden draft into a different saved report", async () => {
  const { context, page, asks } = await mount("/saved", "private");
  try {
    await page.getByText("Inspect targets and prepare a follow-up", { exact: true }).click();
    await page.getByRole("button", { name: /Prepare follow-up/ }).first().click();
    await page.waitForFunction(target => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value.includes(target), run.subClaims[0]);
    await page.evaluate(() => Reflect.get(window, "showPublicReport")());
    await page.getByText("PUBLIC ANSWER", { exact: true }).waitFor();
    expect(await page.locator("#ask-question").count()).toBe(0);
    expect(await page.locator("body").innerText()).not.toContain(run.question);
    for (const href of await page.locator('a[href]').evaluateAll(anchors => anchors.map(anchor => anchor.getAttribute("href")!))) {
      const url = new URL(href, page.url());
      expect(url.searchParams.get("q") ?? "").not.toContain(run.question);
      expect(url.searchParams.get("q") ?? "").not.toContain(run.subClaims[0]);
    }
    expect(asks).toEqual([]);
  } finally { await context.close(); }
}, 15000);

it("keeps an anonymous private-document claim handoff available while preparing a target", async () => {
  const { context, page, asks } = await mount("/research/private", "public");
  try {
    const claim = page.getByRole("button", { name: "Open private account claim", exact: true });
    await claim.waitFor();
    expect(asks[0].wallet).toBe("anonymous");
    expect(asks[0].document).toBe(`fixture.${"x".repeat(43)}`);
    await page.getByText("Inspect targets and prepare a follow-up", { exact: true }).click();
    expect(await page.locator('a[href*="?q="]').count()).toBe(0);
    await page.getByRole("button", { name: /Prepare follow-up/ }).first().click();
    await page.waitForFunction(target => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value.includes(target), run.subClaims[0]);
    expect(await claim.isVisible()).toBe(true);
    expect(asks).toHaveLength(1);
    await page.evaluate(() => {
      Reflect.set(window, "claimOpened", []);
      window.open = ((url: string | URL | undefined) => { Reflect.get(window, "claimOpened").push(String(url)); return null; }) as typeof window.open;
    });
    await claim.click();
    expect(await page.evaluate(() => Reflect.get(window, "claimOpened"))).toEqual([`https://evidence-follow-up.test/claim-run#${"f".repeat(64)}`]);
    expect(await claim.count()).toBe(0);
  } finally { await context.close(); }
}, 15000);

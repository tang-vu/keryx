import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import type { RunVisibility } from "../run-privacy/contracts";

const owner = `0x${"a".repeat(40)}`, other = `0x${"b".repeat(40)}`;
const originalId = "11111111-1111-4111-8111-111111111111", question = "Scoped profiler follow-up";
const answer = "Completed profiler follow-up", failure = "Original terminal profiler diagnostic";
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{Profiler,useState,useCallback}from'react';import{createRoot}from'react-dom/profiling';
    import{ResearchChat}from'./components/keryx/research-chat';
    const visibility=new URLSearchParams(location.search).get('visibility');
    const initial={question:${JSON.stringify(question)},budget:0,parentId:${JSON.stringify(originalId)},visibility,expectedWallet:${JSON.stringify(owner)}};
    window.reported=false;window.reports=[];window.commits=[];window.frames=[];window.sequence=0;
    function observe(){const value={streaming:[...document.querySelectorAll('button')].some(b=>b.textContent==='Stop research'),
      terminal:document.body.textContent.includes(${JSON.stringify(answer)})||document.body.textContent.includes(${JSON.stringify(failure)}),
      reported:window.reported,disabled:document.getElementById('readiness-target').disabled};window.commits.push(value);
      requestAnimationFrame(()=>window.frames.push({streaming:[...document.querySelectorAll('button')].some(b=>b.textContent==='Stop research'),
        reported:window.reported,disabled:document.getElementById('readiness-target').disabled}));}
    function Fixture(){const[ready,setReady]=useState(false),[prepared,setPrepared]=useState();
      const report=useCallback(value=>{window.reported=value;window.reports.push(value);setReady(value)},[]);
      window.reselect=()=>setPrepared({id:++window.sequence,question:'Queued target must not replace active research'});
      return <><button id='readiness-target' disabled={!ready} onClick={()=>window.reselect()}>Original saved target</button>
        <Profiler id='actual-research-chat' onRender={observe}><ResearchChat initialRequest={initial} preparedFollowUp={prepared} onPreparationReadyChange={report}/></Profiler></>;}
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: {
    "process.env": "{}", "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x3333333333333333333333333333333333333333"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
  }, plugins: [{ name: "unrelated-boundaries", setup(builder) {
    const names: Record<string, string> = { "wallet-menu": "WalletMenu", "dispatch-wire": "DispatchWire", "session-grant-panel": "SessionGrantPanel",
      "landing-visit": "LandingVisit", "onboarding-tour": "OnboardingTour", "globe-watermark": "GlobeWatermark", "creators-paid-panel": "CreatorsPaidPanel",
      "reasoning-console": "ReasoningConsole", "report-actions": "ReportActions", "decision-reviews": "DecisionReviews", "read-checkpoint-verify": "ReadCheckpointVerify",
      "answer-feedback": "AnswerFeedback", "requester-feedback": "RequesterFeedback" };
    builder.onResolve({ filter: /^next\/(?:link|navigation)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onResolve({ filter: /\/(wallet-menu|dispatch-wire|session-grant-panel|landing-visit|onboarding-tour|globe-watermark|creators-paid-panel|reasoning-console|report-actions|decision-reviews|read-checkpoint-verify|answer-feedback|requester-feedback)$/ }, args => ({ path: args.path.split("/").at(-1)!, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "next/link"
      ? "export const useLinkStatus=()=>({pending:false});export default function Link({prefetch,onNavigate,...props}){return <a {...props}/>}"
      : args.path === "next/navigation" ? "export const usePathname=()=>location.pathname;" : `export function ${names[args.path]}(){return null;}` }));
  } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

type Observation = { streaming: boolean; terminal?: boolean; reported: boolean; disabled: boolean };
type Probe = { reported: boolean; commits: Observation[]; frames: Observation[]; reselect(): void };
async function mount(visibility: RunVisibility, terminal = "done") {
  const context = await browser.newContext({ serviceWorkers: "block" }), asks: Array<Record<string, unknown>> = [], errors: string[] = [];
  let wallet = owner, release: (() => Promise<void>) | undefined;
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/api/ask/visibility") return route.fulfill({ json: { wallet, defaultVisibility: visibility, privacyActive: true } });
    if (url.pathname === "/api/models") return route.fulfill({ json: { models: [] } });
    if (url.pathname === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
    if (url.pathname === "/api/sources") return route.fulfill({ json: { sources: [] } });
    if (url.pathname === "/api/ask") {
      const body = request.postDataJSON(); asks.push({ ...body, expectedWallet: request.headers()["x-keryx-expected-wallet"] });
      const run = { id: "22222222-2222-4222-8222-222222222222", question: body.question, answer, budget: 0, totalSpent: 0, totalToCreators: 0,
        subClaims: [], citations: [], decisions: [], evidence: [], claimCoverage: [], trace: [], engine: "synthetic", createdAt: "2026-11-08T00:00:00.000Z" };
      release = () => route.fulfill({ contentType: "text/event-stream", body: `event: meta\ndata: ${JSON.stringify({ engine: "synthetic", mode: "offline", visibility, visibilityOwner: wallet })}\n\nevent: ${terminal}\ndata: ${JSON.stringify(terminal === "done" ? run : { message: failure })}\n\n` });
      return;
    }
    if (url.pathname.startsWith("/api/")) throw new Error(`Unexpected endpoint: ${url.pathname}`);
    return url.origin === "https://readiness.test" && url.pathname === "/saved"
      ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
  await page.goto(`https://readiness.test/saved?visibility=${visibility}`); await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => (window as unknown as Probe).reported === true);
  await page.waitForFunction(question => (document.querySelector("#ask-question") as HTMLTextAreaElement)?.value === question, question);
  return { context, page, asks, errors, release: () => release?.(), setOwner: (next: string) => { wallet = next; } };
}
async function start(page: Page) {
  await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
  await page.getByRole("button", { name: "Stop research", exact: true }).waitFor();
  await page.waitForFunction(() => (window as unknown as Probe).frames.some(frame => frame.streaming));
}
const observations = (page: Page) => page.evaluate(() => ({ commits: (window as unknown as Probe).commits, frames: (window as unknown as Probe).frames }));

it.each(["private", "unlisted", "public"].flatMap(visibility => ["done", "error"].map(terminal => ({ visibility: visibility as RunVisibility, terminal }))))("reports $visibility readiness during the streaming commit and restores after $terminal", async ({ visibility, terminal }) => {
  const { context, page, asks, errors, release } = await mount(visibility, terminal);
  try {
    await start(page);
    const active = await observations(page), commits = active.commits.filter(row => row.streaming), frames = active.frames.filter(row => row.streaming);
    expect(commits.length).toBeGreaterThan(0); expect(commits.map(row => row.reported)).toEqual(commits.map(() => false));
    expect(frames.length).toBeGreaterThan(0); expect(frames.every(row => row.disabled && !row.reported)).toBe(true);
    await page.evaluate(() => (window as unknown as Probe).reselect());
    expect(await page.getByRole("button", { name: "Stop research", exact: true }).isVisible()).toBe(true); expect(asks).toHaveLength(1);
    await release(); await page.getByText(terminal === "done" ? answer : failure, { exact: true }).waitFor();
    await page.waitForFunction(() => (window as unknown as Probe).reported === true);
    expect(await page.locator("#readiness-target").isEnabled()).toBe(true);
    const settled = (await observations(page)).commits.filter(row => row.terminal);
    expect(settled.length).toBeGreaterThan(0); expect(settled.every(row => row.reported)).toBe(true);
    expect(await page.getByLabel("What do you want to know?").inputValue()).toBe("");
    expect(asks).toEqual([expect.objectContaining({ question, parentId: originalId, visibility, budget: 0, expectedWallet: owner })]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

it("restores readiness after an explicit Stop without starting a replacement request", async () => {
  const { context, page, asks } = await mount("private");
  try {
    await start(page); await page.getByRole("button", { name: "Stop research", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as Probe).reported === true);
    expect(await page.locator("#readiness-target").isEnabled()).toBe(true); expect(asks).toHaveLength(1);
  } finally { await context.close(); }
});
it("keeps the original private report unavailable after a confirmed owner change", async () => {
  const { context, page, asks, setOwner } = await mount("private");
  try {
    setOwner(other);
    await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === "/api/ask/visibility"), page.evaluate(() => window.dispatchEvent(new Event("focus")))]);
    await page.waitForFunction(() => (window as unknown as Probe).reported === false);
    expect(await page.locator("#readiness-target").isDisabled()).toBe(true);
    expect(await page.getByLabel("What do you want to know?").inputValue()).toBe(""); expect(asks).toEqual([]);
  } finally { await context.close(); }
});

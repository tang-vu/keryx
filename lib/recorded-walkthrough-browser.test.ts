import { build } from "esbuild";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { encodeFunctionResult } from "viem";
import { expect, it } from "vitest";
import { walkthroughMessages as messages } from "../locales/en/walkthrough";
import { recordedPayment } from "./recorded-walkthrough-verification";
import { REGISTRY_ABI } from "./registry/registry-abi";

type Fixture = {
  receipt: { payload: { dispatch: { answer: string } } }; circle: Record<string, string>; rpc: unknown[];
  availability: { state: string }; unavailable: boolean; calls: { path: string; method: string; credentials: string }[];
};

it("recorded path works at phone/desktop width with no auto-fetch, explicit credential-free checks and unavailable fallback (isolated component)", async () => {
  const receipt = JSON.parse(readFileSync("fixtures/walkthrough/recorded-mainnet-receipt.json", "utf8"));
  const payee = recordedPayment.payee as `0x${string}`;
  const circle = { id: "f2751e74-754b-48a7-b416-6e682410ac9f", status: "completed", token: "USDC", sendingNetwork: "eip155:5042",
    recipientNetwork: "eip155:5042", toAddress: payee, amount: "25000" };
  const rpc = [{ jsonrpc: "2.0", id: 1, result: "0x13b2" }, { jsonrpc: "2.0", id: 2, result: encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "get",
    result: { creator: payee, payoutWallet: payee, authors: [{ wallet: payee, basisPoints: 10_000 }], fetchPriceUsdc6: BigInt(2_000), contentCid: "", tags: "", active: true } }) }];
  const css = (await postcss([tailwind({ base: process.cwd() })]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
  const bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{RecordedWalkthrough}from'./components/keryx/recorded-walkthrough';
const reads={'/api/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913/receipt':['GET','receipt'],
'https://gateway-api.circle.com/v1/x402/transfers/f2751e74-754b-48a7-b416-6e682410ac9f':['GET','circle'],
'https://rpc.blockdaemon.mainnet.arc.io':['POST','rpc'],'/api/research/availability':['GET','availability']};
window.calls=[];window.fetch=async(path,init)=>{window.calls.push({path,method:init.method,credentials:init.credentials});
const read=reads[path];if(!read||init.method!==read[0]||init.credentials!=='omit'||init.redirect!=='error')throw Error('Unexpected authority');
if(window.unavailable)return new Response('Unavailable',{status:503});return Response.json(window[read[1]]);};
createRoot(document.getElementById('root')).render(<RecordedWalkthrough/>);` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "isolated-next-navigation", setup(plugin) {
      plugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture-link" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture-link" }, () => ({ resolveDir: process.cwd(), loader: "js", contents: "import React from'react';export default function Link({children,prefetch,...props}){return React.createElement('a',props,children)}" }));
    } }],
  })).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try { for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route("**/*", route => route.request().url() === "https://recorded.example/" ? route.fulfill({ contentType: "text/html", body: '<main id="root" style="max-width:900px;margin:auto;padding:16px"></main>' }) : route.abort());
    const page = await context.newPage(); await page.goto("https://recorded.example/");
    await page.evaluate(value => { Object.assign(window, value); }, { receipt, circle, rpc, availability: { state: "paused" } });
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
    const check = async (button: string, outcome: string) => {
      await page.getByRole("button", { name: button, exact: true }).click();
      await page.getByRole("status").getByText(outcome, { exact: true }).waitFor();
    };
    const fixture = (change: (value: Fixture) => void) => page.evaluate(`(${change})(window)`);
    await page.getByRole("button", { name: messages.start }).click();
    await page.getByRole("heading", { name: messages.steps[0].title }).waitFor();
    await page.getByRole("button", { name: messages.next }).click();
    await page.getByRole("heading", { name: messages.steps[1].title }).waitFor();
    await page.getByRole("button", { name: messages.next }).click();
    await page.getByRole("heading", { name: messages.steps[2].title }).waitFor();
    await page.getByText(recordedPayment.payee, { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as Fixture).calls.length)).toBe(0);
    await check(messages.check, messages.matched);
    await check(messages.circleCheck, messages.circleCompleted);
    await check(messages.registryCheck, messages.registryRegistered);
    await fixture(value => { value.receipt.payload.dispatch.answer += "<img data-injection onerror=alert(1)>"; value.circle.amount = "24999";
      value.rpc = [value.rpc[0], { jsonrpc: "2.0", id: 2, result: "0x<img data-injection>" }]; });
    await check(messages.check, messages.changed);
    await check(messages.circleCheck, messages.circleMismatch);
    await check(messages.registryCheck, messages.registryUnavailable);
    await fixture(value => { value.circle = { ...value.circle, amount: "25000", status: "batched" }; });
    await check(messages.circleCheck, messages.circleProgressing);
    expect(await page.locator("[data-injection]").count()).toBe(0);
    await check(messages.liveCheck, messages.livePaused);
    await fixture(value => { value.availability = { state: "not-paused" }; });
    await check(messages.liveCheck, messages.liveOpen);
    await fixture(value => { value.unavailable = true; });
    await check(messages.check, messages.unavailable);
    await check(messages.circleCheck, messages.circleUnavailable);
    await check(messages.registryCheck, messages.registryUnavailable);
    await check(messages.liveCheck, messages.liveUnknown);
    const calls = await page.evaluate(() => (window as unknown as Fixture).calls);
    expect(calls).toHaveLength(13);
    expect(calls.every(call => call.credentials === "omit" && (call.method === "GET" || call.path === recordedPayment.rpcUrl))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: messages.next }).click();
    await page.getByRole("heading", { name: messages.steps[3].title }).waitFor();
    await page.getByText(messages.costsValue, { exact: true }).waitFor();
    expect(await page.getByText("0.050000 USDC", { exact: true }).count()).toBe(1);
    expect(await page.getByText("0.025000 USDC", { exact: true }).count()).toBe(2);
    expect(await page.getByRole("link", { name: messages.ledgerLink }).getAttribute("href")).toBe("/operator/ledger");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: messages.finish }).click();
    await page.getByRole("heading", { name: messages.finished }).waitFor();
    await context.close();
  } } finally { await browser.close(); }
}, 90_000);

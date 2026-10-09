/** Actual sponsor UI; synthetic signatures/HTTP only, with all external traffic blocked. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { keccak256, toBytes } from "viem";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../lib/arc-network-profile";
import { registrationId } from "../lib/sources/registration-status";
import { registrationIntentDigest, type SponsoredRegistration } from "../lib/sources/registration-sponsor-protocol";

const creator = `0x${"a".repeat(40)}` as const, other = `0x${"f".repeat(40)}` as const;
const registry = `0x${"b".repeat(40)}` as const, sponsor = `0x${"c".repeat(40)}` as const;
const claimId = "1".repeat(64), claimB = "2".repeat(64), hash = `0x${"d".repeat(64)}` as const;
declare global { interface Window {
  sponsorWallet: { address: string; chainId: number };
  sponsorConnection: { address: string; chainId: number; status: "connected" };
  holdSponsorRender: boolean;
  sponsorSignatures: Record<string, unknown>[];
  setSponsorWallet: (value: { address: string; chainId: number }) => void;
  holdSponsorSignature: boolean; finishSponsorSignature: () => void;
} }

const browser = await chromium.launch({ headless: true });
try {
  for (const profile of [ARC_TESTNET_PROFILE, ARC_MAINNET_PROFILE]) {
    function original(claim = claimId, state: SponsoredRegistration["state"] = "prepared"): SponsoredRegistration {
      const canonicalUrl = `https://feed.invalid/${claim === claimId ? "a" : "b"}`;
      const urlHash = keccak256(toBytes(canonicalUrl)), now = Date.now();
      const row: SponsoredRegistration = { id: hash, policyDigest: hash, creator,
        canonicalUrl, rssUrl: "https://feed.invalid/rss", claimId: claim, claimRevision: 2,
        sourceId: `fixture-${claim}`, onchainId: registrationId(creator, urlHash), registryAddress: registry,
        registryCodeHash: hash, relayer: sponsor, chainId: profile.chainId as 5042 | 5042002,
        params: { urlHash, payoutWallet: creator, authors: [{ wallet: creator, basisPoints: 10000 }],
          fetchPriceUsdc6: "16000", contentCid: "", tags: "research" }, nonce: "0",
        deadline: Math.floor(now / 1000) + (state === "expired" ? -10 : 600), createdAt: now, updatedAt: now,
        reservedWei: "20000000000000000", state };
      row.id = registrationIntentDigest(row);
      return row;
    }
    const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {SponsoredRegistrationForm} from './components/keryx/sponsored-registration-form';
window.sponsorSignatures=[];window.holdSponsorSignature=false;window.holdSponsorRender=false;
window.sponsorConnection={address:'${creator}',chainId:${profile.chainId},status:'connected'};
function Harness(){const [wallet,setWallet]=React.useState({address:'${creator}',chainId:${profile.chainId}});
window.sponsorWallet=wallet;window.setSponsorWallet=value=>{
window.sponsorConnection={...value,status:'connected'};
if(!window.holdSponsorRender)setWallet(value);};
return React.createElement(SponsoredRegistrationForm,{claimId:new URL(location.href).searchParams.get('claimId')||undefined});}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
` }, bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false,
      define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify(profile.name),
        "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": JSON.stringify(registry),
        "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": JSON.stringify(registry),
        "process.env.NEXT_PUBLIC_KERYX_REGISTRY_VERSION": '"3"', "process.env.NODE_ENV": '"development"' },
      plugins: [{ name: "synthetic-sponsor-wallet", setup(b) {
        b.onResolve({ filter: /^next\/link$|^wagmi(?:\/actions)?$|use-siwe-auth$/ }, a => ({ path: a.path, namespace: "fixture" }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ resolveDir: process.cwd(), contents:
          a.path === "next/link" ? "import React from 'react';export default function Link(props){return React.createElement('a',props)}" :
          a.path === "wagmi/actions" ? "export const getConnection=()=>window.sponsorConnection;" : a.path === "wagmi" ? `
export const useAccount=()=>window.sponsorWallet;
export const useConfig=()=>({});
export const useSignTypedData=()=>({signTypedDataAsync:async args=>{
window.sponsorSignatures.push(JSON.parse(JSON.stringify(args,(_,v)=>typeof v==='bigint'?String(v):v)));
if(window.holdSponsorSignature)await new Promise(resolve=>window.finishSponsorSignature=resolve);
return '0x'+'1'.repeat(130);}});
` : "export const useSiweAuth=()=>({session:{address:window.sponsorWallet.address,role:'creator'}});" }));
      } }] });
    const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
    let row: SponsoredRegistration | null = null, available = true, lostResponse = false, lostRenewal = false, indexed = false;
    const history = new Map<string, SponsoredRegistration>();
    const posts: Record<string, unknown>[] = [], errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "https://sponsor.invalid") return route.abort();
      if (url.pathname === "/api/source-claims") {
        const id = url.searchParams.get("claimId")!;
        return route.fulfill({ json: { claim: { id, ownerWallet: creator,
          canonicalUrl: `https://feed.invalid/${id === claimId ? "a" : "b"}`, rssUrl: "https://feed.invalid/rss" } } });
      }
      if (url.pathname.startsWith("/api/creator/")) return route.fulfill({ json: indexed && row ?
        { mode: "onchain", creator, registryAddress: registry, onchainId: row.onchainId } : { mode: "pending" } });
      if (url.pathname === "/api/sources/sponsor") {
        if (request.method() === "POST") {
          const body = request.postDataJSON(); posts.push(body);
          if (body.operation === "prepare") {
            const prior = row; row = original(body.claimId);
            if (body.replacesRequestId) {
              row.replacesRequestId = prior!.id; history.set(prior!.id, prior!);
              if (lostRenewal) return route.abort();
            }
          } else {
            row = { ...row!, state: "submitted", transactionHash: hash, transactionNonce: 0 };
            if (lostResponse) return route.abort();
          }
          return route.fulfill({ json: { original: row } });
        }
        if (url.searchParams.has("id") || url.searchParams.has("claimId")) {
          const found = url.searchParams.has("id") ? history.get(url.searchParams.get("id")!) ?? row : row;
          if (!found || (url.searchParams.has("claimId") && url.searchParams.get("claimId") !== found.claimId))
            return route.fulfill({ status: 404, json: { error: "No prior original" } });
          return route.fulfill({ json: { original: found } });
        }
        return route.fulfill({ json: { available, sponsorAddress: sponsor, policyDigest: hash } });
      }
      return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
    });
    async function load(claim = claimId) {
      await page.goto(`https://sponsor.invalid/register/sponsored?claimId=${claim}`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      for (const path of process.env.CREATOR_UI_CSS?.split("|") ?? []) await page.addStyleTag({ path });
    }
    const prepare = page.getByRole("button", { name: "Prepare sponsored registration", exact: true });
    const sign = page.getByRole("button", { name: "Sign reviewed registration", exact: true });
    const inspect = page.getByRole("button", { name: "Inspect original registration", exact: true });
    await load(); await prepare.click(); await sign.waitFor();
    assert.equal(posts.length, 1); assert.equal(posts[0].operation, "prepare");
    assert.deepEqual(await page.evaluate(() => window.sponsorSignatures), []);
    await page.getByText("Keryx gas reservation: up to 0.02 USDC.", { exact: false }).waitFor();
    await page.getByText(`${creator}: 100.00%`, { exact: true }).waitFor();
    await page.getByText(`Network and registry: ${profile.label}, ${registry}`, { exact: true }).waitFor();
    await page.getByText(`Gas sponsor: ${sponsor}`, { exact: true }).waitFor();
    await page.getByText("Tags: research", { exact: true }).waitFor();
    if (process.env.CREATOR_UI_CSS) assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Sponsor review must fit 320px");
    if (process.env.CREATOR_UI_SCREENSHOT) await page.screenshot({ path: process.env.CREATOR_UI_SCREENSHOT, fullPage: true });
    lostResponse = true; await sign.click(); await page.getByRole("alert").waitFor();
    assert.equal(posts.length, 2); assert(await sign.isDisabled());
    const signatures = await page.evaluate(() => window.sponsorSignatures);
    assert.equal(signatures.length, 1);
    assert.deepEqual(signatures[0].domain, { name: "KeryxSourceRegistry", version: "3", chainId: profile.chainId, verifyingContract: registry });
    assert.equal((signatures[0].message as Record<string, unknown>).creator, creator);
    assert.equal((signatures[0].message as Record<string, unknown>).relayer, sponsor);
    assert.equal(signatures[0].account, creator);
    await load(); await page.getByText("Original transaction submitted: confirmation pending", { exact: true }).waitFor();
    assert.equal(await sign.count(), 0); assert.equal(posts.length, 2);
    assert.deepEqual(await page.evaluate(() => window.sponsorSignatures), []);
    row = { ...row!, state: "confirmed", actualGasWei: "1000000000000000" }; indexed = true;
    await inspect.click(); await page.getByText("Registration confirmed and indexed", { exact: true }).waitFor();
    assert.equal(posts.length, 2);

    // Saved claim A must not block independently verified claim B.
    row = null; lostResponse = false; await load(claimB); await prepare.waitFor();
    await prepare.click(); await sign.waitFor(); assert.equal(posts.at(-1)!.claimId, claimB);
    // A pending wallet prompt from a previous account must never reach POST submit.
    await page.evaluate(() => { window.holdSponsorSignature = true; });
    await sign.click(); await page.waitForFunction(() => typeof window.finishSponsorSignature === "function");
    const beforeSwitch = posts.length;
    await page.evaluate(value => {
      window.holdSponsorRender = true; window.setSponsorWallet(value); window.finishSponsorSignature();
    }, { address: other, chainId: profile.chainId });
    await page.getByText("Original registration belongs to another wallet or registry", { exact: true }).waitFor();
    assert.equal(posts.length, beforeSwitch, "A changed connection must fence submission before React commits the new wallet");
    await page.evaluate(() => { window.holdSponsorRender = false; window.setSponsorWallet(window.sponsorConnection); });
    await page.getByText("Verify this source with the connected wallet first", { exact: true }).waitFor();
    assert.equal(posts.length, beforeSwitch);
    await load(claimB); await sign.waitFor();
    await page.evaluate(() => { window.holdSponsorSignature = true; });
    await sign.click(); await page.waitForFunction(() => typeof window.finishSponsorSignature === "function");
    await page.evaluate(value => {
      window.holdSponsorRender = true; window.setSponsorWallet(value); window.finishSponsorSignature();
    }, { address: creator, chainId: 1 });
    await page.getByText("Original registration belongs to another wallet or registry", { exact: true }).waitFor();
    assert.equal(posts.length, beforeSwitch, "A changed connection must fence submission before React commits the new chain");
    await page.evaluate(() => { window.holdSponsorRender = false; window.setSponsorWallet(window.sponsorConnection); });
    await page.getByText(`Connect and sign in with your creator wallet on ${profile.label}.`, { exact: true }).waitFor();
    assert.equal(posts.length, beforeSwitch, "Changing chain during a signature prompt must not submit the previous intent");

    // Recovery still reads an original after sponsorship is disabled, without a signature.
    available = false; row = original(claimB, "submitted"); row.transactionHash = hash; row.transactionNonce = 0;
    await load(claimB); await page.getByText("Original transaction submitted: confirmation pending", { exact: true }).waitFor();
    assert.equal(await prepare.count(), 0); assert.equal(await sign.count(), 0); assert.equal(posts.length, beforeSwitch);
    assert.deepEqual(await page.evaluate(() => window.sponsorSignatures), []);
    await page.evaluate(() => localStorage.clear()); row = null;
    await load(); await page.getByText("Registration gas sponsorship is currently unavailable", { exact: false }).waitFor();
    assert.equal(await prepare.count(), 0);

    // Explicit expired unsigned renewal, with the exact prior request retained.
    available = true; row = original(claimId, "expired"); const expiredId = row.id;
    await load(); lostRenewal = true;
    await page.getByRole("button", { name: "Prepare new unsigned request", exact: true }).click();
    await page.getByRole("alert").waitFor(); assert.equal(posts.at(-1)!.replacesRequestId, expiredId);
    const renewedId = row!.id, beforeReload = posts.length;
    await load(); await sign.waitFor();
    assert.equal(await page.getByLabel("Original request", { exact: true }).inputValue(), renewedId);
    assert.equal(posts.length, beforeReload, "Lost renewal response reload must find the latest server original without another POST");
    assert.deepEqual(await page.evaluate(() => window.sponsorSignatures), []);
    // A stale visible button must also refuse a changed connection before prompting.
    await page.evaluate(value => { window.holdSponsorRender = true; window.setSponsorWallet(value); }, { address: other, chainId: profile.chainId });
    await sign.click();
    await page.getByText("Original registration belongs to another wallet or registry", { exact: true }).waitFor();
    assert.equal(posts.length, beforeReload);
    assert.deepEqual(await page.evaluate(() => window.sponsorSignatures), []);
    await load(); await sign.waitFor();
    // Changed policy cannot open a wallet prompt for a retained original.
    row!.policyDigest = `0x${"e".repeat(64)}`; await load(); await sign.click();
    await page.getByText("This original has no current signing allowance", { exact: false }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.sponsorSignatures), []);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${profile.name}: reviewed typed data, lost-response recovery, wallet-switch refusal, claim-scoped originals, disabled recovery and explicit expiry renewal. Synthetic signatures; no gas or settlement.`);
  }
} finally { await browser.close(); }

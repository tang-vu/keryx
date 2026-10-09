/** Actual identity panel, synthetic owner/API/provider navigation. Never live OAuth. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const fixtureCss = process.env.KERYX_IDENTITY_BROWSER_CSS_FIXTURE;
const chunks = join(resolve(process.env.NEXT_DIST_DIR ?? ".next"), "static", "chunks");
const cssFiles = fixtureCss ? [resolve(fixtureCss)] : (await readdir(chunks)).filter(file => file.endsWith(".css")).map(file => join(chunks, file));
assert(cssFiles.length, "Build candidate CSS before browser acceptance");
const css = (await Promise.all(cssFiles.map(file => readFile(file, "utf8")))).join("\n");
const output = join(process.cwd(), ".artifacts", "profile-identity-browser"); await mkdir(output, { recursive: true });
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const identity = { provider: "github", externalId: "123", label: "alice", wallet: alice, verifiedAt: "2026-10-09T00:00:00.000Z" };
const bundle = await build({ stdin: { contents: `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{VerifiedIdentityPanel}from'./app/me/profile/verified-identity-panel';
window.wallet=${JSON.stringify(alice)};window.cookieOwner=window.wallet;window.saved=false;window.identities={};window.calls=[];window.held=[];window.delay=false;window.heldMutation=[];window.delayMutation=false;window.fail=false;window.unsafe=false;
window.fetch=async(url,init={})=>{url=String(url);const method=init.method||'GET',owner=window.cookieOwner;window.calls.push({url,method,expected:init.headers['X-Keryx-Expected-Wallet']});
if(owner!==init.headers['X-Keryx-Expected-Wallet'])return Response.json({error:'profile_owner_changed'},{status:409});if(window.fail)return Response.json({error:'identity_unavailable'},{status:503});
if(url==='/api/me/profile/identities'&&method==='GET'){const body={wallet:owner,identities:window.identities[owner]||[]};if(window.delay){window.delay=false;return new Promise(resolve=>window.held.push(()=>resolve(Response.json(body))));}return Response.json(body);}
if(url==='/api/me/profile/identities/github'&&method==='DELETE'){const respond=()=>{window.identities[owner]=[];return Response.json({unlinked:true});};if(window.delayMutation){window.delayMutation=false;return new Promise(resolve=>window.heldMutation.push(()=>resolve(respond())));}return respond();}
if(url.endsWith('/start')&&method==='POST')return Response.json({authorizationUrl:window.unsafe?'https://evil.invalid/steal':'https://github.com/login/oauth/authorize?client_id=fixture&scope=&state=fixture'});
throw Error('Unexpected identity request');};
function Probe(){const[state,set]=useState({wallet:window.wallet,saved:window.saved});useEffect(()=>{const update=()=>set({wallet:window.wallet,saved:window.saved});window.addEventListener('fixture-owner',update);return()=>window.removeEventListener('fixture-owner',update)},[]);return state.wallet?<VerifiedIdentityPanel key={state.wallet} wallet={state.wallet} saved={state.saved}/>:null;}
createRoot(document.getElementById('root')).render(<Probe/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const update = async (page: Page, wallet: string | null, saved: boolean, cookieOwner = wallet) => {
  await page.evaluate(input => { Object.assign(window, input); window.dispatchEvent(new Event("fixture-owner")); }, { wallet, saved, cookieOwner });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};
const browser = await chromium.launch({ headless: true }), results: unknown[] = [];
try {
  for (const width of [320, 390, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    const external: string[] = [], errors: string[] = [];
    try {
      await context.route("**/*", route => { if (route.request().url() === "https://identities.test/") return route.fulfill({ contentType: "text/html", body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main id="root" style="max-width:820px;margin:auto;padding:16px"></main></body></html>` }); external.push(route.request().url()); return route.abort(); });
      const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
      await page.goto("https://identities.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.getByText("Save your private profile before verifying an identity.", { exact: true }).waitFor();
      assert(await page.getByRole("button", { name: "Verify GitHub" }).isDisabled());
      await update(page, alice, true); await page.waitForFunction(() => !(document.querySelector('button:last-child') as HTMLButtonElement)?.disabled);
      await page.evaluate(input => { (window as unknown as { identities: Record<string, unknown[]> }).identities[input.wallet] = [input]; }, identity);
      await update(page, bob, true); await update(page, alice, true); await page.getByRole("link", { name: "github: alice" }).waitFor();
      const link = page.getByRole("link", { name: "github: alice" }); assert.equal(await link.getAttribute("href"), "https://github.com/alice");
      assert((await link.getAttribute("rel"))?.includes("noreferrer")); await page.getByText("Verified at 2026-10-09T00:00:00.000Z").waitFor();
      await page.screenshot({ path: join(output, `identity-linked-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "Unlink", exact: true }).click(); await page.getByText("Identity link removed. Pending verification for this provider was cancelled.", { exact: true }).waitFor(); assert.equal(await link.count(), 0);
      await page.evaluate(() => { (window as unknown as { unsafe: boolean }).unsafe = true; });
      await page.getByRole("button", { name: "Verify GitHub" }).click(); await page.getByText("Identity verification could not be started.", { exact: true }).waitFor(); assert.equal(page.url(), "https://identities.test/");
      await page.evaluate(() => { (window as unknown as { delay: boolean }).delay = true; }); await update(page, bob, true);
      await page.waitForFunction(() => (window as unknown as { held: unknown[] }).held.length === 1);
      await update(page, alice, true); await page.evaluate(() => { (window as unknown as { held: (() => void)[] }).held.splice(0).forEach(fn => fn()); });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal(await page.getByRole("link").count(), 0);
      await page.evaluate(input => { const fixture = window as unknown as { identities: Record<string, unknown[]> }; fixture.identities[input.wallet] = [input]; }, identity);
      await update(page, bob, true); await update(page, alice, true); await page.getByRole("link", { name: "github: alice" }).waitFor();
      await page.evaluate(() => { (window as unknown as { delayMutation: boolean }).delayMutation = true; }); await page.getByRole("button", { name: "Unlink", exact: true }).click();
      await page.waitForFunction(() => (window as unknown as { heldMutation: unknown[] }).heldMutation.length === 1); await update(page, bob, true);
      await page.evaluate(() => { (window as unknown as { heldMutation: (() => void)[] }).heldMutation.splice(0).forEach(fn => fn()); });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal(await page.getByRole("link").count(), 0); assert.equal(await page.getByText(/Identity link removed/).count(), 0);
      // Same owner, different saved-profile lifecycle: abort an unlink, delete/recreate the profile, and retain usable controls.
      await page.evaluate(input => { (window as unknown as { identities: Record<string, unknown[]> }).identities[input.wallet] = [input]; }, identity);
      await update(page, alice, true); await page.getByRole("link", { name: "github: alice" }).waitFor();
      await page.evaluate(() => { (window as unknown as { delayMutation: boolean }).delayMutation = true; }); await page.getByRole("button", { name: "Unlink", exact: true }).click();
      await page.waitForFunction(() => (window as unknown as { heldMutation: unknown[] }).heldMutation.length === 1);
      await update(page, alice, false); await page.evaluate(() => { (window as unknown as { heldMutation: (() => void)[] }).heldMutation.splice(0).forEach(fn => fn()); });
      await update(page, alice, true); await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(button => button.disabled));
      assert.equal(await page.getByText("Working…", { exact: true }).count(), 0); assert.equal(await page.getByText(/Identity link removed/).count(), 0);
      await page.evaluate(input => { (window as unknown as { identities: Record<string, unknown[]> }).identities[input.wallet] = [{ provider: 'orcid', externalId: '0000-0002-1825-0097', label: '<img data-injection onerror=alert(1)>', wallet: input.wallet, verifiedAt: input.verifiedAt }]; }, identity);
      await update(page, bob, true); await update(page, alice, true); await page.getByRole("link", { name: "orcid: <img data-injection onerror=alert(1)>" }).waitFor(); assert.equal(await page.locator('[data-injection]').count(), 0);
      await update(page, bob, true); await update(page, alice, true, bob); await page.getByText("Verified identity links are unavailable on this storage deployment.", { exact: true }).waitFor(); assert.equal(await page.getByRole("link").count(), 0);
      const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth })); assert(geometry.document <= width, `Identity panel overflow at ${width}`);
      await page.screenshot({ path: join(output, `identity-${width}.png`), fullPage: true });
      await update(page, null, false); assert.equal(await page.getByRole("button").count(), 0);
      assert.deepEqual(external, []); assert.deepEqual(errors, []);
      results.push({ width, geometry, synthetic: true, ownerIsolation: true, unlink: true, cancelledReadAndMutation: true, sameOwnerProfileLifecycle: true, plainProviderName: true, rejectedRedirect: true, external, errors });
    } finally { await context.close(); }
  }
  // Actual explicit navigation is fenced into an inert synthetic provider response.
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const destinations: string[] = [];
    await context.route("**/*", route => {
      const url = route.request().url();
      if (url === "https://identities.test/") return route.fulfill({ contentType: "text/html", body: `<div id="root"></div>` });
      if (url.startsWith("https://github.com/login/oauth/authorize?")) { destinations.push(url); return route.fulfill({ contentType: "text/html", body: "Synthetic provider consent" }); }
      return route.abort();
    });
    const page = await context.newPage(); await page.goto("https://identities.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await update(page, alice, true); await page.getByRole("button", { name: "Verify GitHub" }).click(); await page.getByText("Synthetic provider consent").waitFor();
    assert.equal(destinations.length, 1); results.push({ explicitProviderNavigation: true, synthetic: true });
  } finally { await context.close(); }
  await writeFile(join(output, "proof.json"), JSON.stringify({ scope: "Hermetic actual identity panel; synthetic owners/API/provider, never live OAuth", cssSource: fixtureCss ? "explicit standalone candidate PostCSS fixture; not a Next build" : "candidate Next production CSS", results }, null, 2));
  console.log("Verified identity browser acceptance passed: 320/390/1366, saved-profile gating, dated links, unlink, owner/session UI isolation, in-flight refusal, redirect fencing and explicit synthetic consent.");
} finally { await browser.close(); }

/** Hermetic actual profile components + built CSS, synthetic owner/session/API responses. No deployed CRUD claim. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const chunks = join(resolve(process.env.NEXT_DIST_DIR ?? ".next"), "static", "chunks");
const cssFiles = (await readdir(chunks)).filter(file => file.endsWith(".css")); assert(cssFiles.length, "Build candidate CSS first");
const css = (await Promise.all(cssFiles.map(file => readFile(join(chunks, file), "utf8")))).join("\n");
const output = join(process.cwd(), ".artifacts", "private-profile-browser"); await mkdir(output, { recursive: true });
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PrivateProfileView}from'./app/me/profile/private-profile-view';
window.auth=null;window.calls=[];window.stores={};window.fail=false;window.held=[];window.delay=false;window.heldMutation=[];window.delayMutation=false;window.cancelledMutation=false;window.cookieOwner=null;window.rejectedOwnerReads=0;
window.fetch=async(url,init={})=>{const method=init.method||'GET';window.calls.push({url:String(url),method});if(String(url)!=='/api/me/profile')throw Error('Unexpected request');
const owner=(window.cookieOwner||window.auth.address).toLowerCase();if(init.headers['X-Keryx-Expected-Wallet']!==owner){if(method==='GET')window.rejectedOwnerReads++;return Response.json({message:'Your signed-in owner changed.'},{status:409});}if(window.fail)return Response.json({message:'Private profile unavailable'},{status:503});
if(method==='GET'){if(window.delay){window.delay=false;return new Promise(resolve=>window.held.push(()=>resolve(Response.json({profile:window.stores[owner]||null,activity:{firstSeenAt:null,questions:3,surfacesUsed:['web'],topics:['biology'],creatorsPaid:1,scope:'attributed-current-store',network:'eip155:5042'}}))));}
return Response.json({profile:window.stores[owner]||null,activity:{firstSeenAt:null,questions:owner===${JSON.stringify(bob)}?77:3,surfacesUsed:['web'],topics:['biology'],creatorsPaid:1,scope:'attributed-current-store',network:'eip155:5042'}});}
if(['PUT','DELETE'].includes(method)&&init.headers['X-Keryx-Expected-Wallet']!==owner)throw Error('Missing/wrong editor owner precondition');
if(method==='PUT'){const input=JSON.parse(init.body);const respond=()=>{window.stores[owner]={...input,wallet:owner,createdAt:'2026-10-08T00:00:00.000Z',updatedAt:'2026-10-08T00:00:00.000Z'};return Response.json({profile:window.stores[owner]});};if(window.delayMutation){window.delayMutation=false;return new Promise(resolve=>window.heldMutation.push(()=>{window.cancelledMutation=init.signal.aborted;resolve(respond());}));}return respond();}
if(method==='DELETE'){delete window.stores[owner];return Response.json({deleted:true});}throw Error('Unexpected mutation');};
createRoot(document.getElementById('root')).render(<PrivateProfileView/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "synthetic-auth", setup(plugin) {
  plugin.onResolve({ filter: /^(next\/link|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "fixture" }));
  plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "next/link" ? `import React from 'react';export default function Link(p){return <a {...p}/>} ` : `import{useEffect,useState}from'react';export function useSiweAuth(){const[session,set]=useState(window.auth);useEffect(()=>{const update=()=>set(window.auth);window.addEventListener('fixture-auth',update);return()=>window.removeEventListener('fixture-auth',update)},[]);return{session}}` }));
} }] });
const signIn = (page: Page, address: string | null) => page.evaluate(address => { const fixture = window as unknown as { auth: unknown }; fixture.auth = address ? { address, role: "asker" } : null; window.dispatchEvent(new Event("fixture-auth")); }, address);
const browser = await chromium.launch({ headless: true }); const results = [];
try {
  for (const width of [320, 390, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" }), external: string[] = [], errors: string[] = [];
    await context.route("**/*", route => { if (route.request().url() === "https://profiles.test/") return route.fulfill({ contentType: "text/html", body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main id="root" style="max-width:820px;margin:auto;padding:16px"></main></body></html>` }); external.push(route.request().url()); return route.abort(); });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
    await page.goto("https://profiles.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByRole("link", { name: "Sign in with your wallet" }).waitFor();
    assert.equal(await page.evaluate(() => (window as unknown as { calls: unknown[] }).calls.length), 0);
    await signIn(page, alice); await page.getByRole("button", { name: "Save private profile" }).waitFor();
    const maliciousText = '<img data-injection onerror="alert(1)">'; await page.getByLabel("Display name", { exact: true }).fill(maliciousText); await page.getByLabel("Handle", { exact: true }).fill("reader_01");
    await page.getByLabel("Who I am", { exact: true }).fill("Reader"); await page.getByLabel("What brings me to Keryx", { exact: true }).fill("Papers"); await page.getByLabel("github", { exact: true }).fill("https://github.com/alice");
    await page.getByRole("button", { name: "Save private profile" }).click(); await page.getByText("Private profile saved.", { exact: true }).waitFor();
    assert.equal(await page.locator("[data-injection]").count(), 0); assert.equal(await page.getByLabel("Display name", { exact: true }).inputValue(), maliciousText);
    const link = page.getByRole("link", { name: "github: https://github.com/alice", exact: true }); assert.equal(await link.getAttribute("rel"), "noopener noreferrer nofollow");
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth })); assert(geometry.document <= width, `Profile overflow at${width}`);
    await page.screenshot({ path: join(output, `profile-owner-${width}.png`), fullPage: true });
    await signIn(page, bob); await page.getByRole("button", { name: "Save private profile" }).waitFor(); assert.equal(await page.getByLabel("Display name", { exact: true }).inputValue(), ""); assert.equal(await link.count(), 0);
    await page.getByLabel("Display name", { exact: true }).fill("Bob"); await page.getByRole("button", { name: "Save private profile" }).click(); await page.getByText("Private profile saved.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Delete profile fields" }).click(); await page.getByText("Profile fields deleted. Your research and payment history are retained.", { exact: true }).waitFor(); assert.equal(await page.getByLabel("Display name", { exact: true }).inputValue(), "");
    await signIn(page, null); await page.getByRole("link", { name: "Sign in with your wallet" }).waitFor(); assert.equal(await page.getByRole("textbox").count(), 0);
    await page.evaluate(() => { (window as unknown as { delay: boolean }).delay = true; }); await signIn(page, alice);
    await page.waitForFunction(() => (window as unknown as { held: unknown[] }).held.length === 1);
    await signIn(page, bob); await page.getByRole("button", { name: "Save private profile" }).waitFor();
    await page.evaluate(() => { const fixture = window as unknown as { held: (() => void)[] }; fixture.held.splice(0).forEach(release => release()); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal(await page.getByLabel("Display name", { exact: true }).inputValue(), "");
    await signIn(page, alice); await page.getByRole("button", { name: "Save private profile" }).waitFor();
    await page.evaluate(() => { (window as unknown as { delayMutation: boolean }).delayMutation = true; });
    await page.getByLabel("Display name", { exact: true }).fill("Stale Alice response"); await page.getByRole("button", { name: "Save private profile" }).click();
    await page.waitForFunction(() => (window as unknown as { heldMutation: unknown[] }).heldMutation.length === 1);
    await signIn(page, bob); await page.getByRole("button", { name: "Save private profile" }).waitFor();
    await page.evaluate(() => { (window as unknown as { heldMutation: (() => void)[] }).heldMutation.splice(0).forEach(release => release()); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => (window as unknown as { cancelledMutation: boolean }).cancelledMutation), true); assert.equal(await page.getByLabel("Display name", { exact: true }).inputValue(), ""); assert.equal(await page.getByText("Private profile saved.", { exact: true }).count(), 0);
    // A stale Alice UI session must not display Bob's activity when his cookie profile is null.
    await page.evaluate(bob => { (window as unknown as { cookieOwner: string }).cookieOwner = bob; }, bob); await signIn(page, alice); await page.getByText("Your signed-in owner changed.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox").count(), 0); assert.equal(await page.getByText(/Attributed dispatches: 77/).count(), 0); assert.equal(await page.evaluate(() => (window as unknown as { rejectedOwnerReads: number }).rejectedOwnerReads), 1);
    // Failed next-owner lookup never leaves the prior owner's fields visible.
    await page.evaluate(() => { const fixture = window as unknown as { fail: boolean; cookieOwner: string | null }; fixture.fail = true; fixture.cookieOwner = null; }); await signIn(page, bob); await page.getByText("Private profile unavailable", { exact: true }).waitFor(); assert.equal(await page.getByRole("textbox").count(), 0);
    const calls = await page.evaluate(() => (window as unknown as { calls: { url: string; method: string }[] }).calls); assert(calls.every(call => call.url === "/api/me/profile" && ["GET", "PUT", "DELETE"].includes(call.method))); assert.deepEqual(external, []); assert.deepEqual(errors, []);
    results.push({ width, geometry, calls, external, errors, synthetic: true }); await context.close();
  }
  const devBundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import DevPage from './app/dev/page';window.mints=[];window.fetch=async(url,init={})=>{if(String(url)!=='/api/keys')throw Error('Unexpected key request');if((init.method||'GET')==='GET')return Response.json([]);if(init.method!=='POST')throw Error('Unexpected key mutation');const body=JSON.parse(init.body);window.mints.push(body);return Response.json({rawKey:'synthetic-profile-scope-fixture',id:'fixture',prefix:'fixture',scopes:body.scopes,sourceIds:null});};createRoot(document.getElementById('root')).render(<DevPage/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "synthetic-header", setup(plugin) { plugin.onResolve({ filter: /^@\/components\/keryx\/site-header$/ }, args => ({ path: args.path, namespace: "fixture" })); plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: "export function SiteHeader(){return null;}" })); } }] });
  const devContext = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: "block" }), blocked: string[] = [];
  try {
    await devContext.route("**/*", route => { if (route.request().url() === "https://keys.test/") return route.fulfill({ contentType: "text/html", body: `<html><head><style>${css}</style></head><body><div id="root"></div></body></html>` }); blocked.push(route.request().url()); return route.abort(); });
    const page = await devContext.newPage(); await page.goto("https://keys.test/"); await page.addScriptTag({ content: devBundle.outputFiles[0].text });
    await page.getByRole("button", { name: "Issue new key" }).click(); const readScope = page.getByRole("checkbox", { name: /^profile:read/ }), writeScope = page.getByRole("checkbox", { name: /^profile:write/ }); assert.equal(await readScope.isChecked(), false); assert.equal(await writeScope.isChecked(), false);
    await readScope.check(); await page.getByRole("button", { name: "Mint", exact: true }).click(); await page.getByRole("button", { name: "I have copied my key" }).click();
    await page.getByRole("button", { name: "Issue new key" }).click(); assert.equal(await readScope.isChecked(), false); assert.equal(await writeScope.isChecked(), false);
    const mints = await page.evaluate(() => (window as unknown as { mints: { scopes: string[] }[] }).mints); assert.deepEqual(mints.map(mint => mint.scopes), [["ask", "export", "profile:read"]]); assert.deepEqual(blocked, []); results.push({ surface: "actual developer scope picker", defaultAndResetPrivateScopes: false, explicitReadOnlyMint: true, synthetic: true });
  } finally { await devContext.close(); }
  await writeFile(join(output, "proof.json"), JSON.stringify({ scope: "hermetic actual components/built CSS; synthetic auth+API responses; no production profile acceptance", results }, null, 2));
  console.log("Private profile browser acceptance passed:320/390/1366,CRUD,plaintext,external-link fencing,wallet switch/signout/unavailable privacy,zero outbound.");
} finally { await browser.close(); }

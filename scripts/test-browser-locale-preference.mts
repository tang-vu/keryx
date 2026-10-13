/** Built source fixture. Uses an explicit owned build/browser/output resource.
 * Bundles actual provider/switcher/header/footer; all auth/locale/Ask transport is synthetic.
 * This does not accept a Next runtime, real signing, cross-device persistence or human translations. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const option = process.argv.indexOf("--output-dir");
assert(option >= 0 && process.argv[option + 1], "Explicit --output-dir in the admitted resource is required");
const output = resolve(process.argv[option + 1]);
const base = "https://locale-fixture.test", alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const originalPacket = { question: "Retain original request", budget: 0.05, payer: alice, sessionId: "original-session", signature: "0x1234", nonce: "retained-original-nonce" };
const bundle = await build({ stdin: { sourcefile: "locale-fixture.tsx", loader: "tsx", resolveDir: process.cwd(), contents: `
  import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
  import{LocaleProvider,useLocale}from'./lib/i18n/locale-context';
  import{SiteHeader}from'./components/keryx/site-header';import{SiteFooter}from'./components/keryx/site-footer';
  import{preparedLocales}from'./lib/i18n/locales';
  const packet=${JSON.stringify(originalPacket)};window.mounts=0;
  function Draft(){const[draft,setDraft]=useState('Keep my draft question');useEffect(()=>{window.mounts++},[]);
    const{locale}=useLocale();return <main lang="en"><output id="active-locale">{locale}</output>
      <textarea aria-label="Draft question" value={draft} onChange={event=>setDraft(event.target.value)}/>
      <input aria-label="Unsaved editor" defaultValue="Keep editor draft"/>
      <a id="original-report" href="/dispatch/retained?view=receipt#evidence">Original</a>
      <button id="send-fixture" onClick={()=>fetch('/api/ask',{method:'POST',body:JSON.stringify(packet)})}>Capture unchanged fixture arguments</button>
    </main>}
  const props=location.pathname==='/preview'?{enabledLocales:preparedLocales}:{};
  createRoot(document.getElementById('root')).render(<LocaleProvider {...props} network="eip155:5042"><SiteHeader/><Draft/><SiteFooter/></LocaleProvider>);
` }, bundle: true, write: false, splitting: true, format: "esm", platform: "browser", outdir: "locale-fixture-build",
  entryNames: "entry", chunkNames: "chunks/[name]-[hash]", metafile: true,
  define: { "process.env.NODE_ENV": '"production"', "process.env.CI": '"false"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x1111111111111111111111111111111111111111"', "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
  plugins: [{ name: "fixture-navigation-and-wallet-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(next\/link|next\/navigation)$/ }, args => ({ path: args.path, namespace: "locale-fixture" }));
    builder.onResolve({ filter: /\/(wallet-menu|dispatch-wire)$/ }, args => ({ path: args.path, namespace: "locale-fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "locale-fixture" }, args => ({ loader: "js", resolveDir: process.cwd(), contents:
      args.path === "next/link" ? `import React from'react';export default function Link({href,children,onNavigate,...props}){return React.createElement('a',{...props,href},children)}` :
      args.path === "next/navigation" ? `export const usePathname=()=>location.pathname;` :
      args.path.endsWith("wallet-menu") ? `import React from'react';export const WalletMenu=()=>React.createElement('button',null,'Fixture wallet session');` :
      `export const DispatchWire=()=>null;` }));
  } }],
});
const files = new Map(bundle.outputFiles.map(file => [`/assets/${file.path.split(/locale-fixture-build[\\/]/)[1].replaceAll("\\", "/")}`, file.text]));
const entry = [...files.keys()].find(path => path.endsWith("/entry.js")); assert(entry);
const targetChunks = Object.entries(bundle.metafile.outputs).filter(([, value]) => Object.keys(value.inputs).some(path => /locales\/(?:vi|zh-Hans)\/ui-shell-preview/.test(path)));
assert.equal(targetChunks.length, 2, "Both prepared targets must remain distinct lazy chunks");
const browser = await chromium.launch({ headless: true });
const outcomes: unknown[] = [];
try {
  for (const width of [320, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: "en-US" });
    let owner: string | null = alice, writeFailure = false;
    const account = new Map([[alice, "en"], [bob, "zh-Hans"]]);
    const errors: string[] = [], seen: string[] = [], packets: unknown[] = [], puts: { owner: string; value: unknown }[] = [];
    // These CSS rules isolate responsive/accessibility behavior in the built fixture.
    // Actual production CSS/font/Next HTML review remains a distinct acceptance gate.
    const css = `body{margin:0;max-width:100%;font-family:sans-serif}select,button,input,textarea{min-height:44px}select{max-width:100%}.hidden{display:none}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}header{position:relative}nav{flex-wrap:wrap}header>div{display:flex;justify-content:space-between}footer{padding:16px}main{display:grid;padding:16px}a{overflow-wrap:anywhere}@media(min-width:1024px){.lg\\:flex{display:flex}.lg\\:hidden{display:none}}`;
    await context.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url()); seen.push(url.pathname);
      assert.equal(url.origin, base, "Fixture must never contact a real provider or target");
      if (files.has(url.pathname)) return route.fulfill({ contentType: "application/javascript", body: files.get(url.pathname)! });
      if (url.pathname === "/api/auth/session") return route.fulfill({ status: owner ? 200 : 401, json: { session: owner ? { address: owner, role: "asker" } : null } });
      if (url.pathname === "/api/me/locale-preference") {
        const expected = req.headers()["x-keryx-expected-wallet"];
        assert.equal(req.headers()["x-keryx-locale-network"], "eip155:5042");
        if (expected !== owner) return route.fulfill({ status: 409, json: { error: "account_changed" } });
        if (req.method() === "PUT") {
          const value = req.postDataJSON(); puts.push({ owner: expected, value });
          assert.deepEqual(Object.keys(value).sort(), ["locale", "version"]);
          if (writeFailure) return route.fulfill({ status: 503, json: { error: "locale_unavailable" } });
          account.set(owner!, value.locale);
        }
        return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 1, locale: account.get(owner!) ?? null,
          owner, origin: base, network: "eip155:5042", acceptLanguage: "en-US" } });
      }
      if (url.pathname === "/api/ask") { packets.push(req.postDataJSON()); return route.fulfill({ json: { fixtureOnly: true } }); }
      assert(["/", "/preview"].includes(url.pathname), `Unexpected fixture route ${url.pathname}`);
      return route.fulfill({ contentType: "text/html", body: `<html lang="en" dir="ltr"><head><style>${css}</style></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>` });
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto(base); await page.locator('[data-language-switcher] select').last().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLSelectElement>('[data-language-switcher] select')].every(select => !select.disabled));
    assert.deepEqual(await page.locator('[data-language-switcher] select').last().locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)), ["en"]);
    assert(!seen.some(path => targetChunks.some(([chunk]) => path.endsWith(chunk.split("locale-fixture-build/")[1]))), "Shipped English must not fetch a target catalogue");
    await page.goto(`${base}/preview`);
    await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>('footer select')!.disabled);
    await page.getByLabel("Draft question").fill("Preserve this unsent question"); await page.getByLabel("Unsaved editor").fill("Retain edited source text");
    await Promise.all([page.waitForResponse(response => response.url() === base + "/api/ask" && response.request().method() === "POST"), page.locator("#send-fixture").click()]);
    if (width === 320) await page.getByRole("button", { name: "Open menu", exact: true }).click();
    const headerSelect = page.locator("header select:visible").first();
    await headerSelect.selectOption("vi"); await page.waitForFunction(() => document.documentElement.lang === "vi");
    assert(await page.locator("header").getByText("Đặt câu hỏi", { exact: true }).count() > 0);
    assert.equal(await page.getByLabel("Draft question").inputValue(), "Preserve this unsent question");
    assert.equal(await page.getByLabel("Unsaved editor").inputValue(), "Retain edited source text");
    assert.equal(await page.evaluate(() => (window as unknown as { mounts: number }).mounts), 1);
    assert.equal(await page.locator("#original-report").getAttribute("href"), "/dispatch/retained?view=receipt#evidence");
    if (width === 320) {
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("header select:visible").count(), 0);
      assert.equal(await page.getByRole("button", { name: "Mở menu", exact: true }).evaluate(button => button === document.activeElement), true);
    }
    await Promise.all([page.waitForResponse(response => response.url() === base + "/api/ask" && response.request().method() === "POST"), page.locator("#send-fixture").click()]); await page.waitForFunction(() => document.querySelector('footer [role="status"]')?.textContent?.includes("saved to this account"));
    assert.deepEqual(packets, [originalPacket, originalPacket]);
    // A new page in the same browser context starts a new provider/session, using synthetic account state.
    const second = await context.newPage(); second.on("pageerror", error => errors.push(error.message)); await second.goto(`${base}/preview`);
    await second.waitForFunction(() => document.documentElement.lang === "vi"); await second.close();
    owner = bob; await page.evaluate(() => window.dispatchEvent(new Event("keryx:auth")));
    await page.waitForFunction(() => document.documentElement.lang === "zh-Hans");
    owner = null; await page.evaluate(() => window.dispatchEvent(new CustomEvent("keryx:auth", { detail: "signed-out" })));
    await page.waitForFunction(() => document.documentElement.lang === "en");
    assert.equal(puts.length, 1, "Refresh/owner change/logout must never copy another owner's preference");
    // A denied/corrupt browser store does not prevent an in-memory explicit choice.
    await page.evaluate(() => { localStorage.setItem('keryx:ui-locale:v1:eip155:5042:https://locale-fixture.test:guest', 'corrupt'); });
    await page.locator("footer select").selectOption("vi"); await page.waitForFunction(() => document.documentElement.lang === "vi");
    await page.evaluate(() => Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("Synthetic storage denial"); } }));
    await page.locator("footer select").selectOption("zh-Hans"); await page.waitForFunction(() => document.documentElement.lang === "zh-Hans");
    assert((await page.locator('footer [role="status"]').textContent())?.includes("may not survive"));
    for (const select of await page.locator('[data-language-switcher] select').all()) {
      const id = await select.getAttribute("id"); assert(id);
      assert.equal(await page.evaluate(value => document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(value)}"]`)?.textContent, id), "Interface language");
      assert(await select.evaluate(element => (element.getAttribute("aria-describedby") ?? "").split(" ").every(value => !!document.getElementById(value))));
    }
    assert((await page.locator("footer select").boundingBox())!.height >= 44);
    await page.locator("footer select").focus(); await page.keyboard.press("ArrowUp"); await page.keyboard.press("Enter");
    await mkdir(output, { recursive: true }); await page.screenshot({ path: resolve(output, `preview-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []); outcomes.push({ width, transport: "synthetic", actualCompiledShell: true, targetChunks: 2,
      draftAndEditorPreserved: true, childMounts: 1, capturedPacketUnchanged: true, realSigningOrDevicePersistence: "UNPERFORMED" });
    // Separate failed-write fixture follows fresh authenticated refresh.
    owner = alice; writeFailure = true; await page.evaluate(() => window.dispatchEvent(new Event("keryx:auth")));
    await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>('footer select')!.disabled);
    await page.locator("footer select").selectOption("zh-Hans");
    await page.waitForFunction(() => document.querySelector('footer [role="status"]')?.textContent?.includes("unavailable") || document.querySelector('footer [role="status"]')?.textContent?.includes("may not survive"));
    await context.close();
  }
  await writeFile(resolve(output, "built-fixture-result.json"), JSON.stringify({ outcomes, qualification: "Synthetic source fixture only; production Next boundary, human visual review and real account storage remain separate gates." }, null, 2));
} finally { await browser.close(); }

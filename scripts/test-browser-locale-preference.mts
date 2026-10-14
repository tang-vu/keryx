/** Built source fixture. Uses an explicit owned build/browser/output resource.
 * Bundles actual provider/switcher/header/footer; all auth/locale/Ask transport is synthetic.
 * This does not accept a Next runtime, real signing, cross-device persistence or human translations. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const option = process.argv.indexOf("--output-dir");
assert(option >= 0 && process.argv[option + 1], "Explicit --output-dir in the admitted resource is required");
const output = resolve(process.argv[option + 1]);
const base = "https://locale-fixture.test", alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const originalPacket = { question: "Retain original request", budget: 0.05, payer: alice, sessionId: "original-session", signature: "0x1234", nonce: "retained-original-nonce" };
// Bind to current English bytes, never to a draft's claimed source/hash or manifest counts.
const sourceHashes = Object.fromEntries(await Promise.all(["shell", "legal"].map(async namespace => [namespace,
  createHash("sha256").update((await readFile(`locales/en/${namespace}.ts`, "utf8")).replace(/\r\n?/gu, "\n")).digest("hex")])));
const bundle = await build({ stdin: { sourcefile: "locale-fixture.tsx", loader: "tsx", resolveDir: process.cwd(), contents: `
  import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
  import{LocaleProvider,useLocale}from'./lib/i18n/locale-context';
  import{SiteHeader}from'./components/keryx/site-header';import{SiteFooter}from'./components/keryx/site-footer';
  import{preparedLocales}from'./lib/i18n/locales';
  import{loadUiNamespaceCatalogue}from'./lib/i18n/ui-shell-catalogue';
  import{shellMessages}from'./locales/en/shell';import{legalMessages}from'./locales/en/legal';
  const hashes=${JSON.stringify(sourceHashes)};
  const sources={shell:{namespace:'shell',sourcePath:'locales/en/shell.ts',sourceSha256:hashes.shell,entries:shellMessages},
    legal:{namespace:'legal',sourcePath:'locales/en/legal.ts',sourceSha256:hashes.legal,entries:legalMessages}};
  const keys={shell:['shellNavigation.ask','shellFooter.house','shellFooter.usdcOnArc','shellFooter.x402Gateway',
    'historyObservation.unavailable','shellNavigation.research','shellFooter.copyright'],
    legal:['legal.finePrint','legal.privacy.title','legal.terms.accountsAndRecovery.authorizations']};
  const loaders={vi:{shell:()=>import('./locales/vi/ui-drafts/shell.json').then(m=>m.default),
    legal:()=>import('./locales/vi/ui-drafts/legal.json').then(m=>m.default)},
    'zh-Hans':{shell:()=>import('./locales/zh-Hans/ui-drafts/shell.json').then(m=>m.default),
    legal:()=>import('./locales/zh-Hans/ui-drafts/legal.json').then(m=>m.default)}};
  // Fixture controls only: real assets and runtime validation, synthetic negative inputs.
  window.namespaceProbe=async(locale,enabled,mode='actual',namespace='shell')=>{
    let calls=0,getters=0,raw;
    const source=mode==='unknownNamespace'?{...sources.shell,namespace:'../unknown'}:sources[namespace];
    const selected=await loadUiNamespaceCatalogue(locale,enabled,mode==='missingRequest'?undefined:{source,previewKeys:mode==='emptyScope'?[]:keys[namespace],load:async()=>{
      calls++;if(mode==='failedLoad')throw Error('Synthetic chunk refusal');
      raw=await loaders[locale][namespace]();const draft=structuredClone(raw);
      if(mode==='staleHash')draft.sourceSha256='0'.repeat(64);
      if(mode==='stalePath')draft.sourcePath='locales/en/unknown.ts';
      if(mode==='unknownKey')draft.entries.unknown={source:'Unknown',text:'Unknown'};
      if(mode==='malformed')draft.entries=[];
      if(mode==='nonNullReview')draft.review='synthetic-invalid-review';
      if(mode==='invalidStatus')draft.status='synthetic-invalid-status';
      if(mode==='accessor')Object.defineProperty(draft,'entries',{enumerable:true,get(){getters++;throw Error('Getter must not run')}});
      if(mode==='staleLeaf')draft.entries['shellNavigation.ask'].source='Old English';
      if(mode==='badProtocol')draft.entries['shellFooter.usdcOnArc'].text='USD on Arc';
      if(mode==='badPlaceholder')draft.entries['historyObservation.unavailable'].text='References {privateQuestion}';
      return draft;
    }});
    return{calls,getters,selected,frozen:Object.isFrozen(selected),english:source.entries,keys:keys[namespace],
      metadata:raw?{status:raw.status,review:raw.review}:null,
      texts:raw?Object.fromEntries(keys[namespace].map(key=>[key,raw.entries[key]?.text??null])):null};
  };
  function NamespacePreview(){const{locale,enabledLocales}=useLocale();const[result,setResult]=useState(null);
    useEffect(()=>{setResult(null)},[locale]);
    return <section id="namespace-preview" lang={locale} aria-label="Explicit namespace draft preview">
      <button id="load-namespace" onClick={async()=>{
        const shell=await window.namespaceProbe(locale,enabledLocales,'actual','shell');
        const legal=await window.namespaceProbe(locale,enabledLocales,'actual','legal');setResult({locale,shell,legal});
      }}>Load explicit namespace draft preview</button>
      {result&&<div data-namespace-locale={result.locale}>
        <p id="namespace-review" lang="en">Preview only · machineDraft · review:null · no human approval</p>
        {['shell','legal'].map(namespace=><div key={namespace}>{keys[namespace].map(key=><p data-preview-key={key} key={key}
          lang={Object.hasOwn(result[namespace].selected,key)?result.locale:'en'}>
          {result[namespace].selected[key]??sources[namespace].entries[key]}</p>)}</div>)}
      </div>}
    </section>}
  const packet=${JSON.stringify(originalPacket)};window.mounts=0;
  function Draft(){const[draft,setDraft]=useState('Keep my draft question');useEffect(()=>{window.mounts++},[]);
    const{locale}=useLocale();return <main lang="en"><output id="active-locale">{locale}</output>
      <textarea aria-label="Draft question" value={draft} onChange={event=>setDraft(event.target.value)}/>
      <input aria-label="Unsaved editor" defaultValue="Keep editor draft"/>
      <a id="original-report" href="/dispatch/retained?view=receipt#evidence">Original</a>
      <button id="send-fixture" onClick={()=>fetch('/api/ask',{method:'POST',body:JSON.stringify(packet)})}>Capture unchanged fixture arguments</button>
      <NamespacePreview/>
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
const namespaceChunks = Object.entries(bundle.metafile.outputs).filter(([, value]) =>
  Object.keys(value.inputs).some(path => /locales[\\/](?:vi|zh-Hans)[\\/]ui-drafts[\\/](?:shell|legal)\.json$/u.test(path)));
assert.equal(namespaceChunks.length, 4, "Each target/namespace must remain a separate lazy asset chunk");
const chunkUrl = (path: string) => `/assets/${path.split(/locale-fixture-build[\\/]/u)[1].replaceAll("\\", "/")}`;
const namespaceUrls = namespaceChunks.map(([path]) => chunkUrl(path));
for (const [path, value] of namespaceChunks) {
  assert.notEqual(chunkUrl(path), entry, "Namespace assets must not be in the entry bundle");
  assert.equal(Object.keys(value.inputs).filter(input => /ui-drafts[\\/]/u.test(input)).length, 1);
}
type Probe = { calls: number; getters: number; selected: Record<string, string>; frozen: boolean;
  english: Record<string, string>; keys: string[]; metadata: { status: string; review: unknown } | null;
  texts: Record<string, string | null> | null };
const probe = (page: Page, locale: string, enabled: string[], mode = "actual", namespace = "shell") =>
  page.evaluate(async args => (window as unknown as { namespaceProbe: (...args: unknown[]) => Promise<Probe> })
    .namespaceProbe(...args), [locale, enabled, mode, namespace]);
const tokens = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map(match => match[0]).sort();
async function assertNamespacePreview(page: Page, locale: "vi" | "zh-Hans", width: number) {
  await page.locator("#load-namespace").click();
  await page.locator(`[data-namespace-locale="${locale}"]`).waitFor();
  assert.equal(await page.locator("#namespace-review").textContent(), "Preview only · machineDraft · review:null · no human approval");
  const results = await Promise.all([probe(page, locale, ["en", "vi", "zh-Hans"]),
    probe(page, locale, ["en", "vi", "zh-Hans"], "actual", "legal")]);
  for (const [index, result] of results.entries()) {
    assert.equal(result.calls, 1); assert(result.frozen); assert.deepEqual(result.metadata, { status: "machineDraft", review: null });
    for (const key of result.keys) {
      const node = page.locator(`[data-preview-key="${key}"]`);
      const translated = Object.hasOwn(result.selected, key);
      assert.equal(await node.textContent(), translated ? result.texts![key] : result.english[key]);
      assert.equal(await node.getAttribute("lang"), translated ? locale : "en");
      assert.deepEqual(tokens((await node.textContent())!, /\$\{[^}]+\}|\{[A-Za-z][A-Za-z0-9]*\}/gu),
        tokens(result.english[key], /\$\{[^}]+\}|\{[A-Za-z][A-Za-z0-9]*\}/gu));
      assert.deepEqual(tokens((await node.textContent())!, /(?<![A-Za-z0-9])(?:USDC|Arc|x402|BUY|SKIP|CACHE)(?![A-Za-z0-9])/gu),
        tokens(result.english[key], /(?<![A-Za-z0-9])(?:USDC|Arc|x402|BUY|SKIP|CACHE)(?![A-Za-z0-9])/gu));
      if (index === 1 || ["shellNavigation.research", "shellFooter.copyright"].includes(key)) {
        assert(!translated, `Critical copy ${key} must remain independently bound English`);
      }
    }
  }
  const shell = results[0];
  for (const key of ["shellNavigation.ask", "shellFooter.house", "historyObservation.unavailable", "shellFooter.usdcOnArc"])
    assert(Object.hasOwn(shell.selected, key) && shell.selected[key] !== shell.english[key], `Real neutral translation required: ${key}`);
  assert.equal(shell.selected["shellNavigation.ask"], locale === "vi" ? "Đặt câu hỏi" : "提出问题");
  for (const mode of ["staleHash", "stalePath", "unknownKey", "malformed", "nonNullReview", "invalidStatus", "accessor", "failedLoad"]) {
    const result = await probe(page, locale, ["en", "vi", "zh-Hans"], mode);
    assert.deepEqual(result.selected, {}, `${mode} must refuse the namespace`); assert.equal(result.getters, 0);
  }
  for (const [mode, key] of [["staleLeaf", "shellNavigation.ask"], ["badProtocol", "shellFooter.usdcOnArc"],
    ["badPlaceholder", "historyObservation.unavailable"]]) {
    const result = await probe(page, locale, ["en", "vi", "zh-Hans"], mode);
    assert(!Object.hasOwn(result.selected, key), `${mode} must retain English`);
    assert.equal(result.selected["shellFooter.house"], shell.selected["shellFooter.house"], "Valid sibling survives invalid leaf");
  }
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.locator("#namespace-preview").evaluate(panel => {
    const nodes = [...panel.querySelectorAll<HTMLElement>('[data-preview-key],#namespace-review')];
    return { overflow: document.documentElement.scrollWidth > innerWidth,
      leaves: nodes.map(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        const box = node.getBoundingClientRect(), rects = [...range.getClientRects()];
        const style = getComputedStyle(node);
        const cjk = [...(node.textContent ?? "")].filter(char => /[\u3400-\u9fff]/u.test(char));
        return { key: node.dataset.previewKey ?? "review", visible: style.visibility === "visible" && style.display !== "none",
          clipped: node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight,
          bounded: box.width > 0 && rects.length > 0 && rects.every(rect => rect.width > 0 && rect.height > 0 &&
            rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 &&
            rect.left >= -1 && rect.right <= innerWidth + 1), cjk: cjk.length,
          fontReady: document.fonts.check(style.font, cjk.join("")) };
      }) };
  });
  assert(!layout.overflow, `${width}px page must not scroll horizontally`);
  assert(layout.leaves.every(leaf => leaf.visible && !leaf.clipped && leaf.bounded && leaf.fontReady), JSON.stringify(layout));
  if (locale === "zh-Hans") assert(layout.leaves.some(leaf => leaf.key === "shellNavigation.ask" && leaf.cjk >= 4), "Visible Chinese glyph run required");
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: resolve(output, `namespace-${locale}-${width}.png`), fullPage: true });
}
const browser = await chromium.launch({ headless: true });
const outcomes: unknown[] = [];
try {
  for (const width of [320, 390, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: "en-US" });
    let owner: string | null = alice, writeFailure = false;
    const account = new Map([[alice, "en"], [bob, "zh-Hans"]]);
    const errors: string[] = [], seen: string[] = [], packets: unknown[] = [], puts: { owner: string; value: unknown }[] = [];
    // These CSS rules isolate responsive/accessibility behavior in the built fixture.
    // Actual production CSS/font/Next HTML review remains a distinct acceptance gate.
    const css = `body{margin:0;max-width:100%;font-family:sans-serif}select,button,input,textarea{min-height:44px}select{max-width:100%}.hidden{display:none}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}header{position:relative}nav{flex-wrap:wrap}header>div{display:flex;justify-content:space-between}footer{padding:16px}main{display:grid;padding:16px;min-width:0}#namespace-preview{min-width:0}#namespace-preview p{white-space:normal;overflow-wrap:anywhere;line-height:1.5}a{overflow-wrap:anywhere}@media(min-width:1024px){.lg\\:flex{display:flex}.lg\\:hidden{display:none}}`;
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
    for (const [locale, enabled, mode] of [
      ["en", ["en", "vi", "zh-Hans"], "actual"], ["vi", ["en"], "actual"],
      ["zh-Hans", ["en"], "actual"], ["fr", ["en", "vi", "zh-Hans"], "actual"],
      ["vi", ["en", "vi", "zh-Hans"], "emptyScope"], ["vi", ["en", "vi", "zh-Hans"], "unknownNamespace"],
      ["vi", ["en", "vi", "zh-Hans"], "missingRequest"],
    ] as const) {
      const result = await probe(page, locale, [...enabled], mode);
      assert.equal(result.calls, 0, `${locale}/${mode} must not invoke a namespace loader`); assert.deepEqual(result.selected, {});
    }
    assert(!seen.some(path => namespaceUrls.includes(path)), "Default/disabled/unrequested namespaces must not fetch assets");
    await page.goto(`${base}/preview`);
    await page.waitForFunction(() => !document.querySelector<HTMLSelectElement>('footer select')!.disabled);
    await page.getByLabel("Draft question").fill("Preserve this unsent question"); await page.getByLabel("Unsaved editor").fill("Retain edited source text");
    await Promise.all([page.waitForResponse(response => response.url() === base + "/api/ask" && response.request().method() === "POST"), page.locator("#send-fixture").click()]);
    if (width < 1024) await page.getByRole("button", { name: "Open menu", exact: true }).click();
    const headerSelect = page.locator("header select:visible").first();
    await headerSelect.selectOption("vi"); await page.waitForFunction(() => document.documentElement.lang === "vi");
    assert(await page.locator("header").getByText("Đặt câu hỏi", { exact: true }).count() > 0);
    assert.equal(await page.getByLabel("Draft question").inputValue(), "Preserve this unsent question");
    assert.equal(await page.getByLabel("Unsaved editor").inputValue(), "Retain edited source text");
    assert.equal(await page.evaluate(() => (window as unknown as { mounts: number }).mounts), 1);
    assert.equal(await page.locator("#original-report").getAttribute("href"), "/dispatch/retained?view=receipt#evidence");
    if (width < 1024) {
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("header select:visible").count(), 0);
      assert.equal(await page.getByRole("button", { name: "Mở menu", exact: true }).evaluate(button => button === document.activeElement), true);
    }
    assert(!seen.some(path => namespaceUrls.includes(path)), "Changing shell preference must not request a namespace preview");
    await page.waitForFunction(() => document.querySelector('footer [role="status"]')?.textContent?.includes("saved to this account"));
    const apiBeforeNamespaces = seen.filter(path => path.startsWith("/api/"));
    await assertNamespacePreview(page, "vi", width);
    assert.deepEqual(seen.filter(path => path.startsWith("/api/")), apiBeforeNamespaces, "Namespace controls must not call any API");
    const fetchedNamespaces = namespaceChunks.filter(([path]) => seen.includes(chunkUrl(path)));
    assert.equal(fetchedNamespaces.length, 2, "Only explicitly selected VI shell/legal namespaces may load");
    assert(fetchedNamespaces.every(([, value]) => Object.keys(value.inputs).some(path => /locales[\\/]vi[\\/]ui-drafts[\\/]/u.test(path))));
    await Promise.all([page.waitForResponse(response => response.url() === base + "/api/ask" && response.request().method() === "POST"), page.locator("#send-fixture").click()]); await page.waitForFunction(() => document.querySelector('footer [role="status"]')?.textContent?.includes("saved to this account"));
    assert.deepEqual(packets, [originalPacket, originalPacket]);
    // A new page in the same browser context starts a new provider/session, using synthetic account state.
    const second = await context.newPage(); second.on("pageerror", error => errors.push(error.message)); await second.goto(`${base}/preview`);
    await second.waitForFunction(() => document.documentElement.lang === "vi"); await second.close();
    owner = bob; await page.evaluate(() => window.dispatchEvent(new Event("keryx:auth")));
    await page.waitForFunction(() => document.documentElement.lang === "zh-Hans");
    const apiBeforeChinese = seen.filter(path => path.startsWith("/api/"));
    await assertNamespacePreview(page, "zh-Hans", width);
    assert.deepEqual(seen.filter(path => path.startsWith("/api/")), apiBeforeChinese, "Chinese preview must not call any API");
    assert(namespaceUrls.every(path => seen.includes(path)), "Both explicitly requested target namespace pairs must have loaded");
    assert.equal(await page.getByLabel("Draft question").inputValue(), "Preserve this unsent question");
    assert.equal(await page.getByLabel("Unsaved editor").inputValue(), "Retain edited source text");
    assert.equal(await page.evaluate(() => (window as unknown as { mounts: number }).mounts), 1);
    assert.equal(await page.locator("#original-report").getAttribute("href"), "/dispatch/retained?view=receipt#evidence");
    assert.deepEqual(packets, [originalPacket, originalPacket]);
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
      namespaceChunks: 4, namespacePreviewOnly: true, sourceHashes, namespaceReview: "machineDraft/review:null",
      criticalEnglishFallback: true, namespaceRefusals: true, namespaceNoApi: true,
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

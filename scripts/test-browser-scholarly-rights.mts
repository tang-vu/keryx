/** Real creator component with hermetic wallet/HTTP fixtures; never signs or settles real funds. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

const address = "0x1111111111111111111111111111111111111111", hash = `0x${"a".repeat(64)}`;
const binding = { protocol: "keryx-scholarly-rights-v1", network: "eip155:5042002", deploymentOrigin: "https://paper.test",
  sourceId: "paper", itemId: "manuscript", registry: address, onchainId: hash, creator: address, recipient: address,
  priceMicros: "100", canonicalUrl: "https://author.example/manuscript", contentVersion: "ipfs:synthetic", bodyHash: hash,
  plaintextBytes: 1000, manifestId: hash };
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ScholarlyRightsPanel} from './app/creator/[id]/scholarly-rights-panel';
    window.messages=[]; createRoot(document.getElementById('root')).render(<ScholarlyRightsPanel creatorId="paper"/>);`,
    loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"', "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined", "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "hermetic-wallet", setup(build) {
    build.onResolve({ filter: /^wagmi$/ }, () => ({ path: "fixture-wallet", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export const useAccount=()=>({address:'${address}'});
      export const useSignMessage=()=>({signMessageAsync:async({message})=>{window.messages.push(message);return '0x'+'b'.repeat(130)}});` }));
  } }],
});
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    let enrolled = false, submitted: Record<string, unknown> | null = null;
    const requests: string[] = [], errors: string[] = [];
    await context.route("**/*", route => {
      const req = route.request(), url = new URL(req.url()); requests.push(`${req.method()} ${url.pathname}`);
      assert(!url.pathname.startsWith("/api/source/") && !url.pathname.startsWith("/api/cite/"), "Browser fixture must never reach payment routes");
      if (url.pathname === "/api/creator/paper/scholarly") {
        if (req.method() === "PUT") { enrolled = true; return route.fulfill({ json: { enrolled, status: "draft", earning: false } }); }
        if (req.method() === "POST") { submitted = req.postDataJSON(); return route.fulfill({ status: 201, json: { state: { declarationId: hash } } }); }
        return route.fulfill({ json: { state: submitted ? { sourceId: "paper", declarationId: hash, submission: submitted, decisionId: null, review: null } : null,
          enrolled, ready: true, items: 1, active: true, verified: true, binding } });
      }
      assert.equal(req.method(), "GET");
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><style>*{box-sizing:border-box}textarea,select,input{max-width:100%}section{max-width:100%}</style><main id="root"></main>' });
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://paper.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("button", { name: "Begin manuscript enrollment" }).click();
    await page.getByText("draft — earning blocked", { exact: true }).waitFor();
    for (const name of ["license", "permissionEvidence", "redistributionScope", "attributionConditions", "revocationContact"])
      await page.locator(`[name="${name}"]`).fill(`Synthetic explicit ${name}`);
    await page.locator('[name="commercialDistribution"]').check();
    await page.getByRole("button", { name: "Sign and submit for independent review" }).click();
    await page.getByText(/Signed declaration saved/).waitFor();
    assert(submitted); const declaration = (submitted as Record<string, unknown>).declaration as Record<string, unknown>;
    assert.equal(declaration.sourceId, "paper"); assert.equal(declaration.bodyHash, hash);
    assert.equal(declaration.commercialDistribution, true); assert.equal(declaration.recipient, address);
    assert.equal(await page.evaluate(() => (window as unknown as { messages: string[] }).messages.length), 1);
    assert.equal(await page.getByText("submitted", { exact: true }).isVisible(), true);
    assert.deepEqual(errors, []); assert(requests.includes("PUT /api/creator/paper/scholarly"));
    await context.close();
  }
  console.log("PASS: creator draft enrollment, exact-version rights signing, private evidence inputs and pending review status at 320px/1440px. Wallet and HTTP synthetic; no payment routes.");
} finally { await browser.close(); }
